/**
 * Agrégateur de sources : interroge toutes les sources en parallèle, isole
 * leurs pannes, fusionne leurs chapitres et bascule d'une source à l'autre
 * quand un chapitre ne s'ouvre pas.
 *
 * Aucun import de `config` : testable avec de fausses sources
 * (`backend/test/extensions.test.ts`). Le câblage réel est dans `index.ts`.
 */
import { TtlCache } from '../lib/cache.js'
import { HttpError, notFound, upstreamError } from '../lib/errors.js'
import { LANGUAGES } from '../lib/language.js'
import { CircuitBreaker, type BreakerOptions } from './circuitBreaker.js'
import { decodeChapterKey, encodeChapterKey } from './chapterKey.js'
import { mergeChapters } from './merge.js'
import type { SourceRegistry } from './registry.js'
import type { MergedChapter, NormalizedChapter, NormalizedPage, Quality, SourceProvider, SourceRef, SourcedChapter } from './types.js'

const MINUTE = 60 * 1000
/** Versions de repli essayées au plus pour un chapitre (en plus de celle demandée). */
export const MAX_ALTERNATES = 4

export interface SourceStatus extends SourceRef {
  /**
   * `ok` : a répondu (éventuellement 0 chapitre : titre absent de la source) ;
   * `timeout` : délai dépassé ; `failed` : erreur (HTTP, format…) ;
   * `skipped` : circuit ouvert, la source n'a pas été interrogée.
   */
  status: 'ok' | 'timeout' | 'failed' | 'skipped'
  chapters: number
  /** Durée de l'appel (0 si la source n'a pas été interrogée). */
  durationMs: number
  /** Raison de l'échec, pour le diagnostic. */
  error?: string
}

export interface AggregatedList {
  chapters: MergedChapter[]
  sources: SourceStatus[]
  /** Au moins une source a manqué : résultat à garder moins longtemps en cache. */
  partial: boolean
}

/** Page telle que le front la reçoit : toujours une URL de notre API. */
export interface ClientPage {
  index: number
  url: string
  fallbackUrl: string | null
}

export interface AggregatedPages {
  /** Chapitre réellement servi : celui demandé, ou une version de repli. */
  chapterId: string
  source: SourceRef
  fallback: boolean
  pages: ClientPage[]
}

export interface ResolvedPage {
  page: NormalizedPage
  /** La source télécharge ses images elle-même (bibliothèque personnelle) : le relais doit passer par elle. */
  fetchImage?: SourceProvider['fetchImage']
  /** Nombre de pages du chapitre : une version de repli n'est utilisable page à page que si elle a le même. */
  count: number
  source: SourceRef
}

export interface AggregatorOptions {
  /** Titres connus de l'œuvre, pour les sources qui cherchent par titre. */
  resolveAliases?: (mangaId: string) => Promise<string[]>
  /**
   * URL publique du relais d'images pour une page d'une source non `selfRelayed`.
   * `count` voyage avec : le relais ne remplace une page par celle d'une autre
   * version que si les deux ont le même nombre de pages.
   */
  relayUrl: (chapterKey: string, index: number, context: { count: number; alternates: readonly string[] }) => string
  breaker?: BreakerOptions
  defaultTimeoutMs?: number
  log?: (message: string) => void
}

/** Circuit ouvert : la source n'a pas été appelée. */
export class SourceSkippedError extends Error {}
export class SourceTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SourceTimeoutError(`délai de ${ms} ms dépassé`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))
const refOf = (provider: SourceProvider): SourceRef => ({ id: provider.id, name: provider.name })

export class SourceAggregatorService {
  private readonly registry: SourceRegistry
  private readonly options: AggregatorOptions
  private readonly breakers = new Map<string, CircuitBreaker>()
  /** Pages brutes (URL amont + en-têtes) des sources relayées, pour le proxy d'images. */
  private readonly pageCache = new TtlCache<NormalizedPage[]>({ maxEntries: 500, ttlMs: 10 * MINUTE })

