import type { Language } from '../lib/language.js'
import { localize, searchMangaRaw } from '../modules/manga/manga.service.js'
import { tagLabel } from '../modules/manga/tags.js'
import {
  featuresFromBook,
  getPool,
  loadDocuments,
  normalizeText,
  toBook,
  type CatalogItem,
  type DeckBook,
  type DeckOrigin,
} from './catalog.service.js'
import { matchPercentage, type TasteProfile } from './recommendation/scoring.js'

/*
 * Recherche et exploration du catalogue agrégé (page « Recherche »).
 *
 * Tout se passe en mémoire sur le pool (≈ 3 000 œuvres) : filtres combinables,
 * recherche plein texte sur les titres de toutes les langues et les auteurs,
 * tri, pagination — puis seules les fiches de la page servie sont lues en base.
 *
 * Une recherche textuelle trop maigre peut être complétée par MangaDex (titres
 * rares absents du catalogue) : c'est une SECONDE requête, que le front lance
 * après avoir affiché les résultats du catalogue — la réponse principale ne
 * dépend jamais du réseau.
 */

export type BrowseSort = 'relevance' | 'popularity' | 'score' | 'recent' | 'match'
export type BrowseStatus = 'any' | 'ongoing' | 'completed'

export interface BrowseRequest {
  query: string
  origin: DeckOrigin
  /** Genres AniList, combinés en ET. */
  genres: string[]
  status: BrowseStatus
  /** Note moyenne minimale sur 100 (0 = pas de filtre). */
  minScore: number
  sort: BrowseSort
  page: number
  limit: number
  language: Language
  profile: TasteProfile
}

export interface BrowsePage {
  books: DeckBook[]
  total: number
  page: number
  hasMore: boolean
  /** Résultats maigres pour une recherche textuelle : le front peut demander le complément MangaDex. */
  supplement: boolean
}

const ORIGIN_COUNTRIES: Record<DeckOrigin, readonly string[] | null> = {
  all: null,
  manga: ['JP'],
  manhwa: ['KR'],
  manhua: ['CN', 'TW'],
}

/** Sous ce nombre de résultats, une recherche textuelle interroge aussi MangaDex. */
const MANGADEX_SUPPLEMENT_BELOW = 8

const STATUS_VALUES: Record<Exclude<BrowseStatus, 'any'>, string> = {
  ongoing: 'RELEASING',
  completed: 'FINISHED',
}

/**
 * Pertinence textuelle : chaque mot doit apparaître. Un titre qui COMMENCE
 * par la requête passe devant, puis les débuts de mots, puis le reste.
 */
export function textRelevance(searchText: string, query: string, tokens: string[]): number {
  if (tokens.length === 0) return 0
  let score = 0
  for (const token of tokens) {
    const index = searchText.indexOf(token)
    if (index < 0) return -1
    const wordStart = index === 0 || searchText[index - 1] === ' ' || searchText[index - 1] === '|'
    score += wordStart ? 3 : 1
  }
  // Titre entier qui commence par la requête (« one piece » → « One Piece »).
  const titles = searchText.split(' | ')
  if (titles.some((title) => title.startsWith(query))) score += 10
  if (titles.some((title) => title === query)) score += 10
  return score
}

function matchesFilters(item: CatalogItem, request: BrowseRequest, countries: readonly string[] | null): boolean {
  if (countries && !countries.includes(item.country)) return false
  if (request.status !== 'any' && item.status !== STATUS_VALUES[request.status]) return false
  if (request.minScore > 0 && (item.features.meanScore ?? 0) < request.minScore) return false
  for (const genre of request.genres) if (!item.features.genres.includes(genre)) return false
  return true
}

