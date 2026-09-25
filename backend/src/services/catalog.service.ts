import { prisma } from '../db.js'
import type { Language } from '../lib/language.js'
import type { Book } from '../modules/books/book.schema.js'
import { mangadexGet, type MdCollection, type MdManga } from '../modules/manga/mangadex.client.js'
import { INCLUDES, listShelf, ratingsFor } from '../modules/manga/manga.service.js'
import { normalizeManga } from '../modules/manga/normalize.js'
import { SHELVES, findShelf } from '../modules/manga/shelves.js'
import { TAG_FR } from '../modules/manga/tags.js'
import {
  anilistBook,
  categoriesOf,
  cleanAnilistDescription,
  toStoredAnilist,
  usableTags,
  type StoredAnilist,
} from './anilist.normalize.js'
import { fetchMediaByIds, fetchMediaPage, type AlCountry, type AlMedia } from './anilist.service.js'
import { rankDeck, type Candidate, type TagWeight, type TasteProfile, type WorkFeatures } from './recommendation/scoring.js'

/*
 * Catalogue agrégé AniList + MangaDex.
 *
 * - AniList fournit l'ensemble des œuvres et leurs métadonnées riches.
 * - MangaDex fournit, quand l'œuvre y existe, les textes FR/EN, la couverture
 *   et la lecture. La jointure se fait par `links.al` (id AniList) côté MangaDex.
 * - Tout est rangé dans `CatalogWork` (SQLite) par un indexeur en tâche de fond,
 *   puis chargé en mémoire : composer un deck ne fait AUCUN appel réseau.
 *
 * Dédoublonnage : une ligne par id AniList, et `mangadexId` est unique — deux
 * fiches MangaDex d'une même œuvre (ça arrive) ne donnent jamais deux cartes.
 */

export type DeckOrigin = 'all' | 'manga' | 'manhwa' | 'manhua'

const ORIGIN_COUNTRIES: Record<DeckOrigin, readonly string[] | null> = {
  all: null,
  manga: ['JP'],
  manhwa: ['KR'],
  manhua: ['CN', 'TW'],
}

/** Étagères du deck → filtre sur les genres / tags AniList. */
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
  'isekai': { tag: 'Isekai' },
  'tranche-de-vie': { genre: 'Slice of Life' },
  'comedie': { genre: 'Comedy' },
  'mystere': { genre: 'Mystery' },
  'horreur': { genre: 'Horror' },
  'psychologique': { genre: 'Psychological' },
  'arts-martiaux': { tag: 'Martial Arts' },
  'sport': { genre: 'Sports' },
}

/* ---- Pool en mémoire ------------------------------------------------------ */

export interface CatalogItem extends Candidate {
  anilistId: number
  mangadexId: string | null
  /** Id servi au front : UUID MangaDex, sinon `al-<id>`. */
  bookId: string
  country: string
  mdRating: number | null
  /** Statut AniList (FINISHED, RELEASING…), chapitres, année : filtres de recherche et rythme de l'Oracle. */
  status: string | null
  chapters: number | null
  year: number | null
  /** Titres et auteurs normalisés (cf. `normalizeText`). */
  searchText: string
}

/**
 * Fiches complètes (JSON AniList et MangaDex) : volumineuses, elles restent en
 * base et ne sont lues que pour les cartes effectivement servies.
 */
export interface CatalogDocuments {
  anilist: string
  mangadex: string | null
}

interface Pool {
  items: CatalogItem[]
  /** Toute forme d'id (UUID MangaDex, `al-<id>`) → œuvre. */
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
      anilistId: true,
      mangadexId: true,
      country: true,
      meanScore: true,
      popularity: true,
      genres: true,
      tags: true,
      mdRating: true,
      status: true,
      chapters: true,
      year: true,
      searchText: true,
    },
  })
  const items: CatalogItem[] = []
  const byId = new Map<string, CatalogItem>()

  for (const row of rows) {
    const alias = `al-${row.anilistId}`
    const item: CatalogItem = {
      key: row.anilistId,
      anilistId: row.anilistId,
      mangadexId: row.mangadexId,
      bookId: row.mangadexId ?? alias,
      ids: row.mangadexId ? [row.mangadexId, alias] : [alias],
      country: row.country,
      popularity: row.popularity,
      features: {
        genres: parseJson<string[]>(row.genres, []),
        tags: parseJson<TagWeight[]>(row.tags, []),
        meanScore: row.meanScore,
      },
      mdRating: row.mdRating,
      status: row.status,
      chapters: row.chapters,
      year: row.year,
      searchText: row.searchText,
    }
    items.push(item)
    for (const id of item.ids) byId.set(id, item)
  }

  return { items, byId, loadedAt: Date.now() }
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

