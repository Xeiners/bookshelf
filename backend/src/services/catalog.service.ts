import { prisma } from '../db.js'
import type { Language } from '../lib/language.js'
import type { Book } from '../modules/books/book.schema.js'
import { mangadexGet, type MdCollection, type MdManga, type MdStatistics } from '../modules/manga/mangadex.client.js'
import { INCLUDES, listShelf } from '../modules/manga/manga.service.js'
import { normalizeManga } from '../modules/manga/normalize.js'
import { SHELVES, findShelf } from '../modules/manga/shelves.js'
import { TAG_FR } from '../modules/manga/tags.js'
import { rankDeck, type Candidate, type TagWeight, type TasteProfile, type WorkFeatures } from './recommendation/scoring.js'

/*
 * Catalogue MangaDex, en cache local.
 *
 * - Un indexeur en tâche de fond range dans `CatalogWork` les œuvres les plus
 *   suivies de MangaDex (par langue d'origine) et les mieux notées, avec leurs
 *   statistiques (suivis, note bayésienne) et leurs tags (genres, thèmes).
 * - Le pool est ensuite chargé en mémoire : composer un deck, chercher ou
 *   tirer l'Oracle ne fait AUCUN appel réseau.
 *
 * Une ligne par œuvre MangaDex (clé primaire : son UUID).
 */

export type DeckOrigin = 'all' | 'manga' | 'manhwa' | 'manhua'

const ORIGIN_COUNTRIES: Record<DeckOrigin, readonly string[] | null> = {
  all: null,
  manga: ['JP'],
  manhwa: ['KR'],
  manhua: ['CN'],
}

/** Langue originale MangaDex → pays d'origine (manga, manhwa, manhua). */
const COUNTRY_OF_LANGUAGE: Record<string, string> = { 'ja': 'JP', 'ko': 'KR', 'zh': 'CN', 'zh-hk': 'CN' }

export const countryOf = (originalLanguage: string): string | null => COUNTRY_OF_LANGUAGE[originalLanguage] ?? null

/** Étagères du deck → filtre sur les genres / thèmes MangaDex (noms anglais). */
interface DeckShelf {
  genre?: string
  tag?: string
  sort?: 'match' | 'popularity'
  /** Anciennes étagères « Manga » / « Manhwa » : ce sont des filtres d'origine. */
  origin?: DeckOrigin
}

export const DECK_SHELVES: Record<string, DeckShelf> = {
  'pour-toi': {},
  'tendances': { sort: 'popularity' },
  'manga': { origin: 'manga' },
  'manhwa': { origin: 'manhwa' },
  'action': { genre: 'Action' },
  'romance': { genre: 'Romance' },
  'fantasy': { genre: 'Fantasy' },
  'isekai': { genre: 'Isekai' },
  'tranche-de-vie': { genre: 'Slice of Life' },
  'comedie': { genre: 'Comedy' },
  'mystere': { genre: 'Mystery' },
  'horreur': { genre: 'Horror' },
  'psychologique': { genre: 'Psychological' },
  'arts-martiaux': { tag: 'Martial Arts' },
  'sport': { genre: 'Sports' },
}

/* ---- Caractéristiques ------------------------------------------------------ */

/**
 * Tags MangaDex → caractéristiques du moteur : les genres d'un côté, les
 * thèmes de l'autre. MangaDex ne pondère pas ses tags : chacun compte plein
 * (100 %). Les tags de format (« Long Strip ») et de contenu sont ignorés.
 */
export function featuresOfManga(manga: MdManga, rating: number | null): WorkFeatures {
  const genres: string[] = []
  const tags: TagWeight[] = []
  for (const tag of manga.attributes.tags) {
    const name = tag.attributes.name.en
    if (!name) continue
    if (tag.attributes.group === 'genre') genres.push(name)
    else if (tag.attributes.group === 'theme') tags.push({ name, rank: 100 })
  }
  return { genres, tags, meanScore: rating === null ? null : Math.round(rating * 10) }
}

/* ---- Pool en mémoire ------------------------------------------------------ */

export interface CatalogItem extends Candidate {
  mangadexId: string
  country: string
  /** Note bayésienne MangaDex (/10). */
  rating: number | null
  /** Statut MangaDex (ongoing, completed…), dernier chapitre, année : filtres de recherche et rythme de l'Oracle. */
  status: string | null
  chapters: number | null
  year: number | null
  /** Titres et auteurs normalisés (cf. `normalizeText`). */
  searchText: string
}

