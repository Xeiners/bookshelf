import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DECK_SOURCES, sanitizeSources, toggleSource, type DeckSource } from '../lib/deckSources'
import { isGenreShelf, type ShelfId } from '../services/catalog'

interface DeckPrefs {
  /** Types cochés dans le filtre du deck (jamais vide). */
  sources: DeckSource[]
  /** Dernière étagère choisie : retrouvée au prochain lancement. */
  shelf: ShelfId
  /** Genres cochés ensemble (puces) : priment sur l'étagère tant qu'il y en a. */
  genres: ShelfId[]
}

interface DeckState extends DeckPrefs {
  toggleSource: (source: DeckSource) => void
  selectAllSources: () => void
  /** « Pour toi », « Tendances »… : une étagère seule, les genres cochés sont retirés. */
  setShelf: (shelf: ShelfId) => void
  /** Coche ou décoche un genre (dans l'ordre où ils ont été cochés). */
  toggleGenre: (genre: ShelfId) => void
}

/** Genres cochés au plus : au-delà, la sélection ne filtre plus grand-chose. */
export const MAX_DECK_GENRES = 6

/**
 * Réglages du deck de Découverte, gardés sur l'appareil : ce qu'on a coché
 * (mangas, romans…) et l'étagère, retrouvés en rouvrant l'application.
 */
export const useDeckStore = create<DeckState>()(
  persist(
    (set) => ({
      sources: sanitizeSources(undefined),
      shelf: 'pour-toi',
      genres: [],
      toggleSource: (source) => set((state) => ({ sources: toggleSource(state.sources, source) })),
      selectAllSources: () => set({ sources: [...DECK_SOURCES] }),
      setShelf: (shelf) => set({ shelf, genres: [] }),
      toggleGenre: (genre) =>
        set((state) => ({
          genres: state.genres.includes(genre)
            ? state.genres.filter((item) => item !== genre)
            : [...state.genres, genre].slice(-MAX_DECK_GENRES),
        })),
    }),
    {
      name: 'bookshelf:deck:v1',
      version: 1,
      partialize: (state): DeckPrefs => ({ sources: state.sources, shelf: state.shelf, genres: state.genres }),
      // Données d'une autre version ou corrompues : sélection par défaut. Une étagère
      // inconnue retombe sur « Pour toi » au rendu (cf. useDiscoveryQueue).
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<DeckPrefs>
        // Ancienne version : un genre choisi comme étagère devient un genre coché.
        const legacyGenre = typeof saved.shelf === 'string' && isGenreShelf(saved.shelf) && !Array.isArray(saved.genres)
        if (legacyGenre) return { ...current, sources: sanitizeSources(saved.sources), shelf: 'pour-toi', genres: [saved.shelf as ShelfId] }
        return {
          ...current,
          sources: sanitizeSources(saved.sources),
          shelf: typeof saved.shelf === 'string' ? saved.shelf : current.shelf,
          // Genres inconnus des étagères proposées : écartés au rendu, comme l'étagère.
          genres: Array.isArray(saved.genres) ? saved.genres.filter((genre): genre is ShelfId => typeof genre === 'string').slice(0, MAX_DECK_GENRES) : [],
        }
      },
    },
  ),
)
