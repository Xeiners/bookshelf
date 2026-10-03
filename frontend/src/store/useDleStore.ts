import { create } from 'zustand'
import { getT } from '../i18n'
import { clockOffset, isNewer } from '../lib/dle'
import { ApiError } from '../services/api'
import {
  DLE_MODES,
  dleApi,
  stardustApi,
  type DailyGuessResult,
  type DailyView,
  type DleCategory,
  type DleMode,
  type DleOverview,
  type DleWorkOption,
  type RoomKind,
  type RoomSettings,
  type RoomView,
  type RoomVisibility,
} from '../services/dleApi'
import { useBoosterStore } from './useBoosterStore'
import { useGuestStardustStore } from './useGuestStardustStore'
import { useUiStore } from './useUiStore'

/**
 * BookshelfDLE : l'écran affiché (grille des catégories, menu d'une catégorie,
 * énigme du jour, multijoueur, salon), la catégorie choisie, l'accueil (solde de
 * Poussières, palmarès), les énigmes du jour et le salon en cours. Le salon se
 * suit par attente longue (`watch`) : chaque changement côté serveur arrive aussitôt.
 */
export type DleScreen = { kind: 'home' } | { kind: 'category' } | { kind: 'daily'; mode: DleMode } | { kind: 'multi' } | { kind: 'room' }

/** Clé d'une énigme du jour dans le store : `naruto:classic`. */
export const dailyKey = (category: DleCategory, mode: DleMode) => `${category}:${mode}`

interface DleState {
  screen: DleScreen
  /** Catégorie choisie dans la grille : celle des énigmes du jour et des parties à plusieurs. */
  category: DleCategory
  overview: DleOverview | null
  overviewStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** Propositions possibles de chaque catégorie (saisie), chargées une fois. */
  works: Partial<Record<DleCategory, DleWorkOption[]>>
  /** Énigmes du jour, par `dailyKey`. */
  daily: Partial<Record<string, DailyView>>
  room: RoomView | null
  /** Avance de l'horloge du serveur sur celle de l'appareil (ms) : chronos justes même sur un téléphone à l'heure fausse. */
  offset: number
  /** Formats choisis pour jouer à plusieurs : un, ou les deux à la suite (Classique puis Couverture). */
  multiModes: DleMode[]
  /** Type de partie choisi : VERSUS (course) ou COOP (grille commune). */
  multiKind: RoomKind
  /** Salon d'un lien d'invitation (`?dle=`), rejoint dès que possible. */
  pendingCode: string | null

  loadOverview: () => Promise<void>
  loadWorks: (category: DleCategory) => Promise<void>
  loadDaily: (category: DleCategory, mode: DleMode) => Promise<void>
  guessDaily: (category: DleCategory, mode: DleMode, cardId: string) => Promise<DailyGuessResult>
  /** Grille des catégories. */
  openHome: () => void
  /** Menu d'une catégorie (énigmes du jour, multijoueur) ; sans argument : celle en cours. */
  openCategory: (category?: DleCategory) => void
  openDaily: (mode: DleMode) => void
  /** Écran « Multijoueur » : partie rapide, salon privé, code. */
  openMulti: () => void
  /** Coche ou décoche un format (il en reste toujours au moins un). */
  toggleMultiMode: (mode: DleMode) => void
  setMultiKind: (kind: RoomKind) => void
  /** Sans compte : choisit (ou garde) le pseudo d'invité avant d'entrer dans un salon. */
  ensureGuest: (name: string) => Promise<void>
  /** L'hôte règle la partie (type, essais, durée), dans la salle d'attente. */
  setRoomSettings: (settings: RoomSettings) => Promise<void>
  setPendingCode: (code: string | null) => void

  applyRoom: (view: RoomView, receivedAt?: number) => void
  createRoom: (visibility: RoomVisibility) => Promise<void>
  quickMatch: () => Promise<void>
  joinRoom: (code: string) => Promise<void>
  /** Retour au salon en cours (après un rechargement, ou depuis un autre onglet de l'app). */
  resumeRoom: (code: string) => Promise<void>
  leaveRoom: () => Promise<void>
  startRoom: () => Promise<void>
  rematch: () => Promise<void>
  guessRoom: (cardId: string) => Promise<RoomView>
  forfeit: () => Promise<void>
  /** Suit le salon affiché en attente longue ; renvoie de quoi arrêter. */
  watch: () => () => void

  /** Achète un booster avec des Poussières, puis l'ouvre aussitôt. */
  buyBooster: () => Promise<void>
  /** Nouveau solde de Poussières gagné ailleurs (Higher or Lower) : le badge suit. */
  setStardust: (balance: number) => void
  reset: () => void
}

