import { api } from './api'
import type { Rarity } from '../lib/boosters'

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
  /** Salon COOP où je suis encore (reprise après un rechargement). */
  currentCoop: string | null
}

/* ---- COOP : une partie commune, chacun son tour, chances partagées ---------------------- */

export type CoopPhase = 'lobby' | 'playing' | 'results'

export interface CoopPlayer {
  id: string
  name: string | null
  avatarUrl: string | null
  avatar: { imageUrl: string; rarity: Rarity } | null
  title: string | null
  correct: number
  misses: number
  /** Parti en pleine partie (gardé pour le bilan). */
  left: boolean
}

/** Le dernier tour joué : de quoi rejouer la révélation chez tout le monde. */
export interface CoopTurn {
  turn: number
  by: string
  /** `null` : temps écoulé sans réponse. */
  choice: HlChoice | null
  correct: boolean
  current: HlCard
  guessed: HlCard
}

export interface CoopView {
  code: string
  metric: HlMetric
  phase: CoopPhase
  hostId: string
  you: string
  version: number
  serverTime: string
  minPlayers: number
  maxPlayers: number
  players: CoopPlayer[]
  order: string[]
  active: string | null
  turn: number
  turnStartsAt: string | null
  turnEndsAt: string | null
  streak: number
  lives: number
  maxLives: number
  current: HlCard | null
  next: HlCard | null
  last: CoopTurn | null
  result: { streak: number; endedBy: 'lives' | 'exhausted' | null; reward: number | null; balance: number | null; capped: boolean } | null
}

const coop = (code: string) => `/higher-lower/coop/${encodeURIComponent(code)}`

export const higherLowerApi = {
  overview: (signal?: AbortSignal) => api<HlOverview>('/higher-lower', { signal }),
  start: (metric: HlMetric) => api<HlRun>('/higher-lower/runs', { method: 'POST', body: { metric } }),
  guess: (runId: string, choice: HlChoice) => api<HlGuessResult>(`/higher-lower/runs/${runId}/guess`, { method: 'POST', body: { choice } }),
  end: (runId: string) => api<HlResult>(`/higher-lower/runs/${runId}/end`, { method: 'POST' }),

  createCoop: (metric: HlMetric) => api<CoopView>('/higher-lower/coop', { method: 'POST', body: { metric } }),
  joinCoop: (code: string) => api<CoopView>(`${coop(code)}/join`, { method: 'POST' }),
  leaveCoop: (code: string) => api<void>(`${coop(code)}/leave`, { method: 'POST' }),
  coopMetric: (code: string, metric: HlMetric) => api<CoopView>(`${coop(code)}/metric`, { method: 'POST', body: { metric } }),
  startCoop: (code: string) => api<CoopView>(`${coop(code)}/start`, { method: 'POST' }),
  guessCoop: (code: string, choice: HlChoice, turn: number) => api<CoopView>(`${coop(code)}/guess`, { method: 'POST', body: { choice, turn } }),
  /** Attente longue : ne répond qu'au changement qui suit la version `since`. */
  watchCoop: (code: string, since: number | null, signal?: AbortSignal) => api<CoopView>(`${coop(code)}${since === null ? '' : `?v=${since}`}`, { signal }),
}
