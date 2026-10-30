import { api } from './api'
import type { RecordReward } from './rewardsApi'

/** Page Jump (cf. `backend/src/modules/jump/`). Un compte, ou un invité du BookshelfDLE. */
export interface JumpStanding {
  rank: number
  userId: string
  name: string | null
  avatarUrl: string | null
  score: number
  me: boolean
}

export interface JumpOverview {
  dailyCap: number
  me: { best: number; bestHeight: number; earnedToday: number; games: number }
  leaderboard: JumpStanding[]
  myRank: number | null
  /** Personnages possédés (la Lune comprise) et celui choisi. */
  characters: JumpCharacters
}

export interface JumpCharacters {
  owned: string[]
  selected: string
}

export interface JumpResult {
  score: number
  height: number
  stars: number
  stomps: number
  reward: number
  capped: boolean
  balance: number
  best: number
  bestHeight: number
  earnedToday: number
  record: boolean
  /** Invité : les Poussières en reçus signés, gardés sur l'appareil. */
  receipts: string[]
  /** Record de tous les temps battu : la récompense à choisir. */
  recordReward?: RecordReward | null
}

export const jumpApi = {
  overview: (signal?: AbortSignal) => api<JumpOverview>('/jump', { signal }),
  start: () => api<{ id: string }>('/jump/runs', { method: 'POST' }),
  end: (id: string, run: { score: number; height: number; stars: number; stomps: number }) =>
    api<JumpResult>(`/jump/runs/${encodeURIComponent(id)}/end`, { method: 'POST', body: run }),
  /** Achète un personnage (un compte) ; il est choisi aussitôt. 409 `not_enough_stardust`, `character_owned`. */
  buyCharacter: (id: string) => api<JumpCharacters & { balance: number }>(`/jump/characters/${encodeURIComponent(id)}/buy`, { method: 'POST' }),
  selectCharacter: (id: string) => api<JumpCharacters>(`/jump/characters/${encodeURIComponent(id)}/select`, { method: 'POST' }),
}
