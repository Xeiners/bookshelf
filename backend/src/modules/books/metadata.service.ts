import { config } from '../../config.js'
import { CircuitBreaker } from '../../extensions/circuitBreaker.js'
import { normalizeTitle } from '../../extensions/titleMatch.js'
import { TtlCache } from '../../lib/cache.js'
import { upstreamError } from '../../lib/errors.js'
import { preferenceOrder, type Language } from '../../lib/language.js'
import {
  OPEN_LIBRARY_FIELDS,
  fromGoogle,
  fromOpenLibrary,
  mergeResults,
  openLibraryDescription,
  pickMatch,
  type GoogleVolume,
  type MetadataSource,
  type NovelMetadata,
  type OpenLibraryDoc,
} from './metadata.normalize.js'
import { decideMatch, type FileIdentity, type MatchDecision } from './epub.match.js'

/**
 * Recherche de romans (FR / EN) sur Open Library et Google Books, interrogés
 * en parallèle puis fusionnés (cf. `metadata.normalize.ts`). Sert la recherche
 * de romans du front et l'enrichissement des EPUB importés.
 *
 * Chaque source a son disjoncteur : Google Books sans clé renvoie vite 429
 * (quota anonyme partagé), il est alors laissé tranquille un moment et Open
 * Library répond seule.
 */

const OPEN_LIBRARY = 'https://openlibrary.org'
const GOOGLE_BOOKS = 'https://www.googleapis.com/books/v1'

const TIMEOUT_MS = 6_000
/** Résultats par source et par langue. */
const PAGE_SIZE = 20
/** Résumés Open Library hydratés au plus par recherche (un appel chacun). */
const HYDRATE_MAX = 6
/** Délai accordé à cette hydratation : au-delà, les fiches partent sans résumé. */
const HYDRATE_BUDGET_MS = 2_500

const searchCache = new TtlCache<NovelMetadata[]>({ maxEntries: 300, ttlMs: 6 * 60 * 60 * 1000 })
const descriptionCache = new TtlCache<string>({ maxEntries: 2_000, ttlMs: 24 * 60 * 60 * 1000 })

const newBreakers = (): Record<MetadataSource, CircuitBreaker> => ({
  openlibrary: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 2 * 60 * 1000 }),
  google: new CircuitBreaker({ failureThreshold: 2, cooldownMs: 10 * 60 * 1000 }),
})
let breakers = newBreakers()

class SourceUnavailable extends Error {}

async function getJson<T>(source: MetadataSource, url: string, signal?: AbortSignal): Promise<T> {
  const breaker = breakers[source]
  if (!breaker.tryAcquire()) throw new SourceUnavailable(`${source} : en pause après des échecs répétés`)
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': config.mangadexUserAgent, Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok) throw new SourceUnavailable(`${source} : HTTP ${response.status}`)
    const body = (await response.json()) as T
    breaker.recordSuccess()
    return body
  } catch (error) {
    // Une recherche abandonnée par l'appelant n'est pas une panne de la source.
    if (signal?.aborted) breaker.recordSuccess()
    else breaker.recordFailure()
    throw error
  }
}

/* ---- Sources --------------------------------------------------------------------- */

async function searchOpenLibrary(query: string, language: Language, signal?: AbortSignal): Promise<NovelMetadata[]> {
  const params = new URLSearchParams({ q: query, fields: OPEN_LIBRARY_FIELDS, limit: String(PAGE_SIZE), lang: language })
  const body = await getJson<{ docs?: OpenLibraryDoc[] }>('openlibrary', `${OPEN_LIBRARY}/search.json?${params}`, signal)
  return (body.docs ?? [])
    .map((doc) => fromOpenLibrary(doc, language))
    .filter((item): item is NovelMetadata => item !== null)
    // Romans lisibles dans l'app : en français, en anglais, ou de langue inconnue.
    .filter((item) => item.language === null || item.language === 'fr' || item.language === 'en')
}

