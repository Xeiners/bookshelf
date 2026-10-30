import { create } from 'zustand'
import type { SeriesChoice } from '../services/cardsApi'
import type { Book, LibraryTab } from '../types/book'
import type { ReaderSession } from '../types/reader'

export type ViewId = 'discover' | 'activities' | 'search' | 'library' | 'profile'
/** Écran de l'onglet « Activités » : le hub, ou un de ses modules. */
/** Rubrique du hub des Activités. */
export type ActivityTab = 'cards' | 'games' | 'more'

export type ActivityScreen = 'hub' | 'oracle' | 'collection' | 'market' | 'dle' | 'higherlower' | 'bomb' | 'runner' | 'canvas' | 'stack'
/** Rubrique du hub qui contient chaque module. */
const TAB_OF: Record<Exclude<ActivityScreen, 'hub'>, ActivityTab> = {
  collection: 'cards',
  market: 'cards',
  dle: 'games',
  higherlower: 'games',
  bomb: 'games',
  runner: 'games',
  stack: 'games',
  oracle: 'more',
  canvas: 'more',
}

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
  /** Rubrique affichée dans le hub ; gardée au retour d'un jeu ou d'un module. */
  activityTab: ActivityTab
  /** Retour au hub depuis un module : la section où le replacer (puis `null`). */
  hubReturnTo: ActivityTab | null
  clearHubReturn: () => void
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
  /** Revue des images d'énigme (contrôleurs d'images). */
  reviewOpen: boolean
  /** Fil « Edits » (vidéos verticales d'anime) : en essai, administrateurs seulement. */
  editsOpen: boolean

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
  openActivity: (activity: ActivityScreen, tab?: ActivityTab) => void
  setActivityTab: (tab: ActivityTab) => void
  /** Ouvre la fenêtre des boosters ; `series` : déjà choisie, sinon le choix s'affiche. */
  openBooster: (series?: SeriesChoice) => void
  /** Ouvre un pack Légendaire offert (même mise en scène qu'un booster). */
  openLegendaryPack: () => void
  /** Achète et ouvre un Booster Légendaire de la boutique : le débit et le tirage partent à l'ouverture de la fenêtre. */
  buyLegendaryPack: () => void
  /** Développement : booster d'aperçu avec une Légendaire ou une Mythique (rien n'est tiré ni ajouté). */
  openPreviewPack: (rarity: 'LEGENDARY' | 'MYTHIC') => void
  /** Booster d'aperçu demandé ; `null` : un vrai booster. */
  boosterPreview: 'LEGENDARY' | 'MYTHIC' | null
  /** La fenêtre des boosters ouvre un pack Légendaire offert. */
  boosterLegendary: boolean
  /** …acheté à l'instant dans la boutique (sinon : un pack offert). */
  boosterPurchase: boolean
  /** Série demandée à l'ouverture de la fenêtre ; `null` : à choisir. */
  boosterSeries: SeriesChoice | null
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
  openReview: () => void
  closeReview: () => void
  openEdits: () => void
  closeEdits: () => void
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
  activityTab: 'cards',
  hubReturnTo: null,
  boosterOpen: false,
  boosterSeries: null,
  boosterLegendary: false,
  boosterPurchase: false,
  boosterPreview: null,
  settingsOpen: false,
  profileEditorOpen: false,
  musicOpen: false,
  publicProfileId: null,
  notificationsOpen: false,
  chromeCollapsed: false,
  adminOpen: false,
  reviewOpen: false,
  editsOpen: false,

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
  // Ouvrir un module place aussi le hub sur sa rubrique : le retour y ramène.
  openActivity: (activity, tab) =>
    set((state) => ({
      view: 'activities',
      activity,
      chromeCollapsed: false,
      activityTab: tab ?? (activity === 'hub' ? state.activityTab : TAB_OF[activity]),
      // Retour au hub depuis un module : le hub se replace sur la section de ce module.
      hubReturnTo: activity === 'hub' && state.activity !== 'hub' ? TAB_OF[state.activity] : null,
    })),
  clearHubReturn: () => set({ hubReturnTo: null }),
  setActivityTab: (activityTab) => set({ activityTab }),
  openBooster: (series) => set({ boosterOpen: true, boosterSeries: series ?? null, boosterLegendary: false, boosterPurchase: false, boosterPreview: null, detail: null }),
  openLegendaryPack: () => set({ boosterOpen: true, boosterSeries: null, boosterLegendary: true, boosterPurchase: false, boosterPreview: null, detail: null }),
  buyLegendaryPack: () => set({ boosterOpen: true, boosterSeries: null, boosterLegendary: true, boosterPurchase: true, boosterPreview: null, detail: null }),
  openPreviewPack: (rarity) => set({ boosterOpen: true, boosterSeries: null, boosterLegendary: false, boosterPurchase: false, boosterPreview: rarity, detail: null }),
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
  openReview: () => set({ reviewOpen: true, settingsOpen: false, musicOpen: false, notificationsOpen: false, detail: null }),
  closeReview: () => set({ reviewOpen: false }),
  openEdits: () => set({ editsOpen: true, settingsOpen: false, musicOpen: false, notificationsOpen: false, detail: null }),
  closeEdits: () => set({ editsOpen: false }),
  setChromeCollapsed: (chromeCollapsed) => set((state) => (state.chromeCollapsed === chromeCollapsed ? state : { chromeCollapsed })),

  notify: (message, tone = 'neutral') => {
    toastId += 1
    set({ toast: { id: toastId, message, tone } })
  },
  dismissToast: () => set({ toast: null }),
}))