/** Fiches complètes des œuvres servies, en une requête. */
export async function loadDocuments(items: readonly CatalogItem[]): Promise<Map<number, CatalogDocuments>> {
  if (items.length === 0) return new Map()
  const rows = await prisma.catalogWork.findMany({
    where: { anilistId: { in: items.map((item) => item.anilistId) } },
    select: { anilistId: true, anilist: true, mangadex: true },
  })
  return new Map(rows.map((row) => [row.anilistId, { anilist: row.anilist, mangadex: row.mangadex }]))
}

/** Une seule fiche `Book` (page détail d'une œuvre AniList). */
export async function bookFor(item: CatalogItem, language: Language): Promise<Book> {
  const documents = await loadDocuments([item])
  return toBook(item, language, documents.get(item.anilistId))
}

/** Œuvre du catalogue pour un id quelconque (MangaDex ou `al-<id>`). */
export async function findWork(id: string): Promise<CatalogItem | undefined> {
  return (await getPool()).byId.get(id)
}

/* ---- Fiche servie au front ------------------------------------------------- */

/** MangaDex connaît-il un titre français ou anglais (ou une romanisation) pour l'œuvre ? */
function hasReadableTitle(md: MdManga): boolean {
  const records = [md.attributes.title, ...md.attributes.altTitles]
  return records.some((record) => ['fr', 'en', 'ja-ro', 'ko-ro', 'zh-ro'].some((code) => Boolean(record[code]?.trim())))
}

/**
 * Œuvre liée à MangaDex : textes MangaDex (FR/EN) avec l'id MangaDex, pour que
 * bibliothèque, traduction et lecture continuent de fonctionner. Sinon : fiche
 * AniList (id `al-<id>`, textes anglais).
 */
export function toBook(item: CatalogItem, language: Language, documents: CatalogDocuments | undefined): Book {
  const stored = documents ? parseJson<StoredAnilist | null>(documents.anilist, null) : null
  const { genres, tags, meanScore } = item.features

  const md = documents?.mangadex ? parseJson<MdManga | null>(documents.mangadex, null) : null
  if (md) {
    const book = normalizeManga(md, item.mdRating, language)
    const description = cleanAnilistDescription(stored?.description ?? null)
    // Pas de titre FR/EN sur MangaDex (repli sur une autre langue) : le titre AniList est plus parlant.
    const anilistTitle = stored?.title.english ?? stored?.title.romaji
    const retitled = !hasReadableTitle(md) && anilistTitle ? { title: anilistTitle, subtitle: book.title } : {}
    return {
      ...book,
      ...retitled,
      // Note AniList d'abord : c'est elle que trient et filtrent la recherche et
      // le moteur. La note MangaDex ne sert que si AniList n'en a pas.
      rating: meanScore === null ? book.rating : Math.round(meanScore / 2) / 10,
      categories: book.categories.length > 0 ? book.categories : categoriesOf(genres, tags, language),
      ...(!book.synopsis && description && { synopsis: description, synopsisLanguage: 'en' as const }),
    }
  }

  const fallback: StoredAnilist = stored ?? {
    title: { romaji: null, english: null, native: null },
    description: null,
    cover: null,
    status: null,
    chapters: null,
    year: null,
    siteUrl: `https://anilist.co/manga/${item.anilistId}`,
    authors: [],
  }
  return anilistBook(item.anilistId, fallback, item.country, genres, tags, meanScore, language)
}

/* ---- Profil d'une œuvre hors catalogue ------------------------------------- */