interface Pool {
  items: CatalogItem[]
  byId: Map<string, CatalogItem>
  loadedAt: number
}

const POOL_TTL_MS = 60_000
/** Pendant l'indexation, le pool suit les écritures — mais pas plus d'une fois toutes les 15 s. */
const STALE_RELOAD_MS = 15_000
let pool: Pool | null = null
let reloading: Promise<Pool> | null = null
let stale = false

const parseJson = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * Charge le pool SANS les fiches JSON : ~100 octets par œuvre au lieu de
 * plusieurs Ko. Le pilote SQLite est synchrone, un rechargement léger ne
 * bloque donc jamais un swipe plus de quelques millisecondes.
 */
async function loadPool(): Promise<Pool> {
  const rows = await prisma.catalogWork.findMany({
    select: {
      mangadexId: true,
      country: true,
      rating: true,
      popularity: true,
      genres: true,
      tags: true,
      status: true,
      chapters: true,
      year: true,
      searchText: true,
    },
  })
  const items: CatalogItem[] = rows.map((row) => ({
    key: row.mangadexId,
    ids: [row.mangadexId],
    mangadexId: row.mangadexId,
    country: row.country,
    popularity: row.popularity,
    features: {
      genres: parseJson<string[]>(row.genres, []),
      tags: parseJson<TagWeight[]>(row.tags, []),
      meanScore: row.rating === null ? null : Math.round(row.rating * 10),
    },
    rating: row.rating,
    status: row.status,
    chapters: row.chapters,
    year: row.year,
    searchText: row.searchText,
  }))
  return { items, byId: new Map(items.map((item) => [item.mangadexId, item])), loadedAt: Date.now() }
}

/** Recharge le pool et l'attend (tests, fin d'indexation). */
export async function reloadPool(): Promise<Pool> {
  stale = false
  reloading ??= loadPool()
    .then((fresh) => (pool = fresh))
    .finally(() => (reloading = null))
  return reloading
}

/**
 * Pool courant. Périmé : servi tel quel pendant qu'un rechargement part en
 * arrière-plan (le swipe ne l'attend jamais). Absent : chargé une fois.
 */
export async function getPool(): Promise<Pool> {
  if (!pool) return reloadPool()
  const age = Date.now() - pool.loadedAt
  if (age > POOL_TTL_MS || (stale && age > STALE_RELOAD_MS)) void reloadPool().catch(() => undefined)
  return pool
}

/** L'indexeur vient d'écrire : un prochain accès rechargera, en arrière-plan. */
function markPoolStale(): void {
  stale = true
}

/** Fiches MangaDex complètes des œuvres servies, en une requête. */
export async function loadDocuments(items: readonly CatalogItem[]): Promise<Map<string, MdManga>> {
  if (items.length === 0) return new Map()
  const rows = await prisma.catalogWork.findMany({
    where: { mangadexId: { in: items.map((item) => item.mangadexId) } },
    select: { mangadexId: true, mangadex: true },
  })
  const documents = new Map<string, MdManga>()
  for (const row of rows) {
    const manga = parseJson<MdManga | null>(row.mangadex, null)
    if (manga) documents.set(row.mangadexId, manga)
  }
  return documents
}

export async function findWork(id: string): Promise<CatalogItem | undefined> {
  return (await getPool()).byId.get(id)
}

/** Œuvre du catalogue → `Book` du front, dans la langue demandée. */
export function toBook(item: CatalogItem, language: Language, manga: MdManga): Book {
  return normalizeManga(manga, item.rating, language)
}

/**
 * Œuvres servies, dans l'ordre demandé, avec leur fiche. Une œuvre dont la
 * fiche manque (ligne supprimée entre-temps) est simplement sautée.
 */
export async function booksFor<T extends { item: CatalogItem }>(
  entries: readonly T[],
  language: Language,
): Promise<(T & { book: Book })[]> {
  const documents = await loadDocuments(entries.map((entry) => entry.item))
  return entries.flatMap((entry) => {
    const manga = documents.get(entry.item.mangadexId)
    return manga ? [{ ...entry, book: toBook(entry.item, language, manga) }] : []
  })
}

/* ---- Profil d'une œuvre hors catalogue ------------------------------------- */

