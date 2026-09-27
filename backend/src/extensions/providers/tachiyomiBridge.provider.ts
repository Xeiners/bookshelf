import { TtlCache } from '../../lib/cache.js'
import { notFound, upstreamError } from '../../lib/errors.js'
import { LANGUAGES, type Language } from '../../lib/language.js'
import { bestTitleMatch, normalizeTitle, searchQueries } from '../titleMatch.js'
import type { NormalizedChapter, SourceProvider } from '../types.js'
import { numberFromTitle, providerLogger, type ProviderLog } from './http.js'
import { isNumberingOnly, originImageFetcher } from './library.js'
import type { BridgeChapter, BridgeManga, BridgeSource, SuwayomiClient } from './suwayomi.client.js'

/**
 * Extensions Tachiyomi / Mihon, via le pont Suwayomi (cf. suwayomi.client.ts).
 *
 * UN fournisseur (`tachiyomi`) pour TOUTES les extensions installées : chaque
 * site (Asura Scans, Scantrad…) est une sous-source (`origin`), que
 * l'agrégateur publie sous `tachiyomi:<id de la source>`. Badge, fusion et
 * sélecteur du lecteur les traitent donc comme autant de sources distinctes.
 *
 * Tenue dans le temps : chaque appel au pont est borné (`timeoutMs`, 3 s par
 * défaut) ; les sites sont interrogés en parallèle et isolés les uns des
 * autres — un site lent ou en panne ne coûte que ses propres chapitres. Le
 * fournisseur n'échoue que si TOUS échouent (le disjoncteur de l'agrégateur
 * prend alors le relais).
 *
 * Images : Suwayomi les sert lui-même (`/api/v1/manga/…/page/n`), après les
 * avoir demandées au site avec les en-têtes que l'extension exige (Referer,
 * User-Agent, cookies Cloudflare). Le relais `/api/proxy` les télécharge
 * depuis la seule origine du pont (`fetchImage`) : ni l'adresse interne ni le
 * site d'origine ne sont jamais exposés au navigateur.
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
/** Requêtes de recherche par site, lancées ensemble : le délai d'une étape reste celui d'un appel. */
const QUERIES_PER_SOURCE = 2
const EPOCH = new Date(0).toISOString()
/** Avant 1995, une date de chapitre est une valeur par défaut, pas une date. */
const OLDEST_PLAUSIBLE = Date.UTC(1995, 0, 1)

const VOLUME = /\bvol(?:ume)?\.?\s*(\d+(?:\.\d+)?)/i
/** « Vol.2 Ch.12 : », « Chapter 12 - », « Chapitre 12.5 » : la numérotation en tête du nom. */
const NUMBERING_PREFIX =
  /^\s*(?:vol(?:ume)?\.?\s*\d+(?:\.\d+)?\s*[-–—:,.]?\s*)?(?:(?:ch(?:apter|apitre|ap)?|[eé]p(?:isode)?)\.?\s*\d+(?:\.\d+)?)\s*[-–—:.]?\s*/i

/** Float Kotlin → texte : `12.0` → « 12 », `10.100000381` → « 10.1 ». Négatif = numéro inconnu. */
export function bridgeChapterNumber(value: number, name: string): string | null {
  if (!Number.isFinite(value) || value < 0) return numberFromTitle(name)
  return String(Math.round(value * 100) / 100)
}

/** Ce que le nom apporte au-delà de sa numérotation : « Ch. 12 - Le retour » → « Le retour ». */
export function bridgeChapterTitle(name: string): string | null {
  const trimmed = name.trim()
  const rest = trimmed.replace(NUMBERING_PREFIX, '').trim()
  if (!rest || isNumberingOnly(rest)) return null
  return rest
}

function bridgeDate(value: string | null | undefined): string {
  const time = Number(value)
  return Number.isFinite(time) && time >= OLDEST_PLAUSIBLE ? new Date(time).toISOString() : EPOCH
}

export function normalizeBridgeChapter(chapter: BridgeChapter, source: BridgeSource & { lang: Language }): NormalizedChapter {
  const name = chapter.name.trim()
  const scanlator = chapter.scanlator?.trim()
  return {
    id: String(chapter.id),
    number: bridgeChapterNumber(chapter.chapterNumber, name),
    volume: VOLUME.exec(name)?.[1] ?? null,
    title: bridgeChapterTitle(name),
    language: source.lang,
    // Suwayomi met -1 tant que le chapitre n'a jamais été ouvert.
    pages: chapter.pageCount && chapter.pageCount > 0 ? chapter.pageCount : 0,
    groups: scanlator ? [{ id: normalizeTitle(scanlator) || scanlator, name: scanlator }] : [],
    publishedAt: bridgeDate(chapter.uploadDate),
    origin: { id: source.id, name: source.name },
  }
}

export interface TachiyomiBridgeOptions {
  client: SuwayomiClient
  userAgent: string
  /** Délai d'un appel au pont (ms) : au-delà, le site est abandonné pour cette requête. */
  timeoutMs: number
  /** Délai d'une image (ms) : c'est le contenu lui-même, pas une métadonnée. */
  imageTimeoutMs?: number
  languages: readonly Language[]
  /** Sites interrogés au plus par œuvre : borne l'éventail de requêtes. */
  maxSources: number
  /** Ne garder que ces sources (id ou nom) ; vide = toutes celles des extensions installées. */
  sources?: readonly string[]
  includeNsfw?: boolean
  log?: ProviderLog
}

export type ActiveSource = BridgeSource & { lang: Language }

