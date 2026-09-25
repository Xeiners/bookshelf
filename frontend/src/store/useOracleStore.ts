import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyDraw } from '../lib/oracle'
import { outbox } from '../lib/syncOutbox'
import type { OracleStreak } from '../services/oracleApi'
import type { Book } from '../types/book'

/** Le tirage du jour, tel qu'il a été distribué (reprise possible en cours de rituel). */
export interface TodayDraw {
  day: string
  mood: string
  pace: string
  relaxed: boolean
  /** Tiré dans le jeu de secours local (API injoignable). */
  offline: boolean
  pepite: Book
  /** Deux lectures « dans la même veine ». */
  companions: Book[]
  /** Cartes retournées, dans l'ordre : 0 → 3. */
  revealed: number
}

interface OracleState {
  /** Graine des invités : stable par appareil. Connecté, c'est l'id du compte. */
  deviceId: string
  lastDay: string | null
  streak: number
  best: number
  today: TodayDraw | null
  /** Relances du jour : chacune décale la graine, donc donne un autre tirage. */
  rerolls: { day: string; count: number } | null

  /** Enregistre le tirage du jour et fait avancer la série (une fois par jour). */
  startDraw: (draw: Omit<TodayDraw, 'revealed'>) => void
  revealNext: () => void
  /**
   * Oublie le tirage du jour pour en refaire un (provisoire, le temps de régler
   * le rituel). La série ne bouge pas : un second tirage le même jour ne compte pas.
   */
  reroll: () => void
  /** Retraduction des fiches (changement de langue) : mêmes œuvres, nouveaux textes. */
  refreshBooks: (books: Book[]) => void
  /** Série venue du compte : la plus récente l'emporte. */
  reconcile: (server: OracleStreak) => void
}

const newDeviceId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export const useOracleStore = create<OracleState>()(
  persist(
    (set, get) => ({
      deviceId: newDeviceId(),
      lastDay: null,
      streak: 0,
      best: 0,
      today: null,
      rerolls: null,

      startDraw: (draw) => {
        const next = applyDraw(get(), draw.day)
        set({ ...next, today: { ...draw, revealed: 0 } })
      },

      revealNext: () =>
        set((state) =>
          state.today ? { today: { ...state.today, revealed: Math.min(3, state.today.revealed + 1) } } : state,
        ),

      reroll: () =>
        set((state) => {
          if (!state.today) return state
          const day = state.today.day
          const count = state.rerolls?.day === day ? state.rerolls.count + 1 : 1
          return { today: null, rerolls: { day, count } }
        }),

      refreshBooks: (books) =>
        set((state) => {
          if (!state.today) return state
          const byId = new Map(books.map((book) => [book.id, book]))
          return {
            today: {
              ...state.today,
              pepite: byId.get(state.today.pepite.id) ?? state.today.pepite,
              companions: state.today.companions.map((book) => byId.get(book.id) ?? book),
            },
          }
        }),

      reconcile: (server) => {
        const local = get()
        if (server.lastDay && (!local.lastDay || server.lastDay >= local.lastDay)) {
          set({ lastDay: server.lastDay, streak: server.streak, best: Math.max(local.best, server.best) })
          return
        }
        // Tirage local plus récent (invité, hors-ligne) : on le pousse vers le compte.
        if (local.lastDay) outbox.push({ type: 'oracle', day: local.lastDay, streak: local.streak, at: Date.now() })
      },
    }),
    {
      name: 'bookshelf:oracle:v1',
      version: 1,
      partialize: ({ deviceId, lastDay, streak, best, today, rerolls }) => ({ deviceId, lastDay, streak, best, today, rerolls }),
    },
  ),
)