/** `langRestrict` n'accepte qu'une langue : une requête par langue, la voulue d'abord. */
async function searchGoogle(query: string, language: Language, signal?: AbortSignal): Promise<NovelMetadata[]> {
  const lists = await Promise.all(
    preferenceOrder(language).map(async (lang) => {
      const params = new URLSearchParams({ q: query, langRestrict: lang, maxResults: String(PAGE_SIZE), printType: 'books' })
      if (config.books.googleApiKey) params.set('key', config.books.googleApiKey)
      const body = await getJson<{ items?: GoogleVolume[] }>('google', `${GOOGLE_BOOKS}/volumes?${params}`, signal)
      return (body.items ?? []).map(fromGoogle).filter((item): item is NovelMetadata => item !== null)
    }),
  )
  return lists.flat()
}

/** Résumé d'une œuvre Open Library (absent de `search.json`), mis en cache. */
function openLibrarySummary(workId: string, signal?: AbortSignal): Promise<string> {
  return descriptionCache.getOrLoad(workId, async () => {
    const work = await getJson<{ description?: string | { value?: string } }>('openlibrary', `${OPEN_LIBRARY}/works/${workId}.json`, signal)
    return openLibraryDescription(work)
  })
}

/** Complète les résumés manquants des premières fiches, dans le budget imparti. */
async function hydrateSummaries(items: NovelMetadata[], signal?: AbortSignal): Promise<NovelMetadata[]> {
  const targets = items.filter((item) => !item.synopsis && item.refs.openlibrary).slice(0, HYDRATE_MAX)
  if (targets.length === 0) return items
  const summaries = new Map<string, string>()
  const work = Promise.allSettled(
    targets.map(async (item) => {
      const summary = await openLibrarySummary(item.refs.openlibrary!, signal)
      if (summary) summaries.set(item.id, summary)
    }),
  )
  let timer: NodeJS.Timeout | undefined
  await Promise.race([work, new Promise((resolve) => (timer = setTimeout(resolve, HYDRATE_BUDGET_MS)))])
  clearTimeout(timer)
  return items.map((item) => (summaries.has(item.id) ? { ...item, synopsis: summaries.get(item.id)! } : item))
}

/* ---- Points d'entrée ---------------------------------------------------------------- */

/**
 * Romans correspondant à `query` (titre, auteur, ISBN), fiches des deux
 * sources fusionnées, la langue voulue d'abord. Une source en panne n'empêche
 * pas l'autre de répondre ; les deux en panne → 502.
 */
export function searchNovels(query: string, language: Language, signal?: AbortSignal): Promise<NovelMetadata[]> {
  const key = `${language}:${normalizeTitle(query)}`
  let partial = false
  return searchCache.getOrLoad(
    key,
    async () => {
      const [openLibrary, google] = await Promise.allSettled([
        searchOpenLibrary(query, language, signal),
        searchGoogle(query, language, signal),
      ])
      if (openLibrary.status === 'rejected' && google.status === 'rejected') {
        console.warn(`[livres] recherche « ${query} » : aucune source ne répond (${String(openLibrary.reason)} · ${String(google.reason)})`)
        throw upstreamError('Les catalogues de livres ne répondent pas.')
      }
      partial = openLibrary.status === 'rejected' || google.status === 'rejected'
      const lists = [openLibrary, google].map((result) => (result.status === 'fulfilled' ? result.value : []))
      return hydrateSummaries(mergeResults(lists, query, language), signal)
    },
    // Une réponse amputée d'une source est gardée peu de temps : elle doit pouvoir se compléter.
    () => (partial ? 5 * 60 * 1000 : 6 * 60 * 60 * 1000),
  )
}

export interface NovelMatch {
  /** Rattachement proposé pour le fichier (cf. `epub.match.ts`). */
  decision: MatchDecision
  /**
   * Fiche qui complète les métadonnées du fichier (résumé, couverture HD,
   * pagination, parution) : la fiche retenue, sinon un rapprochement sûr
   * (même titre ET même auteur, cf. `pickMatch`), sinon `null`.
   */
  enrich: NovelMetadata | null
}

const NO_MATCH: NovelMatch = { decision: { kind: 'none' }, enrich: null }

/**
 * Fiches en ligne d'un EPUB importé, en une seule recherche : décision de
 * rattachement et fiche d'enrichissement. Recherche coupée, sources en panne
 * ou délai dépassé → aucune fiche (le livre garde celle tirée du fichier, et
 * pourra être rattaché plus tard depuis sa fiche).
 */
