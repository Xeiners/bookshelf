import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DECK_SOURCES, sanitizeSources, toggleSource, type DeckSource } from '../lib/deckSources'
import type { ShelfId } from '../services/catalog'

interface DeckPrefs {
  /** Types cochés dans le filtre du deck (jamais vide). */
  sources: DeckSource[]
  /** Dernière étagère choisie : retrouvée au prochain lancement. */
  shelf: ShelfId
}

interface DeckState extends DeckPrefs {
  toggleSource: (source: DeckSource) => void
  selectAllSources: () => void
  setShelf: (shelf: ShelfId) => void
}

/**
 * Réglages du deck de Découverte, gardés sur l'appareil : ce qu'on a coché
 * (mangas, romans…) et l'étagère, retrouvés en rouvrant l'application.
 */
export const useDeckStore = create<DeckState>()(
  persist(
    (set) => ({
      sources: sanitizeSources(undefined),
      shelf: 'pour-toi',
      toggleSource: (source) => set((state) => ({ sources: toggleSource(state.sources, source) })),
      selectAllSources: () => set({ sources: [...DECK_SOURCES] }),
      setShelf: (shelf) => set({ shelf }),
    }),
    {
      name: 'bookshelf:deck:v1',
      version: 1,
      partialize: (state): DeckPrefs => ({ sources: state.sources, shelf: state.shelf }),
      // Données d'une autre version ou corrompues : sélection par défaut. Une étagère
      // inconnue retombe sur « Pour toi » au rendu (cf. useDiscoveryQueue).
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<DeckPrefs>
        return {
          ...current,
          sources: sanitizeSources(saved.sources),
          shelf: typeof saved.shelf === 'string' ? saved.shelf : current.shelf,
        }
      },
    },
  ),
)