export interface TachiyomiBridgeProvider extends SourceProvider {
  /** Sites actuellement interrogés (extensions installées, filtrées par langue). */
  activeSources(): Promise<ActiveSource[]>
  /** Relit la liste des sites au prochain appel (extension installée ou retirée). */
  forgetSources(): void
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createTachiyomiBridgeProvider(options: TachiyomiBridgeOptions): TachiyomiBridgeProvider {
  const { client } = options
  const log = options.log ?? providerLogger('Tachiyomi')
  const languages = new Set<string>(options.languages.filter((language) => LANGUAGES.includes(language)))
  const wanted = new Set((options.sources ?? []).map((entry) => normalizeTitle(entry)).filter(Boolean))

  const sourceCache = new TtlCache<ActiveSource[]>({ maxEntries: 1, ttlMs: 10 * MINUTE })
  const matches = new TtlCache<BridgeManga | null>({ maxEntries: 5000, ttlMs: 6 * HOUR })

  const activeSources = () =>
    sourceCache.getOrLoad(
      'all',
      async () => {
        const all = await client.listSources()
        const eligible = all
          .filter((source): source is ActiveSource => languages.has(source.lang))
          .filter((source) => options.includeNsfw || !source.isNsfw)
          .filter((source) => wanted.size === 0 || wanted.has(source.id) || wanted.has(normalizeTitle(source.name)))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        if (eligible.length > options.maxSources) {
          log(`${eligible.length} sites éligibles, ${options.maxSources} interrogés (TACHIYOMI_BRIDGE_MAX_SOURCES)`)
        }
        const selected = eligible.slice(0, options.maxSources)
        log(`${selected.length} site(s) actif(s) : ${selected.map((source) => `${source.name} (${source.lang})`).join(', ') || 'aucun'}`)
        return selected
      },
      // Aucune extension encore installée (démarrage du pont) : on revérifie vite.
      (selected) => (selected.length === 0 ? MINUTE : 10 * MINUTE),
    )

  /**
   * Œuvre MangaDex → œuvre chez ce site. Les requêtes (titres MangaDex de
   * toutes langues) partent ensemble ; le meilleur résultat au-dessus de 80 % est
   * retenu (`bestTitleMatch`). Une absence tient 30 min, une correspondance
   * 6 h ; un échec (délai, panne) n'est jamais retenu comme une absence.
   */
  const resolveManga = (source: ActiveSource, mangaId: string, aliases: string[]) =>
    matches.getOrLoad(
      `${source.id}:${mangaId}`,
      async () => {
        const queries = searchQueries(aliases, QUERIES_PER_SOURCE)
        const settled = await Promise.allSettled(queries.map((query) => client.searchManga(source.id, query)))
        const results = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
        const match = bestTitleMatch(results, aliases, (manga) => [manga.title])
        if (match) {
          log(`${source.name} : « ${match.title} » retenu (${Math.round(match.score * 100)} %)`)
          return match.candidate
        }
        const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failure) throw failure.reason
        log(`${source.name} : aucune correspondance pour « ${aliases[0] ?? '?'} » (${results.length} résultat(s))`)
        return null
      },
      (found) => (found === null ? HOUR / 2 : 6 * HOUR),
    )

  return {
    id: 'tachiyomi',
    name: 'Tachiyomi',
    baseUrl: client.baseUrl,
    supportedLanguages: [...languages] as Language[],
    // Sites de scantrad : après MangaDex (équipes créditées) et les bibliothèques personnelles.
    priority: 20,
    // Trois étapes au plus (sites, recherche, chapitres), chacune bornée par le délai d'un appel.
    timeoutMs: 3 * options.timeoutMs + 1_000,
    usesAliases: true,
    activeSources,
    forgetSources: () => sourceCache.delete('all'),

    async fetchChapterList(mangaId, titleAliases) {
      if (titleAliases.length === 0) return []
      const sources = await activeSources()
      if (sources.length === 0) return []

      const settled = await Promise.allSettled(
        sources.map(async (source) => {
          const manga = await resolveManga(source, mangaId, titleAliases)
          if (!manga) return []
          const chapters = await client.fetchChapters(manga.id)
          return chapters.map((chapter) => normalizeBridgeChapter(chapter, source))
        }),
      )

      const chapters: NormalizedChapter[] = []
      const failures: string[] = []
      settled.forEach((result, index) => {
        const source = sources[index]!
        if (result.status === 'fulfilled') chapters.push(...result.value)
        else failures.push(`${source.name} : ${describe(result.reason)}`)
      })
      for (const failure of failures) log(failure)
      if (failures.length === sources.length) throw upstreamError(`Aucune extension Tachiyomi ne répond (${failures[0]}).`)
      log(`${mangaId} : ${chapters.length} chapitre(s) depuis ${sources.length - failures.length}/${sources.length} site(s)`)
      return chapters
    },

    async fetchPageUrls(chapterId) {
      if (!/^\d{1,12}$/.test(chapterId)) throw notFound('Chapitre Tachiyomi inconnu.')
      const pages = await client.fetchChapterPages(Number(chapterId))
      if (pages.length === 0) log(`pages du chapitre ${chapterId} -> aucune image`)
      return pages.map((url, index) => ({ index, url }))
    },

    fetchImage: originImageFetcher({
      baseUrl: client.baseUrl,
      headers: () => client.authHeaders(),
      userAgent: options.userAgent,
      timeoutMs: options.imageTimeoutMs ?? 15_000,
    }),
  }
}
