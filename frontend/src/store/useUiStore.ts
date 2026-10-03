import { create } from 'zustand'
import type { Book, LibraryTab } from '../types/book'
import type { ReaderSession } from '../types/reader'

export type ViewId = 'discover' | 'activities' | 'search' | 'library' | 'profile'
/** Écran de l'onglet « Activités » : le hub, ou un de ses modules. */
export type ActivityScreen = 'hub' | 'oracle' | 'collection' | 'market' | 'dle' | 'higherlower'
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
  /** Feuille « Musique » (ambiances, playlists), ouverte depuis l'en-tête ou le mini-lecteur. */
  musicOpen: boolean
  /** Profil public affiché en plein écran (id du compte), `null` = fermé. */
  publicProfileId: string | null
  /** Centre de notifications (cloche de l'en-tête). */
  notificationsOpen: boolean
  /** Recherche défilée vers le bas : l'en-tête se replie, seules la barre et les filtres restent. */
  chromeCollapsed: boolean
  /** Administration plein écran (comptes de `ADMIN_EMAILS`). */
  adminOpen: boolean

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
  openMusic: () => void
  closeMusic: () => void
  /** Profil d'un utilisateur : depuis un lien partagé (`?u=<id>`), un pseudo, un avatar… */
  openPublicProfile: (userId: string) => void
  closePublicProfile: () => void
  openNotifications: () => void
  setChromeCollapsed: (collapsed: boolean) => void
  openAdmin: () => void
  closeAdmin: () => void
  closeNotifications: () => void
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
  musicOpen: false,
  publicProfileId: null,
  notificationsOpen: false,
  chromeCollapsed: false,
  adminOpen: false,

  // Changer de vue redéplie l'en-tête : il ne se replie que dans la Recherche, défilée.
  setView: (view) => set({ view, chromeCollapsed: false }),
  openDetail: (detail) => set({ detail }),
  closeDetail: () => set({ detail: null }),
  openAuth: () => set({ authOpen: true }),
  closeAuth: () => set({ authOpen: false }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  openLibrary: (libraryTab) => set({ view: 'library', libraryTab, chromeCollapsed: false }),
  focusSearch: () => set((state) => ({ view: 'search', searchFocusTick: state.searchFocusTick + 1 })),
  openReader: (reader) => set({ reader, detail: null, filesOpen: false, novelsOpen: false, musicOpen: false }),
  closeReader: () => set({ reader: null }),
  openFiles: () => set({ filesOpen: true }),
  closeFiles: () => set({ filesOpen: false }),
  openNovels: () => set({ novelsOpen: true, detail: null }),
  closeNovels: () => set({ novelsOpen: false }),
  openActivity: (activity) => set({ view: 'activities', activity, chromeCollapsed: false }),
  openBooster: () => set({ boosterOpen: true, detail: null }),
  closeBooster: () => set({ boosterOpen: false }),
  openSettings: () => set({ settingsOpen: true, profileEditorOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  openProfileEditor: () => set({ profileEditorOpen: true, settingsOpen: false }),
  closeProfileEditor: () => set({ profileEditorOpen: false }),
  openMusic: () => set({ musicOpen: true }),
  closeMusic: () => set({ musicOpen: false }),
  // Les feuilles de l'app (paramètres, musique, fiche) se ferment : le profil passe devant.
  openPublicProfile: (publicProfileId) => set({ publicProfileId, settingsOpen: false, musicOpen: false, detail: null }),
  closePublicProfile: () => set({ publicProfileId: null }),
  openNotifications: () => set({ notificationsOpen: true, settingsOpen: false, musicOpen: false }),
  closeNotifications: () => set({ notificationsOpen: false }),
  // L'administration passe devant les feuilles (paramètres, musique, fiche).
  openAdmin: () => set({ adminOpen: true, settingsOpen: false, musicOpen: false, notificationsOpen: false, detail: null }),
  closeAdmin: () => set({ adminOpen: false }),
  setChromeCollapsed: (chromeCollapsed) => set((state) => (state.chromeCollapsed === chromeCollapsed ? state : { chromeCollapsed })),

  notify: (message, tone = 'neutral') => {
    toastId += 1
    set({ toast: { id: toastId, message, tone } })
  },
  dismissToast: () => set({ toast: null }),
}))