export async function matchNovel(file: FileIdentity, language: Language, timeoutMs = 5_000): Promise<NovelMatch> {
  if (!config.books.metadataLookup) return NO_MATCH
  const signal = AbortSignal.timeout(timeoutMs)
  const surname = file.author?.split(',')[0]?.trim().split(/\s+/).pop() ?? ''
  try {
    const results = await searchNovels(`${file.title} ${surname}`.trim(), language, signal)
    const decision = decideMatch(results, file)
    let enrich = decision.kind === 'confident' ? decision.item : pickMatch(results, file)
    if (enrich && !enrich.synopsis && enrich.refs.openlibrary) {
      enrich = { ...enrich, synopsis: await openLibrarySummary(enrich.refs.openlibrary, signal).catch(() => '') }
    }
    return { decision: decision.kind === 'confident' && enrich ? { kind: 'confident', item: enrich } : decision, enrich }
  } catch (error) {
    console.warn(`[livres] fiche introuvable pour « ${file.title} » : ${error instanceof Error ? error.message : String(error)}`)
    return NO_MATCH
  }
}

/* ---- Deck « Romans » --------------------------------------------------------------------- */

/** Fiches demandées à Open Library par page du deck (une partie est écartée : déjà vue, sans couverture). */
const DECK_PAGE = 40
/** Pages lues au plus pour remplir une fournée, quand beaucoup de titres sont déjà vus. */
const DECK_MAX_PAGES = 3

const deckCache = new TtlCache<{ items: NovelMetadata[]; total: number }>({ maxEntries: 300, ttlMs: 6 * 60 * 60 * 1000 })

async function deckPage(query: { q: string; sort: string }, language: Language, offset: number) {
  return deckCache.getOrLoad(`${language}:${query.sort}:${offset}:${query.q}`, async () => {
    const params = new URLSearchParams({
      q: query.q,
      sort: query.sort,
      fields: OPEN_LIBRARY_FIELDS,
      limit: String(DECK_PAGE),
      offset: String(offset),
      lang: language,
    })
    const body = await getJson<{ docs?: OpenLibraryDoc[]; numFound?: number }>('openlibrary', `${OPEN_LIBRARY}/search.json?${params}`)
    const items = (body.docs ?? []).map((doc) => fromOpenLibrary(doc, language)).filter((item): item is NovelMetadata => item !== null)
    return { items, total: body.numFound ?? 0 }
  })
}

/**
 * Une fournée du deck « Romans » : titres de l'étagère, avec couverture,
 * jamais déjà vus ni déjà en bibliothèque. `offset` avance dans le classement
 * d'Open Library ; au besoin, jusqu'à `DECK_MAX_PAGES` pages sont lues pour
 * remplir la fournée.
 */
export async function discoverNovels(options: {
  query: { q: string; sort: string }
  language: Language
  offset: number
  exclude: ReadonlySet<string>
  limit: number
}): Promise<{ books: NovelMetadata[]; hasMore: boolean }> {
  const books: NovelMetadata[] = []
  const taken = new Set<string>()
  let offset = options.offset
  let total = Infinity
  for (let page = 0; page < DECK_MAX_PAGES && books.length < options.limit && offset < total; page += 1) {
    const result = await deckPage(options.query, options.language, offset)
    total = result.total
    offset += DECK_PAGE
    for (const item of result.items) {
      if (!item.cover || options.exclude.has(item.id) || taken.has(item.id)) continue
      taken.add(item.id)
      books.push(item)
    }
  }
  return { books: books.slice(0, options.limit), hasMore: offset < total }
}

/** Résumé d'un roman du deck (`ol:OL…W`), chargé quand sa carte approche. */
export async function novelSummary(id: string): Promise<string> {
  const workId = /^ol:(OL\d+W)$/.exec(id)?.[1]
  return workId ? openLibrarySummary(workId) : ''
}

/** Remet les disjoncteurs et les caches à zéro (tests). */
export function resetMetadataState(): void {
  breakers = newBreakers()
  searchCache.clear()
  descriptionCache.clear()
  deckCache.clear()
}
