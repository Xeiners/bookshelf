import { create } from 'zustand'
import { DEFAULT_FILTERS, MAX_GENRES, type BrowseFilters } from '../services/browse'

interface SearchState {
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
