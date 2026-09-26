import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { outbox } from '../lib/syncOutbox'
import type { LibraryPayload } from '../services/accountApi'
import { chaptersReadAfter, overallProgress } from '../lib/reader/progress'
import type { Book, LibraryEntry, ReadingStatus } from '../types/book'
import type { ReadingPosition } from '../types/reader'

/** On borne l'historique des « skip » pour ne pas gonfler le localStorage. */
const MAX_SKIPPED = 400

/** État d'un livre avant un choix du deck : ce que « Retour » restaure. */
export interface LibrarySnapshot {
  entry: LibraryEntry | undefined
  skipped: boolean
}

interface LibraryState {
  entries: Record<string, LibraryEntry>
  skipped: string[]

  /** Ajoute (ou met à jour) un livre avec un statut donné. */
  save: (book: Book, status: ReadingStatus) => void
  setStatus: (id: string, status: ReadingStatus) => void
  setProgress: (id: string, progress: number) => void
  /** Coup de cœur ; un titre absent de la bibliothèque y entre en wishlist. */
  setFavorite: (book: Book, favorite: boolean) => void
  /** Note personnelle 0,5 → 5 (demi-étoiles), `null` pour l'effacer. */
  rate: (id: string, rating: number | null) => void
  /**
   * Lecteur intégré : enregistre la position (et, en fin de chapitre, le
   * compteur de chapitres lus). Un titre absent entre en « En cours ».
   */
  recordReading: (
    book: Book,
    position: Omit<ReadingPosition, 'at'>,
    finished?: { number: string | null; orderIndex: number },
  ) => void
  remove: (id: string) => void
  /** Swipe gauche : on mémorise pour ne plus jamais le proposer. */
  skip: (book: Book) => void
  /** Photographie l'état d'un livre, avant un choix qu'on pourra annuler. */
  snapshot: (id: string) => LibrarySnapshot
  /** Annule un choix : remet le livre exactement dans l'état photographié. */
  restore: (id: string, snapshot: LibrarySnapshot) => void
  resetAll: () => void
  /** Remplace l'état local par celui du compte. N'émet aucune synchronisation. */
  replaceAll: (library: LibraryPayload) => void
  /**
   * Remplace la fiche d'œuvres déjà enregistrées (retraduction après un
   * changement de langue). Statut, progression et dates sont intacts, et rien
   * n'est synchronisé : c'est un affichage local, pas une action de l'utilisateur.
   */
  refreshBooks: (books: Book[]) => void
}

/*
 * Mode invité : le store persiste dans le localStorage, rien d'autre.
 * Mode connecté : même chose, et chaque action pousse en plus une opération
 * dans `outbox`, qui l'envoie à l'API. `outbox.push` est sans effet tant
 * qu'aucune session n'est active : les actions n'ont pas à le savoir.
 */
