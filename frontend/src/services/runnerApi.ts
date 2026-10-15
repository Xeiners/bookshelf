import type { BoxKind, Outfit, Rarity, WardrobeSlot } from '../lib/runner/wardrobe'
import { api } from './api'
import type { RecordReward } from './rewardsApi'

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
  /** Record de tous les temps battu : la récompense à choisir. */
  recordReward?: RecordReward | null
}

export interface WardrobeView {
  items: { id: string; slot: WardrobeSlot; rarity: Rarity }[]
  /** Pièces possédées → exemplaires reçus. */
  owned: Record<string, number>
  outfit: Outfit
  price: number
  /** Prochaine boîte gratuite (ISO) ; `null` : disponible. */
  freeAt: string | null
  pity: number
  pityMax: number
  boxes: number
  /** Boîtes offertes par d'autres membres, à ouvrir. */
  gifts: number
  /** Prix habituel d'une boîte (`price` : celui du moment, promotion comprise). */
  regular: number
  weights: Record<Rarity, number>
  refunds: Record<Rarity, number>
  balance: number
}

export interface BoxOpening {
  item: { id: string; slot: WardrobeSlot; rarity: Rarity }
  duplicate: boolean
  refund: number
  guaranteed: boolean
  free: boolean
  wardrobe: WardrobeView
}

/** Ouvertures en cours, par demande : une même demande n'ouvre qu'une boîte (React peut relancer un effet). */
const openings = new Map<number, Promise<BoxOpening>>()

export const runnerApi = {
  overview: (signal?: AbortSignal) => api<RunnerOverview>('/runner', { signal }),
  start: () => api<{ id: string; seed: number }>('/runner/runs', { method: 'POST' }),
  /** Revivre après un choc : 409 `not_enough_stardust` si le solde ne suffit pas. */
  revive: (id: string) => api<{ cost: number; balance: number; revives: number; nextCost: number | null }>(`/runner/runs/${encodeURIComponent(id)}/revive`, { method: 'POST' }),
  end: (id: string, run: { distance: number; stardust: number; quiz: number }) =>
    api<RunnerResult>(`/runner/runs/${encodeURIComponent(id)}/end`, { method: 'POST', body: run }),
  wardrobe: (signal?: AbortSignal) => api<WardrobeView>('/runner/wardrobe', { signal }),
  /** Boîte mystère : 409 `free_box_not_ready` / `not_enough_stardust`. */
  openBox: (kind: BoxKind, request: number) => {
    const pending = openings.get(request) ?? api<BoxOpening>('/runner/boxes', { method: 'POST', body: { free: kind === 'free', gift: kind === 'gift' } })
    openings.set(request, pending)
    if (openings.size > 8) openings.delete(openings.keys().next().value!)
    return pending
  },
  /** Offrir une boîte à un membre (payée par l'expéditeur) : la garde-robe de l'expéditeur, à jour. */
  giftBox: (to: string, message: string | null) => api<WardrobeView>('/runner/gifts', { method: 'POST', body: { to, message } }),
  setOutfit: (outfit: Outfit) => api<WardrobeView>('/runner/outfit', { method: 'PATCH', body: outfit }),
}
