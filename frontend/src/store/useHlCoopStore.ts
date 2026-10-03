import { create } from 'zustand'
import { getT } from '../i18n'
import { clockOffset } from '../lib/dle'
import { ApiError } from '../services/api'
import { higherLowerApi, type CoopView, type HlChoice, type HlMetric } from '../services/higherLowerApi'
import { useDleStore } from './useDleStore'
import { useGuestStardustStore } from './useGuestStardustStore'
import { useUiStore } from './useUiStore'

/*
 * Higher or Lower en COOP : le salon vit sur le serveur (cf. `hl.coop.ts`). Le store
 * garde la dernière vue reçue et la tient à jour par attente longue (`watch`), comme
 * les salons du BookshelfDLE. L'écran rejoue chaque tour à partir de `last`.
 */

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

interface HlCoopState {
  room: CoopView | null
  /** Écart entre l'horloge du serveur et celle de l'appareil (ms). */
  offset: number
  /** Invitation reçue (`?hl=<code>`) : rejointe dès que le compte est là. */
  pendingCode: string | null

  setPendingCode: (code: string | null) => void
  applyRoom: (view: CoopView, receivedAt?: number) => void
  create: (metric: HlMetric) => Promise<void>
  join: (code: string) => Promise<void>
  resume: (code: string) => Promise<void>
  leave: () => Promise<void>
  setMetric: (metric: HlMetric) => Promise<void>
  start: () => Promise<void>
  guess: (choice: HlChoice) => Promise<void>
  /** Suit le salon tant qu'il existe ; renvoie de quoi arrêter. */
  watch: () => () => void
  reset: () => void
}

export const useHlCoopStore = create<HlCoopState>((set, get) => ({
  room: null,
  offset: 0,
  pendingCode: null,

  setPendingCode: (pendingCode) => set({ pendingCode }),

  applyRoom: (view, receivedAt = Date.now()) => {
    const current = get().room
    if (current && current.code === view.code && view.version < current.version) return
    const finished = view.phase === 'results' && current?.phase !== 'results'
    set({ room: view, offset: clockOffset(view.serverTime, receivedAt) })
    // Fin de partie : le solde de Poussières suit.
    if (finished && view.result?.balance != null) useDleStore.getState().setStardust(view.result.balance)
    // Invité : ses Poussières en reçus, gardés sur l'appareil (l'inscription les ajoute au compte).
    if (finished) for (const receipt of view.result?.receipts ?? []) useGuestStardustStore.getState().add(receipt)
  },

  create: async (metric) => get().applyRoom(await higherLowerApi.createCoop(metric)),
  join: async (code) => {
    set({ pendingCode: null })
    get().applyRoom(await higherLowerApi.joinCoop(code))
  },
  resume: async (code) => get().applyRoom(await higherLowerApi.watchCoop(code, null)),

  leave: async () => {
    const room = get().room
    set({ room: null })
    if (room) await higherLowerApi.leaveCoop(room.code).catch(() => undefined)
  },

  setMetric: async (metric) => {
    const room = get().room
    if (room) get().applyRoom(await higherLowerApi.coopMetric(room.code, metric))
  },

  start: async () => {
    const room = get().room
    if (room) get().applyRoom(await higherLowerApi.startCoop(room.code))
  },

  guess: async (choice) => {
    const room = get().room
    if (room) get().applyRoom(await higherLowerApi.guessCoop(room.code, choice, room.turn))
  },

  watch: () => {
    const controller = new AbortController()
    void (async () => {
      let failures = 0
      while (!controller.signal.aborted) {
        const room = get().room
        if (!room) return
        try {
          const view = await higherLowerApi.watchCoop(room.code, room.version, controller.signal)
          failures = 0
          get().applyRoom(view)
        } catch (error) {
          if (controller.signal.aborted) return
          // Salon fermé (redémarrage, tout le monde parti) ou exclu pour absence.
          if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
            if (get().room?.code === room.code) {
              set({ room: null })
              useUiStore.getState().notify(getT().hl.coop.closed, 'neutral')
            }
            return
          }
          failures += 1
          await sleep(Math.min(8000, 800 * failures))
        }
      }
    })()
    return () => controller.abort()
  },

  reset: () => set({ room: null, pendingCode: null }),
}))
