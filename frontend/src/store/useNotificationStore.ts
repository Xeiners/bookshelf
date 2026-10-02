import { create } from 'zustand'
import { freshArrivals, latestCursor, mergeNotifications } from '../lib/notifications'
import { notificationsApi, type AppNotification } from '../services/notificationsApi'
import { useBoosterStore } from './useBoosterStore'
import { useTradeStore } from './useTradeStore'

type Status = 'idle' | 'loading' | 'ready' | 'error'

/** Bandeaux en attente, au plus : une rafale n'empile pas dix bandeaux. */
const MAX_BANNERS = 3

/**
 * Notifications du compte (comptes seulement). La liste vient de l'API, sondée
 * par `useNotificationPolling` ; rien n'est persisté. Seules les notifications
 * découvertes PENDANT la session ont droit à un bandeau : celles qui
 * attendaient au démarrage allument la cloche, sans surgir à l'écran.
 */
interface NotificationState {
  items: AppNotification[]
  unread: number
  status: Status
  /** Bandeaux à afficher, le premier à l'écran. */
  banners: AppNotification[]
  /** Incrémenté à chaque arrivée : la cloche s'agite. */
  arrivals: number

  /** Liste complète (démarrage, ouverture du centre). */
  load: () => Promise<void>
  /** Seulement les nouvelles depuis la plus récente connue. */
  poll: () => Promise<void>
  markRead: (ids: string[]) => void
  markAllRead: () => void
  remove: (id: string) => void
  dismissBanner: (id: string) => void
  reset: () => void
}

/** Incrémenté à chaque `reset` : une réponse arrivée après un changement de compte est ignorée. */
let generation = 0
/** Liste complète déjà reçue : avant elle, aucune arrivée n'est « nouvelle ». */
let primed = false
/** Un seul sondage à la fois (minuteur, retour au premier plan et réseau peuvent coïncider). */
let inFlight: Promise<void> | null = null

/** Effets d'une arrivée hors de la liste elle-même. */
type ArrivalHandler = (fresh: AppNotification[]) => void
let onArrival: ArrivalHandler = () => {}
/** Le son et la vibration sont branchés par l'interface (préférences, document visible). */
export const setArrivalHandler = (handler: ArrivalHandler) => {
  onArrival = handler
}

/** Intègre une réponse de l'API ; les nouvelles venues déclenchent bandeau, son et rechargements. */
function absorb(get: () => NotificationState, set: (partial: Partial<NotificationState>) => void, incoming: AppNotification[], unread: number) {
  const state = get()
  const fresh = primed ? freshArrivals(new Set(state.items.map((item) => item.id)), incoming) : []
  primed = true
  set({
    items: mergeNotifications(state.items, incoming),
    unread,
    status: 'ready',
    banners: [...state.banners, ...fresh].slice(-MAX_BANNERS),
    arrivals: state.arrivals + fresh.length,
  })
  if (fresh.length === 0) return
  // Une de MES offres a été acceptée : l'album a changé, mes offres aussi.
  if (fresh.some((item) => item.type === 'trade_accepted')) {
    useBoosterStore.getState().collectionChanged()
    if (useTradeStore.getState().mine) void useTradeStore.getState().loadMine()
  }
  onArrival(fresh)
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  status: 'idle',
  banners: [],
  arrivals: 0,

  load: async () => {
    const current = generation
    if (get().status === 'idle') set({ status: 'loading' })
    try {
      const { notifications, unread } = await notificationsApi.list()
      if (current === generation) absorb(get, set, notifications, unread)
    } catch {
      if (current === generation) set((state) => ({ status: state.items.length ? 'ready' : 'error' }))
    }
  },

  poll: () => {
    if (!primed) return get().load()
    inFlight ??= (async () => {
      const current = generation
      try {
        const { notifications, unread } = await notificationsApi.list(latestCursor(get().items))
        if (current === generation) absorb(get, set, notifications, unread)
      } catch {
        // Hors-ligne, serveur redémarré : le prochain sondage rattrapera.
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  },

  markRead: (ids) => {
    const unreadIds = ids.filter((id) => get().items.some((item) => item.id === id && !item.read))
    if (unreadIds.length === 0) return
    // Optimiste : la pastille s'éteint tout de suite ; l'API renvoie le compte qui fait foi.
    set((state) => ({
      items: state.items.map((item) => (unreadIds.includes(item.id) ? { ...item, read: true } : item)),
      unread: Math.max(0, state.unread - unreadIds.length),
    }))
    const current = generation
    notificationsApi.markRead(unreadIds).then(
      ({ unread }) => current === generation && set({ unread }),
      () => {},
    )
  },

  markAllRead: () => {
    if (get().unread === 0) return
    set((state) => ({ items: state.items.map((item) => (item.read ? item : { ...item, read: true })), unread: 0 }))
    const current = generation
    notificationsApi.markRead().then(
      ({ unread }) => current === generation && set({ unread }),
      () => {},
    )
  },

  remove: (id) => {
    const target = get().items.find((item) => item.id === id)
    if (!target) return
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
      banners: state.banners.filter((item) => item.id !== id),
      unread: target.read ? state.unread : Math.max(0, state.unread - 1),
    }))
    const current = generation
    notificationsApi.remove(id).then(
      ({ unread }) => current === generation && set({ unread }),
      () => {},
    )
  },

  dismissBanner: (id) => set((state) => ({ banners: state.banners.filter((item) => item.id !== id) })),

  reset: () => {
    generation += 1
    primed = false
    inFlight = null
    set({ items: [], unread: 0, status: 'idle', banners: [], arrivals: 0 })
  },
}))
