import { create } from 'zustand'
import { DEFAULT_FILTERS, MAX_GENRES, type BrowseFilters } from '../services/browse'

/** Ce que cherche la page : le catalogue MangaDex, des romans (Open Library + Google Books), ou des membres. */
export type SearchScope = 'catalog' | 'novels' | 'members'

interface SearchState {
  scope: SearchScope
  /** Recherche de romans : distincte de celle du catalogue (un titre de manga n'est pas un roman). */
  novelQuery: string
  /** Recherche de membres par pseudo. */
  memberQuery: string
  setScope: (scope: SearchScope) => void
  setNovelQuery: (query: string) => void
  setMemberQuery: (query: string) => void
  filters: BrowseFilters
  /** Remplace une partie des filtres. */
  update: (patch: Partial<BrowseFilters>) => void
  toggleGenre: (genre: string) => void
  /** Réinitialise les filtres, en gardant la recherche et le tri. */
  resetFilters: () => void
}

/**
 * Recherche et filtres de la page Recherche. Hors du composant : quitter la
 * page puis y revenir retrouve la même recherche. Non persisté : une nouvelle
 * session repart du catalogue complet.
 */
export const useSearchStore = create<SearchState>()((set) => ({
  scope: 'catalog',
  novelQuery: '',
  memberQuery: '',
  setScope: (scope) => set({ scope }),
  setNovelQuery: (novelQuery) => set({ novelQuery }),
  setMemberQuery: (memberQuery) => set({ memberQuery }),
  filters: DEFAULT_FILTERS,
  update: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
  toggleGenre: (genre) =>
    set((state) => {
      const { genres } = state.filters
      const next = genres.includes(genre)
        ? genres.filter((item) => item !== genre)
        : genres.length < MAX_GENRES
          ? [...genres, genre]
          : genres
      return { filters: { ...state.filters, genres: next } }
    }),
  resetFilters: () =>
    set((state) => ({
      filters: { ...DEFAULT_FILTERS, query: state.filters.query, sort: state.filters.sort },
    })),
}))