  constructor(registry: SourceRegistry, options: AggregatorOptions) {
    this.registry = registry
    this.options = options
  }

  breakerFor(sourceId: string): CircuitBreaker {
    let breaker = this.breakers.get(sourceId)
    if (!breaker) {
      breaker = new CircuitBreaker(this.options.breaker)
      this.breakers.set(sourceId, breaker)
    }
    return breaker
  }

  /**
   * Exécute une opération d'une source derrière son disjoncteur et son délai.
   * Toute erreur (réseau, réponse au format inattendu, exception du code de la
   * source) est journalisée ici, puis remonte à l'appelant qui décide du repli.
   */
  private async run<T>(provider: SourceProvider, operation: () => Promise<T>): Promise<T> {
    const breaker = this.breakerFor(provider.id)
    if (!breaker.tryAcquire()) throw new SourceSkippedError(`${provider.id} : circuit ouvert`)
    try {
      const result = await withTimeout(operation(), provider.timeoutMs ?? this.options.defaultTimeoutMs ?? 10_000)
      breaker.recordSuccess()
      return result
    } catch (error) {
      // Un 404 n'est pas une panne : la source répond, elle n'a simplement pas ce titre.
      if (error instanceof HttpError && error.status === 404) breaker.recordSuccess()
      else breaker.recordFailure()
      this.options.log?.(`${provider.id} : ${describe(error)}`)
      throw error
    }
  }

  /** Identifiants publics et provenance ; tout ce qui sort du contrat est écarté. */
  private adopt(provider: SourceProvider, chapters: NormalizedChapter[]): SourcedChapter[] {
    const languages = new Set<string>(provider.supportedLanguages.filter((language) => LANGUAGES.includes(language)))
    const source = refOf(provider)
    return chapters
      .filter((chapter) => typeof chapter.id === 'string' && chapter.id.length > 0 && languages.has(chapter.language))
      .map((chapter) => ({ ...chapter, id: encodeChapterKey(provider.id, chapter.id), source }))
  }

  /**
   * Chapitres de toutes les sources, fusionnés. Les sources sont interrogées
   * en parallèle (`Promise.allSettled`) : une source lente ou en panne ne
   * retarde au pire que de son délai, et n'empêche jamais les autres de répondre.
   */
  async fetchChapterList(mangaId: string): Promise<AggregatedList> {
    const providers = this.registry.list()
    let aliases: Promise<string[]> | undefined
    // Résolus une seule fois, et seulement si une source en a besoin.
    const aliasesOnce = () =>
      (aliases ??= (this.options.resolveAliases?.(mangaId) ?? Promise.resolve([])).catch((error: unknown) => {
        this.options.log?.(`titres de ${mangaId} introuvables : ${describe(error)}`)
        return []
      }))

    const durations = new Map<string, number>()
    const settled = await Promise.allSettled(
      providers.map(async (provider) => {
        const titles = provider.usesAliases ? await aliasesOnce() : []
        const started = Date.now()
        try {
          const chapters = await this.run(provider, () => provider.fetchChapterList(mangaId, titles))
          return this.adopt(provider, chapters)
        } finally {
          durations.set(provider.id, Date.now() - started)
        }
      }),
    )

    const sources: SourceStatus[] = []
    const chapters: SourcedChapter[] = []
    let firstError: unknown
    settled.forEach((result, index) => {
      const provider = providers[index]!
      const durationMs = durations.get(provider.id) ?? 0
      if (result.status === 'fulfilled') {
        chapters.push(...result.value)
        sources.push({ ...refOf(provider), status: 'ok', chapters: result.value.length, durationMs })
        return
      }
      firstError ??= result.reason
      const reason = result.reason
      const status = reason instanceof SourceSkippedError ? 'skipped' : reason instanceof SourceTimeoutError ? 'timeout' : 'failed'
      sources.push({ ...refOf(provider), status, chapters: 0, durationMs: status === 'skipped' ? 0 : durationMs, error: describe(reason) })
    })
    // Une ligne par source : on voit d'un coup d'œil laquelle répond vide, échoue ou expire.
    this.options.log?.(
      `${mangaId} : ${sources.map((source) => `${source.id} ${source.status === 'ok' ? `${source.chapters} ch.` : source.status} (${source.durationMs} ms)`).join(' · ')}`,
    )

    if (!sources.some((source) => source.status === 'ok')) {
      // Même réponse qu'avant l'agrégation quand MangaDex est seul (404 compris).
      throw firstError instanceof HttpError ? firstError : upstreamError('Aucune source de chapitres ne répond.')
    }

    const merged = mergeChapters(chapters, (sourceId) => this.registry.get(sourceId)?.priority ?? 0)
    return { chapters: merged, sources, partial: sources.some((source) => source.status !== 'ok') }
  }