/** Genres MangaDex (le reste est traité comme un thème). */
const MANGADEX_GENRES = new Set([
  'Action', 'Adventure', "Boys' Love", 'Comedy', 'Crime', 'Drama', 'Fantasy', "Girls' Love", 'Historical', 'Horror',
  'Isekai', 'Magical Girls', 'Mecha', 'Medical', 'Mystery', 'Philosophical', 'Psychological', 'Romance', 'Sci-Fi',
  'Slice of Life', 'Sports', 'Superhero', 'Thriller', 'Tragedy', 'Wuxia',
])
const ENGLISH_BY_FRENCH = new Map(Object.entries(TAG_FR).map(([english, french]) => [french, english]))

/**
 * Caractéristiques déduites d'un `Book` seul (œuvre trouvée via la recherche
 * MangaDex, absente du catalogue) : ses libellés, ramenés aux noms anglais.
 */
export function featuresFromBook(book: Pick<Book, 'categories' | 'rating'>): WorkFeatures {
  const genres: string[] = []
  const tags: TagWeight[] = []
  for (const label of book.categories) {
    const english = TAG_FR[label] !== undefined ? label : ENGLISH_BY_FRENCH.get(label)
    if (!english) continue
    if (MANGADEX_GENRES.has(english)) genres.push(english)
    else tags.push({ name: english, rank: 100 })
  }
  return { genres, tags, meanScore: book.rating === null ? null : Math.round(book.rating * 20) }
}

/* ---- Deck ------------------------------------------------------------------ */

export type DeckBook = Book & { matchPercentage: number; discovery: boolean }

export interface DeckRequest {
  shelf: string
  origin: DeckOrigin
  language: Language
  limit: number
  excluded: ReadonlySet<string>
  profile: TasteProfile
  random?: () => number
}

export interface DeckPage {
  books: DeckBook[]
  hasMore: boolean
  /** `catalog` : catalogue en cache ; `mangadex` : repli pendant la toute première indexation. */
  source: 'catalog' | 'mangadex'
}

/** En dessous, le catalogue est trop maigre (première indexation en cours) : repli MangaDex. */
const MIN_CATALOG = 40

export async function composeDeck(request: DeckRequest): Promise<DeckPage> {
  let current = await getPool()
  if (current.items.length < MIN_CATALOG && syncEnabled) {
    // Tout premier lancement : on laisse quelques secondes à la première vague.
    await Promise.race([firstWave, new Promise((resolve) => setTimeout(resolve, 8000))])
    current = await reloadPool()
  }
  if (current.items.length < MIN_CATALOG) return mangadexDeck(request)

  const shelf = DECK_SHELVES[request.shelf] ?? {}
  const countries = ORIGIN_COUNTRIES[shelf.origin ?? request.origin]
  const candidates = current.items.filter(
    (item) =>
      (!countries || countries.includes(item.country)) &&
      (!shelf.genre || item.features.genres.includes(shelf.genre)) &&
      (!shelf.tag || item.features.tags.some((tag) => tag.name === shelf.tag)),
  )

  // Un de plus que demandé : sait s'il reste des cartes sans deuxième passe.
  const ranked = rankDeck(candidates, request.profile, {
    excluded: request.excluded,
    limit: request.limit + 1,
    sort: shelf.sort,
    random: request.random,
  })

  const served = await booksFor(
    ranked.slice(0, request.limit).map((entry) => ({ ...entry, item: entry.candidate })),
    request.language,
  )
  return {
    books: served.map(({ book, matchPercentage, discovery }) => ({ ...book, matchPercentage, discovery })),
    hasMore: ranked.length > request.limit,
    source: 'catalog',
  }
}

/** Repli : l'étagère MangaDex équivalente, notée par le même moteur. */
async function mangadexDeck(request: DeckRequest): Promise<DeckPage> {
  const shelfId = request.shelf === 'pour-toi' ? (request.origin === 'all' ? 'tendances' : request.origin) : request.shelf
  const shelf = findShelf(shelfId) ?? SHELVES[0]!
  const page = 1 + Math.floor((request.random ?? Math.random)() * 6)
  const { books } = await listShelf(shelf, page, 24, request.language)

  const ranked = rankDeck(
    books.map((book) => ({ key: book.id, ids: [book.id], popularity: 0, features: featuresFromBook(book), book })),
    request.profile,
    { excluded: request.excluded, limit: request.limit, random: request.random },
  )
  return {
    books: ranked.map(({ candidate, matchPercentage, discovery }) => ({ ...candidate.book, matchPercentage, discovery })),
    hasMore: true,
    source: 'mangadex',
  }
}

