import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Book, LibraryEntry, ReadingStatus } from '../types/book'

/** On borne l'historique des « skip » pour ne pas gonfler le localStorage. */
const MAX_SKIPPED = 400

interface LibraryState {
  entries: Record<string, LibraryEntry>
  skipped: string[]

  /** Ajoute (ou met à jour) un livre avec un statut donné. */
  save: (book: Book, status: ReadingStatus) => void
  setStatus: (id: string, status: ReadingStatus) => void
  setProgress: (id: string, progress: number) => void
  remove: (id: string) => void
  /** Swipe gauche : on mémorise pour ne plus jamais le proposer. */
  skip: (book: Book) => void
  resetAll: () => void
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      entries: {},
      skipped: [],

      save: (book, status) =>
        set((state) => {
          const previous = state.entries[book.id]
          return {
            entries: {
              ...state.entries,
              [book.id]: {
                book,
                status,
                addedAt: previous?.addedAt ?? Date.now(),
                // Passer un livre en « lu » verrouille la progression à 100 %.
                progress: status === 'read' ? 1 : (previous?.progress ?? 0),
              },
            },
            // Un livre sauvegardé sort de la liste noire.
            skipped: state.skipped.filter((id) => id !== book.id),
          }
        }),

      setStatus: (id, status) =>
        set((state) => {
          const entry = state.entries[id]
          if (!entry) return state
          return {
            entries: {
              ...state.entries,
              [id]: {
                ...entry,
                status,
                progress: status === 'read' ? 1 : status === 'wishlist' ? 0 : entry.progress,
              },
            },
          }
        }),

      setProgress: (id, progress) =>
        set((state) => {
          const entry = state.entries[id]
          if (!entry) return state
          const clamped = Math.min(1, Math.max(0, progress))
          return {
            entries: {
              ...state.entries,
              [id]: {
                ...entry,
                progress: clamped,
                // 100 % atteint → le livre bascule automatiquement en « Lus ».
                status: clamped >= 1 ? 'read' : clamped > 0 ? 'reading' : entry.status,
              },
            },
          }
        }),

      remove: (id) =>
        set((state) => {
          if (!state.entries[id]) return state
          const next = { ...state.entries }
          delete next[id]
          return { entries: next }
        }),

      skip: (book) =>
        set((state) => ({
          skipped: [...state.skipped.filter((id) => id !== book.id), book.id].slice(-MAX_SKIPPED),
        })),

      resetAll: () => set({ entries: {}, skipped: [] }),
    }),
    {
      name: 'bookshelf:library:v1',
      version: 1,
      partialize: (state) => ({ entries: state.entries, skipped: state.skipped }),
    },
  ),
)

/**
 * Ids déjà vus (sauvegardés ou skippés) — filtre le deck Découverte.
 *
 * ⚠️ Volontairement PAS un sélecteur Zustand : la fonction crée un nouveau `Set`
 * à chaque appel, ce qui provoquerait une boucle de rendu avec Zustand v5
 * (comparaison par `Object.is`). À utiliser dans un `useMemo`.
 */
export function knownIds(entries: Record<string, LibraryEntry>, skipped: string[]): Set<string> {
  return new Set([...Object.keys(entries), ...skipped])
}