export async function browseCatalog(request: BrowseRequest): Promise<BrowsePage> {
  const pool = await getPool()
  const query = normalizeText(request.query)
  const tokens = query ? query.split(' ').filter(Boolean) : []
  const countries = ORIGIN_COUNTRIES[request.origin]

  interface Hit {
    item: CatalogItem
    relevance: number
    match: number
  }
  const hits: Hit[] = []
  for (const item of pool.items) {
    if (!matchesFilters(item, request, countries)) continue
    const relevance = textRelevance(item.searchText, query, tokens)
    if (relevance < 0) continue
    hits.push({ item, relevance, match: matchPercentage(request.profile, item.features) })
  }

  // Sans texte, « pertinence » = popularité : c'est ce qu'on attend d'un catalogue.
  const sort = request.sort === 'relevance' && tokens.length === 0 ? 'popularity' : request.sort
  const byPopularity = (a: Hit, b: Hit) => b.item.popularity - a.item.popularity
  const comparators: Record<BrowseSort, (a: Hit, b: Hit) => number> = {
    relevance: (a, b) => b.relevance - a.relevance || byPopularity(a, b),
    popularity: byPopularity,
    score: (a, b) => (b.item.features.meanScore ?? 0) - (a.item.features.meanScore ?? 0) || byPopularity(a, b),
    recent: (a, b) => (b.item.year ?? 0) - (a.item.year ?? 0) || byPopularity(a, b),
    match: (a, b) => b.match - a.match || (b.item.features.meanScore ?? 0) - (a.item.features.meanScore ?? 0),
  }
  hits.sort(comparators[sort])

  const start = (request.page - 1) * request.limit
  const pageHits = hits.slice(start, start + request.limit)
  const documents = await loadDocuments(pageHits.map((hit) => hit.item))
  const books: DeckBook[] = pageHits.map(({ item, match }) => ({
    ...toBook(item, request.language, documents.get(item.anilistId)),
    matchPercentage: match,
    discovery: false,
  }))

  return {
    books,
    total: hits.length,
    page: request.page,
    hasMore: start + request.limit < hits.length,
    supplement: tokens.length > 0 && request.page === 1 && hits.length < MANGADEX_SUPPLEMENT_BELOW,
  }
}

/**
 * Complément MangaDex d'une recherche textuelle : titres absents du catalogue.
 * Une œuvre que le catalogue connaît déjà (même sous une autre fiche MangaDex,
 * reconnue par son id AniList `links.al`) n'est jamais proposée deux fois.
 */
export async function browseMangadex(request: BrowseRequest): Promise<DeckBook[]> {
  const pool = await getPool()
  const countries = ORIGIN_COUNTRIES[request.origin]
  try {
    const origin = request.origin === 'manga' || request.origin === 'manhwa' ? request.origin : 'all'
    const { mangas } = await searchMangaRaw(request.query, 1, 12, origin, request.language)
    const unknown = mangas.filter((manga) => {
      if (pool.byId.has(manga.id)) return false
      const anilistId = manga.attributes.links?.al
      return !(anilistId && pool.byId.has(`al-${anilistId}`))
    })
    const kinds = countries
      ? new Set<string>(countries.map((country) => (country === 'KR' ? 'manhwa' : country === 'JP' ? 'manga' : 'manhua')))
      : null
    return (await localize(unknown, request.language))
      .filter((book) => !kinds || (book.kind !== undefined && kinds.has(book.kind)))
      .filter((book) => request.minScore === 0 || (book.rating ?? 0) * 20 >= request.minScore)
      .filter((book) => request.genres.every((genre) => featuresFromBook(book).genres.includes(genre)))
      .map((book) => ({ ...book, matchPercentage: matchPercentage(request.profile, featuresFromBook(book)), discovery: false }))
  } catch {
    // MangaDex indisponible : les résultats du catalogue suffisent.
    return []
  }
}

/** Genres AniList proposés comme filtres (le contenu adulte n'en fait pas partie). */
const HIDDEN_GENRES = new Set(['Ecchi', 'Hentai'])
const GENRE_ALIASES: Record<string, string> = { 'Mahou Shoujo': 'Magical Girls' }

export interface GenreFacet {
  /** Nom AniList : la valeur à renvoyer dans `genres`. */
  id: string
  label: string
  count: number
}

/** Genres présents dans le catalogue, libellés dans la langue demandée, les plus fournis d'abord. */
export async function genreFacets(language: Language): Promise<GenreFacet[]> {
  const counts = new Map<string, number>()
  for (const item of (await getPool()).items) {
    for (const genre of item.features.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1)
  }
  return [...counts]
    .filter(([genre]) => !HIDDEN_GENRES.has(genre))
    .map(([genre, count]) => ({
      id: genre,
      label: tagLabel(GENRE_ALIASES[genre] ?? genre, language) ?? genre,
      count,
    }))
    .sort((a, b) => b.count - a.count)
}