/* ---- Indexeur ---------------------------------------------------------------
 * Environ 3 000 œuvres : les plus suivies sur MangaDex par langue d'origine
 * (japonais, coréen, chinois), puis les mieux notées toutes origines
 * confondues. Une quarantaine de requêtes, espacées par le limiteur de débit
 * MangaDex : moins d'une minute, en arrière-plan. Resynchronisation quotidienne.
 */

const INDEX_PLAN: { languages: string[]; pages: number }[] = [
  { languages: ['ja'], pages: 16 },
  { languages: ['ko'], pages: 9 },
  { languages: ['zh', 'zh-hk'], pages: 5 },
]
const TOP_RATED_PAGES = 3
const PAGE_SIZE = 100
/** Ids par appel `/statistics/manga`. */
const STATISTICS_BATCH = 100
const RESYNC_MS = 24 * 60 * 60 * 1000
const SYNC_ID = 'catalog'

let syncEnabled = false
let resolveFirstWave: () => void = () => {}
/** Résolue quand la première vague (une page par origine) est en base. */
let firstWave: Promise<void> = Promise.resolve()
let running: Promise<void> | null = null

/**
 * Texte de recherche : minuscules, sans accents ni ponctuation. « Kimetsu no
 * Yaiba », « Demon Slayer » et « 鬼滅の刃 » trouvent la même œuvre, tout comme
 * le nom de l'auteur.
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Titres MangaDex (toutes langues, titres alternatifs) et auteurs. */
export function searchTextOf(manga: MdManga): string {
  const parts = new Set<string>()
  const add = (value: string | null | undefined) => {
    const text = value ? normalizeText(value) : ''
    if (text) parts.add(text)
  }
  for (const record of [manga.attributes.title, ...manga.attributes.altTitles]) for (const value of Object.values(record)) add(value)
  for (const relation of manga.relationships) add(relation.attributes?.name)
  return [...parts].join(' | ')
}

/** Dernier chapitre connu, en nombre entier ; `null` si MangaDex ne le donne pas. */
function chapterCount(lastChapter: string | null): number | null {
  const value = Number.parseFloat(lastChapter ?? '')
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null
}

export interface WorkStatistics {
  follows: number
  rating: number | null
}

/** Suivis et note bayésienne, par lots de 100 ids. */
export async function statisticsFor(ids: readonly string[]): Promise<Map<string, WorkStatistics>> {
  const result = new Map<string, WorkStatistics>()
  for (let start = 0; start < ids.length; start += STATISTICS_BATCH) {
    const batch = ids.slice(start, start + STATISTICS_BATCH)
    const payload = await mangadexGet<MdStatistics>('/statistics/manga', { manga: batch })
    for (const id of batch) {
      const stats = payload.statistics[id]
      result.set(id, { follows: stats?.follows ?? 0, rating: stats?.rating?.bayesian ?? null })
    }
  }
  return result
}

const INDEXED_RATINGS = new Set(['safe', 'suggestive'])

/**
 * Range des œuvres MangaDex au catalogue (upserts idempotents). Écartées :
 * les origines hors manga / manhwa / manhua, et le contenu adulte.
 */
export async function upsertWorks(mangas: readonly MdManga[], statistics: ReadonlyMap<string, WorkStatistics>): Promise<number> {
  const usable = mangas.filter(
    (manga) => countryOf(manga.attributes.originalLanguage) !== null && INDEXED_RATINGS.has(manga.attributes.contentRating),
  )
  if (usable.length === 0) return 0

  await prisma.$transaction(
    usable.map((manga) => {
      const stats = statistics.get(manga.id)
      const rating = stats?.rating ?? null
      const { genres, tags } = featuresOfManga(manga, rating)
      const data = {
        country: countryOf(manga.attributes.originalLanguage)!,
        rating,
        popularity: stats?.follows ?? 0,
        genres: JSON.stringify(genres),
        tags: JSON.stringify(tags),
        mangadex: JSON.stringify(manga),
        status: manga.attributes.status,
        chapters: chapterCount(manga.attributes.lastChapter),
        year: manga.attributes.year,
        searchText: searchTextOf(manga),
      }
      return prisma.catalogWork.upsert({
        where: { mangadexId: manga.id },
        create: { mangadexId: manga.id, ...data },
        update: data,
      })
    }),
  )
  markPoolStale()
  return usable.length
}

