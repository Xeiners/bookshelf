import { create } from 'zustand'
import { bombApi, type BombMode, type BombOverview, type BombReward, type BombRoomView, type SoloView } from '../services/bombApi'
import { useDleStore } from './useDleStore'
import { useGuestStardustStore } from './useGuestStardustStore'

/*
 * Anime Bomb Party : l'écran affiché, le mode choisi, la partie solo ou le salon.
 * Les heures viennent du serveur : `offset` (heure serveur − heure locale, mesurée à
 * chaque réponse) recale la mèche affichée sur la sienne.
 */

type Screen = 'home' | 'solo' | 'room'
const MODE_KEY = 'bookshelf.bomb.mode'

const savedMode = (): BombMode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'manga' ? 'manga' : 'classic'
  } catch {
    return 'classic'
  }
}

interface BombState {
  screen: Screen
  mode: BombMode
  overview: BombOverview | null
  solo: SoloView | null
  room: BombRoomView | null
  /** Frappe en direct du joueur qui tient la bombe. */
  typing: { playerId: string; text: string } | null
  /** Heure serveur − heure locale (ms). */
  offset: number
  /** Invitation reçue (`?bomb=<code>`), rejointe dès que le joueur est prêt. */
  pendingCode: string | null

  loadOverview: () => Promise<void>
  setMode: (mode: BombMode) => void
  startSolo: () => Promise<void>
  setSolo: (view: SoloView, receivedAt?: number) => void
  createRoom: () => Promise<void>
  joinRoom: (code: string) => Promise<void>
  setRoom: (view: BombRoomView, receivedAt?: number) => void
  setTyping: (typing: { playerId: string; text: string } | null) => void
  leaveRoom: () => Promise<void>
  goHome: () => void
  setPendingCode: (code: string | null) => void
  /** Poussières gagnées : solde du compte, ou reçus d'invité gardés sur l'appareil. */
  collect: (reward: BombReward) => void
  reset: () => void
}

export const useBombStore = create<BombState>()((set, get) => ({
  screen: 'home',
  mode: savedMode(),
  overview: null,
  solo: null,
  room: null,
  typing: null,
  offset: 0,
  pendingCode: null,

  loadOverview: async () => set({ overview: await bombApi.overview() }),

  setMode: (mode) => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // Stockage indisponible : le choix vaut pour la session.
    }
    set({ mode })
  },

  startSolo: async () => {
    const sentAt = Date.now()
    const view = await bombApi.startSolo(get().mode)
    get().setSolo(view, (sentAt + Date.now()) / 2)
    set({ screen: 'solo' })
  },

  setSolo: (view, receivedAt = Date.now()) => set({ solo: view, offset: view.serverTime - receivedAt }),

  createRoom: async () => {
    const view = await bombApi.createRoom(get().mode)
    get().setRoom(view)
    set({ screen: 'room', typing: null })
  },

  joinRoom: async (code) => {
    const view = await bombApi.joinRoom(code)
    get().setRoom(view)
    set({ screen: 'room', typing: null, pendingCode: null })
  },

  setRoom: (view, receivedAt = Date.now()) =>
    set((state) => ({
      room: view,
      offset: view.serverTime - receivedAt,
      // La frappe en direct suit le tour : un nouveau porteur repart d'un champ vide.
      typing: view.typing ?? (state.typing && state.typing.playerId === view.turn ? state.typing : null),
    })),

  setTyping: (typing) => set({ typing }),

  leaveRoom: async () => {
    const code = get().room?.code
    set({ room: null, typing: null, screen: 'home' })
    if (code) await bombApi.leaveRoom(code).catch(() => undefined)
    void get().loadOverview().catch(() => undefined)
  },

  goHome: () => {
    set({ screen: 'home', solo: null })
    void get().loadOverview().catch(() => undefined)
  },

  setPendingCode: (pendingCode) => set({ pendingCode }),

  collect: (reward) => {
    for (const receipt of reward.receipts) useGuestStardustStore.getState().add(receipt)
    if (reward.receipts.length === 0 && reward.reward > 0) useDleStore.getState().setStardust(reward.balance)
  },

  reset: () => set({ screen: 'home', overview: null, solo: null, room: null, typing: null, pendingCode: null }),
}))
