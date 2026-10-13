import { api } from './api'

/** Manga Runner 3D (cf. `backend/src/modules/runner/`). Un compte, ou un invité du BookshelfDLE. */
export interface RunnerStanding {
  rank: number
  userId: string
  name: string | null
  avatarUrl: string | null
  score: number
  me: boolean
}

export interface RunnerOverview {
  dailyCap: number
  quizReward: number
  me: { best: number; bestDistance: number; earnedToday: number; games: number; totalDistance: number }
  leaderboard: RunnerStanding[]
  myRank: number | null
}

export interface RunnerResult {
  distance: number
  stardust: number
  quiz: number
  score: number
  reward: number
  quizReward: number
  capped: boolean
  balance: number
  best: number
  bestDistance: number
  earnedToday: number
  record: boolean
  /** Invité : les Poussières en reçus signés, gardés sur l'appareil. */
  receipts: string[]
}

export const runnerApi = {
  overview: (signal?: AbortSignal) => api<RunnerOverview>('/runner', { signal }),
  start: () => api<{ id: string; seed: number }>('/runner/runs', { method: 'POST' }),
  end: (id: string, run: { distance: number; stardust: number; quiz: number }) =>
    api<RunnerResult>(`/runner/runs/${encodeURIComponent(id)}/end`, { method: 'POST', body: run }),
}