type PageOrder = 'followedCount' | 'rating'

async function mangadexPage(languages: string[], order: PageOrder, page: number): Promise<MdManga[]> {
  const payload = await mangadexGet<MdCollection<MdManga>>('/manga', {
    'includes': INCLUDES,
    'originalLanguage': languages,
    'availableTranslatedLanguage': ['fr', 'en'],
    'contentRating': [...INDEXED_RATINGS],
    [`order[${order}]`]: 'desc',
    'limit': PAGE_SIZE,
    'offset': (page - 1) * PAGE_SIZE,
  })
  return payload.data
}

type Task = () => Promise<void>

/** Une étape qui échoue est journalisée et sautée : l'indexation continue. */
async function runTasks(tasks: Task[], label: string): Promise<void> {
  let failures = 0
  for (const task of tasks) {
    try {
      await task()
      failures = 0
    } catch (error) {
      failures += 1
      console.warn(`[catalogue] ${label} : étape ignorée —`, error instanceof Error ? error.message : error)
      // Source injoignable (plusieurs échecs d'affilée) : on réessaiera au prochain cycle.
      if (failures >= 3) throw new Error(`${label} : source injoignable`)
    }
  }
}

export async function syncCatalog(): Promise<void> {
  const startedAt = Date.now()
  const indexPage = (languages: string[], order: PageOrder, page: number): Task => async () => {
    const mangas = await mangadexPage(languages, order, page)
    await upsertWorks(mangas, await statisticsFor(mangas.map((manga) => manga.id)))
  }
  const allLanguages = INDEX_PLAN.flatMap((plan) => plan.languages)

  try {
    // 1. Première vague : de quoi composer un deck dans chaque origine.
    await runTasks(INDEX_PLAN.map(({ languages }) => indexPage(languages, 'followedCount', 1)), 'MangaDex')
    resolveFirstWave()

    // 2. Le reste, origines entrelacées : le catalogue grossit uniformément.
    const depth = Math.max(...INDEX_PLAN.map((plan) => plan.pages))
    const rest: Task[] = []
    for (let page = 2; page <= depth; page += 1) {
      for (const plan of INDEX_PLAN) if (page <= plan.pages) rest.push(indexPage(plan.languages, 'followedCount', page))
    }
    for (let page = 1; page <= TOP_RATED_PAGES; page += 1) rest.push(indexPage(allLanguages, 'rating', page))
    await runTasks(rest, 'MangaDex')

    // Seule une indexation menée à son terme est enregistrée comme fraîche.
    const completedAt = new Date()
    await prisma.catalogSync.upsert({ where: { id: SYNC_ID }, create: { id: SYNC_ID, completedAt }, update: { completedAt } })
    console.log(`[catalogue] ${await prisma.catalogWork.count()} œuvres en ${Math.round((Date.now() - startedAt) / 1000)} s`)
  } finally {
    resolveFirstWave()
    await reloadPool()
  }
}

/**
 * Lance l'indexation si la dernière indexation COMPLÈTE date de plus de 24 h
 * (ou n'a jamais abouti), puis chaque jour. Une indexation interrompue par un
 * redémarrage reprend donc au démarrage suivant ; les écritures sont
 * idempotentes (upserts). Appelée au démarrage du serveur, jamais en test.
 */
export function startCatalogSync(): void {
  syncEnabled = true
  firstWave = new Promise((resolve) => (resolveFirstWave = resolve))

  const cycle = async () => {
    if (running) return
    const [count, last] = await Promise.all([
      prisma.catalogWork.count(),
      prisma.catalogSync.findUnique({ where: { id: SYNC_ID } }),
    ])
    const fresh = count > 0 && last !== null && Date.now() - last.completedAt.getTime() < RESYNC_MS
    if (fresh) {
      resolveFirstWave()
      console.log(`[catalogue] ${count} œuvres en cache, à jour.`)
      return
    }
    running = syncCatalog()
      .catch((error: unknown) => console.warn('[catalogue] indexation interrompue :', error))
      .finally(() => (running = null))
  }

  void cycle().catch((error: unknown) => console.warn('[catalogue]', error))
  setInterval(() => void cycle().catch(() => undefined), RESYNC_MS).unref()
}
