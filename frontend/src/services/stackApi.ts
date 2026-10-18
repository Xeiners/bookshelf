import { api } from './api'
import type { RecordReward } from './rewardsApi'

/** Page Stack (cf. `backend/src/modules/stack/`). Un compte, ou un invité du BookshelfDLE. */
export interface StackStanding {
  rank: number
  userId: string
  name: string | null
  avatarUrl: string | null
  score: number
  me: boolean
}

export interface StackOverview {
  dailyCap: number
  me: { best: number; bestPages: number; earnedToday: number; games: number; totalPages: number; perfects: number }
  leaderboard: StackStanding[]
  myRank: number | null
}

export interface StackResult {
  score: number
  pages: number
  perfects: number
  reward: number
  capped: boolean
  balance: number
  best: number
  bestPages: number
  earnedToday: number
  record: boolean
  /** Invité : les Poussières en reçus signés, gardés sur l'appareil. */
  receipts: string[]
  /** Record de tous les temps battu : la récompense à choisir. */
  recordReward?: RecordReward | null
}

export interface StackCover {
  id: string
  title: string
  /** Couverture relayée par l'API (`/api/covers/…`). */
  url: string
}

export const stackApi = {
  /** Couvertures de tomes (liste vide si la collection n'est pas prête : le jeu dessine ses tomes). */
  covers: (signal?: AbortSignal) => api<{ covers: StackCover[] }>('/stack/covers', { signal }).then((response) => response.covers),
  overview: (signal?: AbortSignal) => api<StackOverview>('/stack', { signal }),
  start: () => api<{ id: string }>('/stack/runs', { method: 'POST' }),
  end: (id: string, run: { score: number; pages: number; perfects: number }) =>
    api<StackResult>(`/stack/runs/${encodeURIComponent(id)}/end`, { method: 'POST', body: run }),
}