/** Genres AniList (le reste est traité comme un tag). */
const ANILIST_GENRES = new Set([
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music',
  'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
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
    if (ANILIST_GENRES.has(english)) genres.push(english)
    else tags.push({ name: english, rank: 70 })
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
  /** `catalog` : catalogue agrégé ; `mangadex` : repli pendant la toute première indexation. */
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

  const served = ranked.slice(0, request.limit)
  const documents = await loadDocuments(served.map(({ candidate }) => candidate))
  return {
    books: served.map(({ candidate, matchPercentage, discovery }) => ({
      ...toBook(candidate, request.language, documents.get(candidate.anilistId)),
      matchPercentage,
      discovery,
    })),
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
    books.map((book, index) => ({ key: index, ids: [book.id], popularity: 0, features: featuresFromBook(book), book })),
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
 * Environ 3 000 œuvres : les plus populaires par pays sur AniList, les mieux
 * notées, et les plus suivies sur MangaDex (pour la jointure FR/EN). Une
 * cinquantaine de requêtes AniList espacées de 2 s : quelques minutes, en
 * arrière-plan. Resynchronisation quotidienne.
 */

const ANILIST_PLAN: { country: AlCountry; pages: number }[] = [
  { country: 'JP', pages: 24 },
  { country: 'KR', pages: 14 },
  { country: 'CN', pages: 6 },
]
const TOP_RATED_PAGES = 6
const MANGADEX_PLAN: { language: string; pages: number }[] = [
  { language: 'ja', pages: 10 },
  { language: 'ko', pages: 6 },
  { language: 'zh', pages: 3 },
]
const MANGADEX_PAGE_SIZE = 100
const RESYNC_MS = 24 * 60 * 60 * 1000
const SYNC_ID = 'catalog'

let syncEnabled = false
let resolveFirstWave: () => void = () => {}
/** Résolue quand la première vague (une page par pays) est en base. */
let firstWave: Promise<void> = Promise.resolve()
let running: Promise<void> | null = null

/** Œuvres MangaDex dont la fiche AniList manque encore : liées après rattrapage. */
const pendingLinks = new Map<number, MdManga>()

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

/** Titres AniList + MangaDex (toutes langues, titres alternatifs) et auteurs. */
export function searchTextOf(stored: StoredAnilist | null, md: MdManga | null): string {
  const parts = new Set<string>()
  const add = (value: string | null | undefined) => {
    const text = value ? normalizeText(value) : ''
    if (text) parts.add(text)
  }
  if (stored) {
    add(stored.title.english)
    add(stored.title.romaji)
    add(stored.title.native)
    for (const author of stored.authors) add(author)
  }
  if (md) {
    for (const record of [md.attributes.title, ...md.attributes.altTitles]) for (const value of Object.values(record)) add(value)
    for (const relation of md.relationships) add(relation.attributes?.name)
  }
  return [...parts].join(' | ')
}

export async function upsertMedia(media: AlMedia[]): Promise<number> {
  const usable = media.filter(
    (item) => !item.isAdult && (item.format === 'MANGA' || item.format === 'ONE_SHOT') && item.genres.length > 0,
  )
  if (usable.length === 0) return 0

  await prisma.$transaction(
    usable.map((item) => {
      const data = {
        country: item.countryOfOrigin,
        format: item.format ?? 'MANGA',
        meanScore: item.meanScore,
        popularity: item.popularity ?? 0,
        genres: JSON.stringify(item.genres),
        tags: JSON.stringify(usableTags(item)),
        anilist: JSON.stringify(toStoredAnilist(item)),
        status: item.status,
        chapters: item.chapters,
        year: item.startDate.year,
        // Écrasé plus tard, titres MangaDex compris, si l'œuvre est liée.
        searchText: searchTextOf(toStoredAnilist(item), null),
      }
      return prisma.catalogWork.upsert({
        where: { anilistId: item.id },
        create: { anilistId: item.id, ...data },
        update: data,
      })
    }),
  )
  markPoolStale()
  return usable.length
}

const anilistIdOf = (manga: MdManga): number | null => {
  const raw = manga.attributes.links?.al
  const id = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Lie des œuvres MangaDex au catalogue. Les listes arrivent triées par nombre
 * de suivis : en cas de doublon MangaDex, la fiche la plus suivie gagne.
 */
export async function linkMangadex(mangas: MdManga[]): Promise<void> {
  const ratings = await ratingsFor(mangas.map((manga) => manga.id))

  for (const manga of mangas) {
    const anilistId = anilistIdOf(manga)
    if (anilistId === null) continue

    const [row, owner] = await Promise.all([
      prisma.catalogWork.findUnique({ where: { anilistId }, select: { mangadexId: true, anilist: true } }),
      prisma.catalogWork.findUnique({ where: { mangadexId: manga.id }, select: { anilistId: true } }),
    ])
    if (!row) {
      pendingLinks.set(anilistId, manga)
      continue
    }
    // Déjà liée à une autre fiche MangaDex (doublon), ou fiche MangaDex déjà prise : on garde le premier lien.
    if (row.mangadexId && row.mangadexId !== manga.id) continue
    if (owner && owner.anilistId !== anilistId) continue

    await prisma.catalogWork.update({
      where: { anilistId },
      data: {
        mangadexId: manga.id,
        mangadex: JSON.stringify(manga),
        mdRating: ratings.get(manga.id) ?? null,
        searchText: searchTextOf(parseJson<StoredAnilist | null>(row.anilist, null), manga),
      },
    })
  }
  markPoolStale()
}

/** Rattrapage : fiches AniList des œuvres trouvées via MangaDex, puis liaison. */
async function backfillPending(): Promise<void> {
  if (pendingLinks.size === 0) return
  const ids = [...pendingLinks.keys()]
  const media = await fetchMediaByIds(ids)
  await upsertMedia(media)
  const waiting = [...pendingLinks.values()]
  pendingLinks.clear()
  await linkMangadex(waiting)
}

async function mangadexPage(language: string, page: number): Promise<MdManga[]> {
  const payload = await mangadexGet<MdCollection<MdManga>>('/manga', {
    'includes': INCLUDES,
    'originalLanguage': [language],
    'availableTranslatedLanguage': ['fr', 'en'],
    'contentRating': ['safe', 'suggestive'],
    'hasAvailableChapters': 'true',
    'order[followedCount]': 'desc',
    'limit': MANGADEX_PAGE_SIZE,
    'offset': (page - 1) * MANGADEX_PAGE_SIZE,
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
  const anilistPage = (country: AlCountry, page: number): Task => async () => {
    await upsertMedia((await fetchMediaPage({ page, country })).media)
  }
  const mangadexTask = (language: string, page: number): Task => async () => {
    await linkMangadex(await mangadexPage(language, page))
  }

  try {
    // 1. Première vague : de quoi composer un deck dans chaque origine.
    await runTasks(ANILIST_PLAN.map(({ country }) => anilistPage(country, 1)), 'AniList')
    resolveFirstWave()
    await runTasks(MANGADEX_PLAN.map(({ language }) => mangadexTask(language, 1)), 'MangaDex')

    // 2. Le reste, pays entrelacés : le catalogue grossit uniformément.
    const depth = Math.max(...ANILIST_PLAN.map((plan) => plan.pages))
    const rest: Task[] = []
    for (let page = 2; page <= depth; page += 1) {
      for (const plan of ANILIST_PLAN) if (page <= plan.pages) rest.push(anilistPage(plan.country, page))
    }
    for (let page = 1; page <= TOP_RATED_PAGES; page += 1) {
      rest.push(async () => {
        await upsertMedia((await fetchMediaPage({ page, sort: 'SCORE_DESC', minScore: 79 })).media)
      })
    }
    await runTasks(rest, 'AniList')

    const links: Task[] = []
    for (const plan of MANGADEX_PLAN) {
      for (let page = 2; page <= plan.pages; page += 1) links.push(mangadexTask(plan.language, page))
    }
    await runTasks(links, 'MangaDex')
    await runTasks([backfillPending], 'AniList (rattrapage)')

    // Seule une indexation menée à son terme est enregistrée comme fraîche.
    const completedAt = new Date()
    await prisma.catalogSync.upsert({ where: { id: SYNC_ID }, create: { id: SYNC_ID, completedAt }, update: { completedAt } })

    const [total, linked] = await Promise.all([
      prisma.catalogWork.count(),
      prisma.catalogWork.count({ where: { mangadexId: { not: null } } }),
    ])
    console.log(
      `[catalogue] ${total} œuvres (${linked} liées à MangaDex) en ${Math.round((Date.now() - startedAt) / 1000)} s`,
    )
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
/**
 * Catalogue indexé avant l'ajout des champs de recherche : on les calcule une
 * fois depuis les fiches JSON déjà en base (aucun appel réseau).
 */
export async function backfillCatalogFields(): Promise<number> {
  const rows = await prisma.catalogWork.findMany({
    where: { searchText: '' },
    select: { anilistId: true, anilist: true, mangadex: true },
  })
  for (let start = 0; start < rows.length; start += 200) {
    await prisma.$transaction(
      rows.slice(start, start + 200).map((row) => {
        const stored = parseJson<StoredAnilist | null>(row.anilist, null)
        const md = row.mangadex ? parseJson<MdManga | null>(row.mangadex, null) : null
        return prisma.catalogWork.update({
          where: { anilistId: row.anilistId },
          data: {
            status: stored?.status ?? null,
            chapters: stored?.chapters ?? null,
            year: stored?.year ?? null,
            searchText: searchTextOf(stored, md) || ' ',
          },
        })
      }),
    )
  }
  if (rows.length > 0) markPoolStale()
  return rows.length
}

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

  void backfillCatalogFields()
    .then((count) => {
      if (count > 0) console.log(`[catalogue] champs de recherche calculés pour ${count} œuvres.`)
    })
    .then(cycle)
    .catch((error: unknown) => console.warn('[catalogue]', error))
  setInterval(() => void cycle().catch(() => undefined), RESYNC_MS).unref()
}
