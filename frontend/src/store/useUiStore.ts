import { create } from 'zustand'
import type { Book, LibraryTab } from '../types/book'
import type { ReaderSession } from '../types/reader'

export type ViewId = 'discover' | 'oracle' | 'search' | 'library' | 'profile'
export type ToastTone = 'like' | 'nope' | 'neutral'

export interface Toast {
  /** Incrémental : sert de `key` React pour rejouer l'animation d'entrée. */
  id: number
  message: string
  tone: ToastTone
}

interface UiState {
  view: ViewId
  /** Livre affiché dans la feuille de détail (bottom sheet), `null` = fermée. */
  detail: Book | null
  toast: Toast | null
  /** Feuille « Créer un compte / Se connecter ». */
  authOpen: boolean
  /** Onglet de « Ma biblio » : dans le store pour que la barre latérale puisse y mener. */
  libraryTab: LibraryTab
  /** Incrémenté pour demander le focus du champ de recherche (raccourci Ctrl/⌘ K). */
  searchFocusTick: number
  /** Lecteur plein écran ouvert (œuvre MangaDex ou fichier importé), `null` = fermé. */
  reader: ReaderSession | null
  /** Feuille « Mes fichiers » (PDF, EPUB, CBZ importés). */
  filesOpen: boolean

  setView: (view: ViewId) => void
  openDetail: (book: Book) => void
  closeDetail: () => void
  openAuth: () => void
  closeAuth: () => void
  setLibraryTab: (tab: LibraryTab) => void
  /** Ouvre « Ma biblio » directement sur un onglet. */
  openLibrary: (tab: LibraryTab) => void
  /** Va sur Recherche et place le curseur dans le champ. */
  focusSearch: () => void
  /** Ouvre le lecteur ; la fiche éventuellement ouverte se ferme (le lecteur la recouvre). */
  openReader: (session: ReaderSession) => void
  closeReader: () => void
  openFiles: () => void
  closeFiles: () => void
  notify: (message: string, tone?: ToastTone) => void
  dismissToast: () => void
}

let toastId = 0

export const useUiStore = create<UiState>((set) => ({
  view: 'discover',
  detail: null,
  toast: null,
  authOpen: false,
  libraryTab: 'wishlist',
  searchFocusTick: 0,
  reader: null,
  filesOpen: false,

  setView: (view) => set({ view }),
  openDetail: (detail) => set({ detail }),
  closeDetail: () => set({ detail: null }),
  openAuth: () => set({ authOpen: true }),
  closeAuth: () => set({ authOpen: false }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  openLibrary: (libraryTab) => set({ view: 'library', libraryTab }),
  focusSearch: () => set((state) => ({ view: 'search', searchFocusTick: state.searchFocusTick + 1 })),
  openReader: (reader) => set({ reader, detail: null, filesOpen: false }),
  closeReader: () => set({ reader: null }),
  openFiles: () => set({ filesOpen: true }),
  closeFiles: () => set({ filesOpen: false }),

  notify: (message, tone = 'neutral') => {
    toastId += 1
    set({ toast: { id: toastId, message, tone } })
  },
  dismissToast: () => set({ toast: null }),
}))
