import { api } from './api'
import type { PulledCard } from './cardsApi'

/** Récompense quotidienne (cf. `backend/src/modules/daily/`) : un calendrier de 30 jours à prendre d'affilée. */

/** Ce que contient une case. `pack` : le pack du 30e jour (une Légendaire au moins). */
export interface DailyBundle {
  stardust: number
  boosters: number
  /** Boîtes mystère de la garde-robe (cosmétiques). */
  boxes: number
  pack: boolean
}

export type DailyTier = 'common' | 'milestone' | 'grand'
export type DailyState = 'claimed' | 'today' | 'upcoming'

export interface DailyDay {
  day: number
  tier: DailyTier
  reward: DailyBundle
  state: DailyState
}

export interface DailyStatus {
  /** Jour de Paris (`YYYY-MM-DD`). */
  today: string
  /** La case du jour n'est pas prise. */
  claimable: boolean
  /** Case du jour (à prendre) ou dernière prise. */
  day: number
  cycle: number
  /** Jours pris dans ce cycle. */
  streak: number
  bestStreak: number
  totalClaims: number
  /** Une série vient d'être perdue : le calendrier repart du jour 1. */
  broken: boolean
  secondsUntilReset: number
  calendar: DailyDay[]
}

export interface DailyClaim {
  day: number
  reward: DailyBundle
  cards: PulledCard[]
  balance: number
  status: DailyStatus
}

export const CYCLE_DAYS = 30

export const dailyApi = {
  status: (signal?: AbortSignal) => api<DailyStatus>('/daily', { signal }),
  /** 409 `daily_claimed` si la case du jour est déjà prise. */
  claim: () => api<DailyClaim>('/daily/claim', { method: 'POST' }),
}
