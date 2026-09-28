import { create } from 'zustand'
import type { Book, LibraryTab } from '../types/book'
import type { ReaderSession } from '../types/reader'

export type ViewId = 'discover' | 'activities' | 'search' | 'library' | 'profile'
/** Écran de l'onglet « Activités » : le hub, ou un de ses modules. */
export type ActivityScreen = 'hub' | 'oracle' | 'collection'
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
  /** Feuille « Mes romans » (EPUB du compte, synchronisés). */
  novelsOpen: boolean
  activity: ActivityScreen
  /** Ouverture de booster en plein écran. */
  boosterOpen: boolean
  /** Feuille « Paramètres » (ouverte depuis le Profil). */
  settingsOpen: boolean
  /** Feuille « Éditer le profil ». */
  profileEditorOpen: boolean

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
  openNovels: () => void
  closeNovels: () => void
  /** Va sur un écran des Activités (le hub, l'Oracle, la collection). */
  openActivity: (activity: ActivityScreen) => void
  openBooster: () => void
  closeBooster: () => void
  openSettings: () => void
  closeSettings: () => void
  openProfileEditor: () => void
  closeProfileEditor: () => void
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
  novelsOpen: false,
  activity: 'hub',
  boosterOpen: false,
  settingsOpen: false,
  profileEditorOpen: false,

  setView: (view) => set({ view }),
  openDetail: (detail) => set({ detail }),
  closeDetail: () => set({ detail: null }),
  openAuth: () => set({ authOpen: true }),
  closeAuth: () => set({ authOpen: false }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  openLibrary: (libraryTab) => set({ view: 'library', libraryTab }),
  focusSearch: () => set((state) => ({ view: 'search', searchFocusTick: state.searchFocusTick + 1 })),
  openReader: (reader) => set({ reader, detail: null, filesOpen: false, novelsOpen: false }),
  closeReader: () => set({ reader: null }),
  openFiles: () => set({ filesOpen: true }),
  closeFiles: () => set({ filesOpen: false }),
  openNovels: () => set({ novelsOpen: true, detail: null }),
  closeNovels: () => set({ novelsOpen: false }),
  openActivity: (activity) => set({ view: 'activities', activity }),
  openBooster: () => set({ boosterOpen: true, detail: null }),
  closeBooster: () => set({ boosterOpen: false }),
  openSettings: () => set({ settingsOpen: true, profileEditorOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  openProfileEditor: () => set({ profileEditorOpen: true, settingsOpen: false }),
  closeProfileEditor: () => set({ profileEditorOpen: false }),

  notify: (message, tone = 'neutral') => {
    toastId += 1
    set({ toast: { id: toastId, message, tone } })
  },
  dismissToast: () => set({ toast: null }),
}))