const worksInflight = new Map<DleCategory, Promise<void>>()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const useDleStore = create<DleState>((set, get) => ({
  screen: { kind: 'home' },
  category: 'manga',
  overview: null,
  overviewStatus: 'idle',
  works: {},
  daily: {},
  room: null,
  offset: 0,
  multiModes: ['classic'],
  multiKind: 'versus',
  pendingCode: null,

  loadOverview: async () => {
    if (get().overview === null) set({ overviewStatus: 'loading' })
    try {
      const overview = await dleApi.overview()
      set({ overview, overviewStatus: 'ready' })
    } catch {
      set((state) => ({ overviewStatus: state.overview ? 'ready' : 'error' }))
    }
  },

  loadWorks: (category) => {
    if (get().works[category]) return Promise.resolve()
    let pending = worksInflight.get(category)
    if (!pending) {
      pending = dleApi
        .works(category)
        .then((works) => set((state) => ({ works: { ...state.works, [category]: works } })))
        .catch(() => undefined)
        .finally(() => worksInflight.delete(category))
      worksInflight.set(category, pending)
    }
    return pending
  },

  loadDaily: async (category, mode) => {
    const view = await dleApi.daily(category, mode)
    set((state) => ({ daily: { ...state.daily, [dailyKey(category, mode)]: view } }))
  },

  guessDaily: async (category, mode, cardId) => {
    const result = await dleApi.guessDaily(category, mode, cardId)
    const progress = { attempts: result.view.guesses.length, solved: result.view.solved, reward: result.view.reward }
    set((state) => ({
      daily: { ...state.daily, [dailyKey(category, mode)]: result.view },
      overview: state.overview
        ? {
            ...state.overview,
            stardust: result.balance,
            daily: { ...state.overview.daily, [category]: { ...state.overview.daily[category], [mode]: progress } },
            stats: result.view.solved
              ? {
                  ...state.overview.stats,
                  dailyStreak: result.streak,
                  dailyBest: Math.max(state.overview.stats.dailyBest, result.streak),
                  dailySolved: state.overview.stats.dailySolved + (result.earned > 0 ? 1 : 0),
                }
              : state.overview.stats,
          }
        : state.overview,
    }))
    return result
  },

  openHome: () => set({ screen: { kind: 'home' } }),
  openCategory: (category) => set((state) => ({ screen: { kind: 'category' }, category: category ?? state.category })),
  openDaily: (mode) => set({ screen: { kind: 'daily', mode } }),
  openMulti: () => set({ screen: { kind: 'multi' } }),
  toggleMultiMode: (mode) =>
    set((state) => {
      const next = state.multiModes.includes(mode) ? state.multiModes.filter((entry) => entry !== mode) : [...state.multiModes, mode]
      // Toujours dans l'ordre du jeu : Classique, puis Couverture.
      return next.length === 0 ? state : { multiModes: DLE_MODES.filter((entry) => next.includes(entry)) }
    }),
  setMultiKind: (multiKind) => set({ multiKind }),

  ensureGuest: async (name) => {
    const guest = await dleApi.guest(name)
    set((state) => ({ overview: state.overview ? { ...state.overview, guest } : state.overview }))
  },

  setRoomSettings: async (settings) => {
    const room = get().room
    if (room) get().applyRoom(await dleApi.setSettings(room.code, settings))
  },
  setPendingCode: (pendingCode) => set({ pendingCode }),

  applyRoom: (view, receivedAt = Date.now()) => {
    const current = get().room
    if (!isNewer(view, current)) return
    const finished = view.phase === 'results' && current?.phase !== 'results'
    set({ room: view, category: view.category, offset: clockOffset(view.serverTime, receivedAt), screen: { kind: 'room' } })
    // Invité : le reçu de Poussières de la manche est gardé sur l'appareil.
    if (view.results?.receipt) useGuestStardustStore.getState().add(view.results.receipt)
    // Fin de manche : les Poussières gagnées et le palmarès changent.
    if (finished) void get().loadOverview()
  },

  createRoom: async (visibility) => get().applyRoom(await dleApi.createRoom(get().category, get().multiModes, visibility, get().multiKind)),
  quickMatch: async () => get().applyRoom(await dleApi.quickMatch(get().category, get().multiModes, get().multiKind)),
  joinRoom: async (code) => {
    set({ pendingCode: null })
    get().applyRoom(await dleApi.join(code))
  },
  resumeRoom: async (code) => get().applyRoom(await dleApi.watch(code, null)),

  leaveRoom: async () => {
    const room = get().room
    set({ room: null, screen: { kind: 'category' } })
    if (room) await dleApi.leave(room.code).catch(() => undefined)
    void get().loadOverview()
  },

  startRoom: async () => {
    const room = get().room
    if (room) get().applyRoom(await dleApi.start(room.code))
  },
  rematch: async () => {
    const room = get().room
    if (room) get().applyRoom(await dleApi.rematch(room.code))
  },
  guessRoom: async (cardId) => {
    const room = get().room
    if (!room) throw new ApiError(404, 'room_not_found', 'No room') // i18n-ignore
    const view = await dleApi.guessRoom(room.code, cardId)
    get().applyRoom(view)
    return view
  },
  forfeit: async () => {
    const room = get().room
    if (room) get().applyRoom(await dleApi.forfeit(room.code))
  },

  watch: () => {
    const controller = new AbortController()
    void (async () => {
      let failures = 0
      while (!controller.signal.aborted) {
        const room = get().room
        if (!room) return
        try {
          const view = await dleApi.watch(room.code, room.version, controller.signal)
          failures = 0
          get().applyRoom(view)
        } catch (error) {
          if (controller.signal.aborted) return
          // Salon fermé (redémarrage du serveur, tout le monde parti) ou exclu pour absence.
          if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
            if (get().room?.code === room.code) {
              set({ room: null, screen: { kind: 'category' } })
              useUiStore.getState().notify(getT().dle.room.closed, 'neutral')
              void get().loadOverview()
            }
            return
          }
          // Réseau coupé : on réessaie, de moins en moins souvent.
          failures += 1
          await sleep(Math.min(8000, 800 * failures))
        }
      }
    })()
    return () => controller.abort()
  },

  buyBooster: async () => {
    const { balance, status } = await stardustApi.buyBooster()
    set((state) => ({ overview: state.overview ? { ...state.overview, stardust: balance } : state.overview }))
    useBoosterStore.setState({ status, syncedAt: performance.now(), offline: false })
    useUiStore.getState().openBooster()
  },

  setStardust: (balance) => set((state) => ({ overview: state.overview ? { ...state.overview, stardust: balance } : state.overview })),

  reset: () => set({ screen: { kind: 'home' }, overview: null, overviewStatus: 'idle', daily: {}, room: null, pendingCode: null }),
}))
