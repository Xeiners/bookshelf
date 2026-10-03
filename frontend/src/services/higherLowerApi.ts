import { api } from './api'

/* Higher or Lower (cf. `backend/src/modules/higherlower/`). */

export const HL_METRICS = ['bounty', 'sales', 'chapters', 'score'] as const
export type HlMetric = (typeof HL_METRICS)[number]
export type HlChoice = 'higher' | 'lower'

export interface HlCard {
  id: string
  name: string
  image: string | null
  /** `null` tant que la carte est à deviner. */
  value: number | null
}

export interface HlRun {
  id: string
  metric: HlMetric
  /** Bonnes réponses de la partie (une erreur pardonnée ne les efface pas). */
  streak: number
  /** Chances restantes. */
  lives: number
  current: HlCard
  next: HlCard
}

export interface HlResult {
  streak: number
  metric: HlMetric
  reward: number
  balance: number
  best: number
  todayBest: number
  earnedToday: number
  record: boolean
  dayRecord: boolean
  capped: boolean
}

export interface HlGuessResult {
  correct: boolean
  value: number
  streak: number
  lives: number
  next: HlCard | null
  result: HlResult | null
}

export interface HlTier {
  streak: number
  reward: number
}

export interface HlStanding {
  rank: number
  userId: string
  name: string | null
  avatarUrl: string | null
  streak: number
  metric: HlMetric | null
  me: boolean
}

export interface HlOverview {
  day: string
  lives: number
  metrics: { metric: HlMetric; count: number }[]
  /** Duel d'exemple de chaque terrain (vitrine de l'accueil). */
  samples: Record<HlMetric, { current: HlCard; next: HlCard }>
  tiers: HlTier[]
  dailyCap: number
  me: { best: number; bestMetric: HlMetric | null; todayBest: number; earnedToday: number; games: number }
  leaderboard: { today: HlStanding[]; allTime: HlStanding[]; myToday: number | null; myAllTime: number | null }
}

export const higherLowerApi = {
  overview: (signal?: AbortSignal) => api<HlOverview>('/higher-lower', { signal }),
  start: (metric: HlMetric) => api<HlRun>('/higher-lower/runs', { method: 'POST', body: { metric } }),
  guess: (runId: string, choice: HlChoice) => api<HlGuessResult>(`/higher-lower/runs/${runId}/guess`, { method: 'POST', body: { choice } }),
  end: (runId: string) => api<HlResult>(`/higher-lower/runs/${runId}/end`, { method: 'POST' }),
}
