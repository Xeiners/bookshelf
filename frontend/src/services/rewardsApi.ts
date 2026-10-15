import { api } from './api'
import type { RecordGame } from './notificationsApi'

/** Récompenses de record (cf. `backend/src/modules/rewards/`) : un booster ou une boîte mystère, au choix. */
export interface RecordReward {
  id: string
  game: RecordGame
  score: number
  previous: number
  createdAt: string
}

export type RewardChoice = 'booster' | 'box'

export const rewardsApi = {
  pending: () => api<{ rewards: RecordReward[] }>('/rewards').then((response) => response.rewards),
  /** 409 `reward_claimed` si elle a déjà été choisie. */
  claim: (id: string, choice: RewardChoice) => api<{ choice: RewardChoice; pending: RecordReward[] }>(`/rewards/${encodeURIComponent(id)}/claim`, { method: 'POST', body: { choice } }),
}