  /**
   * Pages d'un chapitre. Si sa source échoue (panne, circuit ouvert, chapitre
   * vide), les versions de repli sont essayées dans l'ordre : le lecteur
   * reçoit des pages, et `fallback` lui dit d'où elles viennent.
   */
  async fetchPages(chapterKey: string, quality: Quality, alternates: readonly string[] = []): Promise<AggregatedPages> {
    const candidates = [...new Set([chapterKey, ...alternates])].slice(0, 1 + MAX_ALTERNATES)
    let firstError: unknown

    for (const key of candidates) {
      const decoded = decodeChapterKey(key)
      const provider = decoded ? this.registry.get(decoded.sourceId) : undefined
      if (!decoded || !provider) {
        firstError ??= notFound('Source de chapitre inconnue.')
        continue
      }
      try {
        const pages = await this.run(provider, () => provider.fetchPageUrls(decoded.rawId, { quality }))
        if (pages.length === 0) throw notFound('Ce chapitre n’a aucune page.')
        const others = candidates.filter((candidate) => candidate !== key)
        if (!provider.selfRelayed) this.pageCache.set(key, pages)
        return {
          chapterId: key,
          source: refOf(provider),
          fallback: key !== chapterKey,
          // Index = position : on ne se fie pas à la numérotation de la source.
          pages: pages.map((page, index) =>
            provider.selfRelayed
              ? { index, url: page.url, fallbackUrl: page.fallbackUrl ?? null }
              : { index, url: this.options.relayUrl(key, index, { count: pages.length, alternates: others }), fallbackUrl: null },
          ),
        }
      } catch (error) {
        firstError ??= error
      }
    }

    throw firstError instanceof HttpError ? firstError : upstreamError('Chapitre indisponible sur toutes les sources.')
  }

  /** Une page amont (URL + en-têtes de provenance), pour le relais d'images. */
  async resolvePage(chapterKey: string, index: number): Promise<ResolvedPage> {
    const decoded = decodeChapterKey(chapterKey)
    const provider = decoded ? this.registry.get(decoded.sourceId) : undefined
    // Les sources `selfRelayed` (MangaDex) ont leur propre relais, avec ses règles.
    if (!decoded || !provider || provider.selfRelayed) throw notFound('Source de chapitre inconnue.')
    const pages = await this.pageCache.getOrLoad(chapterKey, () =>
      this.run(provider, () => provider.fetchPageUrls(decoded.rawId, { quality: 'data' })),
    )
    const page = pages[index]
    if (!page) throw notFound('Page introuvable dans ce chapitre.')
    return { page, count: pages.length, source: refOf(provider), ...(provider.fetchImage && { fetchImage: provider.fetchImage }) }
  }

  /** Oublie les URL d'un chapitre (URL signées expirées, serveur d'images remplacé). */
  forgetPages(chapterKey: string): void {
    this.pageCache.delete(chapterKey)
  }
}