export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => {
      /** Pousse l'état final d'une entrée après un changement de statut ou de progression. */
      const pushPatch = (id: string) => {
        const entry = get().entries[id]
        if (!entry) return
        outbox.push({
          type: 'patch',
          id,
          status: entry.status,
          progress: entry.progress,
          favorite: entry.favorite ?? false,
          userRating: entry.userRating ?? null,
          at: entry.updatedAt ?? Date.now(),
        })
      }

      return {
        entries: {},
        skipped: [],

        save: (book, status) => {
          const now = Date.now()
          set((state) => {
            const previous = state.entries[book.id]
            return {
              entries: {
                ...state.entries,
                [book.id]: {
                  book,
                  status,
                  addedAt: previous?.addedAt ?? now,
                  updatedAt: now,
                  // Passer un livre en « lu » verrouille la progression à 100 %.
                  progress: status === 'read' ? 1 : (previous?.progress ?? 0),
                },
              },
              // Un livre sauvegardé sort de la liste noire.
              skipped: state.skipped.filter((id) => id !== book.id),
            }
          })
          outbox.push({ type: 'swipe', id: book.id, action: status, book, at: now })
        },

        setStatus: (id, status) => {
          if (!get().entries[id]) return
          set((state) => {
            const entry = state.entries[id]
            return {
              entries: {
                ...state.entries,
                [id]: {
                  ...entry,
                  status,
                  updatedAt: Date.now(),
                  progress: status === 'read' ? 1 : status === 'wishlist' ? 0 : entry.progress,
                },
              },
            }
          })
          pushPatch(id)
        },

        setProgress: (id, progress) => {
          if (!get().entries[id]) return
          set((state) => {
            const entry = state.entries[id]
            const clamped = Math.min(1, Math.max(0, progress))
            return {
              entries: {
                ...state.entries,
                [id]: {
                  ...entry,
                  progress: clamped,
                  updatedAt: Date.now(),
                  // 100 % atteint → le livre bascule automatiquement en « Lus ».
                  status: clamped >= 1 ? 'read' : clamped > 0 ? 'reading' : entry.status,
                },
              },
            }
          })
          pushPatch(id)
        },

        setFavorite: (book, favorite) => {
          if (!get().entries[book.id]) {
            if (!favorite) return
            get().save(book, 'wishlist')
          }
          set((state) => {
            const entry = state.entries[book.id]
            if (!entry) return state
            return { entries: { ...state.entries, [book.id]: { ...entry, favorite, updatedAt: Date.now() } } }
          })
          pushPatch(book.id)
        },

        rate: (id, rating) => {
          if (!get().entries[id]) return
          // Demi-étoiles, bornées : une valeur d'ailleurs (clavier, ancien état) reste valide.
          const value = rating === null ? null : Math.min(5, Math.max(0.5, Math.round(rating * 2) / 2))
          set((state) => {
            const entry = state.entries[id]
            return { entries: { ...state.entries, [id]: { ...entry, userRating: value, updatedAt: Date.now() } } }
          })
          pushPatch(id)
        },

        recordReading: (book, where, finished) => {
          const position: ReadingPosition = { ...where, at: Date.now() }
          // Première lecture : le titre rejoint la bibliothèque (« En cours »).
          if (!get().entries[book.id]) get().save(book, 'reading')
          const entry = get().entries[book.id]
          if (!entry) return

          const chaptersRead = finished
            ? chaptersReadAfter(entry.chaptersRead ?? 0, finished)
            : (entry.chaptersRead ?? 0)
          // Compteur connu : l'avancement global suit. Sinon, il reste tel quel.
          const global = finished ? overallProgress(chaptersRead, entry.book.chapters, entry.book.publicationStatus) : null
          const progress = global ?? entry.progress
          // Lire fait passer une wishlist « En cours » ; « Lu » le reste (relecture),
          // sauf si l'avancement retombe à la fin d'une série terminée.
          const status: ReadingStatus =
            progress >= 1 ? 'read' : entry.status === 'wishlist' ? 'reading' : entry.status

          set((state) => ({
            entries: {
              ...state.entries,
              [book.id]: { ...entry, position, chaptersRead, progress, status, updatedAt: position.at },
            },
          }))
          outbox.push({ type: 'progress', id: book.id, position, chaptersRead, progress, status, at: position.at })
        },

        remove: (id) => {
          if (!get().entries[id]) return
          set((state) => {
            const next = { ...state.entries }
            delete next[id]
            return { entries: next }
          })
          outbox.push({ type: 'remove', id, at: Date.now() })
        },

        skip: (book) => {
          set((state) => ({
            skipped: [...state.skipped.filter((id) => id !== book.id), book.id].slice(-MAX_SKIPPED),
          }))
          outbox.push({ type: 'swipe', id: book.id, action: 'skipped', at: Date.now() })
        },

        snapshot: (id) => ({ entry: get().entries[id], skipped: get().skipped.includes(id) }),

        restore: (id, { entry, skipped }) => {
          set((state) => {
            const entries = { ...state.entries }
            if (entry) entries[id] = entry
            else delete entries[id]
            const others = state.skipped.filter((skippedId) => skippedId !== id)
            return { entries, skipped: skipped ? [...others, id] : others }
          })

          const now = Date.now()
          if (entry) {
            // Réécrit l'entrée d'avant : statut via le swipe, progression via le patch.
            outbox.push({ type: 'swipe', id, action: entry.status, book: entry.book, at: now })
            outbox.push({ type: 'patch', id, status: entry.status, progress: entry.progress, at: now })
            return
          }
          // Côté API, supprimer une entrée oublie aussi le « skip » : le livre redevient neuf.
          outbox.push({ type: 'remove', id, at: now })
          if (skipped) outbox.push({ type: 'swipe', id, action: 'skipped', at: now })
        },

        resetAll: () => {
          set({ entries: {}, skipped: [] })
          outbox.push({ type: 'reset', at: Date.now() })
        },

        refreshBooks: (books) => {
          if (books.length === 0) return
          set((state) => {
            const entries = { ...state.entries }
            let changed = false
            for (const book of books) {
              const entry = entries[book.id]
              if (!entry) continue
              entries[book.id] = { ...entry, book }
              changed = true
            }
            return changed ? { entries } : state
          })
        },

        replaceAll: (library) =>
          set({
            entries: Object.fromEntries(library.entries.map((entry) => [entry.book.id, entry])),
            skipped: library.skipped.slice(-MAX_SKIPPED),
          }),
      }
    },
    {
      name: 'bookshelf:library:v1',
      version: 1,
      partialize: (state) => ({ entries: state.entries, skipped: state.skipped }),
    },
  ),
)

/** État local complet, au format de l'API : `initialData` du login / register. */
export function librarySnapshot(): LibraryPayload {
  const { entries, skipped } = useLibraryStore.getState()
  return {
    entries: Object.values(entries).map((entry) => ({
      ...entry,
      updatedAt: entry.updatedAt ?? entry.addedAt,
    })),
    skipped,
  }
}

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
