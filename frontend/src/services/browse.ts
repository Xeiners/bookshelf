/**
 * Recherche et exploration du catalogue agrégé (AniList + MangaDex), avec le
 * % de match de chaque titre. Cf. `POST /api/discover/browse`.
 */
import type { Language } from '../i18n/languages'
import type { Book } from '../types/book'
import { api } from './api'
import { libraryHistory, type DeckOrigin } from './discover'

export type BrowseSort = 'relevance' | 'match' | 'popularity' | 'score' | 'recent'
export type BrowseStatus = 'any' | 'ongoing' | 'completed'

export const BROWSE_SORTS: BrowseSort[] = ['relevance', 'match', 'popularity', 'score', 'recent']
export const BROWSE_STATUSES: BrowseStatus[] = ['any', 'ongoing', 'completed']
/** Notes minimales proposées, sur 100 (affichées en étoiles : 70 → 3,5+). */
export const MIN_SCORES = [0, 70, 80, 90] as const
/** Au-delà, la combinaison de genres (en ET) ne renvoie presque plus rien. */
export const MAX_GENRES = 6

export interface BrowseFilters {
  query: string
  origin: DeckOrigin
  genres: string[]
  status: BrowseStatus
  minScore: number
  sort: BrowseSort
}

export const DEFAULT_FILTERS: BrowseFilters = {
  query: '',
  origin: 'all',
  genres: [],
  status: 'any',
  minScore: 0,
  sort: 'relevance',
}

/** Tri effectif : sans texte, la pertinence revient à la popularité (comme côté API). */
export const effectiveSort = (sort: BrowseSort, hasQuery: boolean): BrowseSort =>
  sort === 'relevance' && !hasQuery ? 'popularity' : sort

/** Filtres actifs (la recherche et le tri n'en sont pas). */
export function activeFilterCount(filters: BrowseFilters): number {
  return (
    (filters.origin !== 'all' ? 1 : 0) +
    filters.genres.length +
    (filters.status !== 'any' ? 1 : 0) +
    (filters.minScore > 0 ? 1 : 0)
  )
}

export interface BrowsePage {
  books: Book[]
  total: number
  hasMore: boolean
  personalized: boolean
  /** Recherche maigre : un complément MangaDex peut être demandé (`source: 'mangadex'`). */
  supplement: boolean
}

export async function browse(
  filters: BrowseFilters,
  options: { language: Language; page: number; limit: number; signal?: AbortSignal; source?: 'catalog' | 'mangadex' },
): Promise<BrowsePage> {
  const { liked, skipped } = libraryHistory()
  return api<BrowsePage>('/discover/browse', {
    method: 'POST',
    body: {
      q: filters.query.trim(),
      origin: filters.origin,
      genres: filters.genres,
      status: filters.status,
      minScore: filters.minScore,
      sort: filters.sort,
      page: options.page,
      limit: options.limit,
      lang: options.language,
      source: options.source ?? 'catalog',
      liked,
      skipped,
    },
    signal: options.signal,
  })
}

export interface GenreFacet {
  /** Nom AniList : la valeur de filtre. */
  id: string
  label: string
  count: number
}

export async function fetchGenres(language: Language, signal?: AbortSignal): Promise<GenreFacet[]> {
  const params = new URLSearchParams({ lang: language })
  return (await api<{ genres: GenreFacet[] }>(`/discover/genres?${params.toString()}`, { signal })).genres
}
