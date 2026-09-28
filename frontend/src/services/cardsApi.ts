import type { BoosterStatus, CollectionCard, Rarity } from '../lib/boosters'
import { api } from './api'

/** Carte obtenue dans un booster. */
export interface PulledCard {
  card: Omit<CollectionCard, 'owned' | 'count' | 'isFavorite' | 'obtainedAt'>
  /** Première fois que le compte obtient cette carte. */
  isNew: boolean
  /** Exemplaires possédés après ce booster. */
  count: number
}

export interface Collection {
  total: number
  owned: number
  byRarity: Record<Rarity, { total: number; owned: number }>
  cards: CollectionCard[]
}

/** Boosters et collection (cf. `backend/src/modules/cards/`). Les routes `guest` servent les boosters d'essai. */
export const cardsApi = {
  status: (signal?: AbortSignal) => api<BoosterStatus>('/boosters/status', { signal }),
  open: () => api<{ cards: PulledCard[]; status: BoosterStatus }>('/boosters/open', { method: 'POST' }),
  collection: (signal?: AbortSignal) => api<Collection>('/cards/collection', { signal }),
  /** Booster d'essai : cartes tirées et leur reçu signé. 409 une fois l'essai épuisé. */
  guestOpen: (receipts: string[]) =>
    api<{ cards: PulledCard[]; receipt: string; remaining: number }>('/boosters/guest/open', { method: 'POST', body: { receipts } }),
  /** Album d'un invité, reconstitué par le serveur depuis ses reçus. */
  guestCollection: (receipts: string[], signal?: AbortSignal) =>
    api<Collection>('/cards/guest/collection', { method: 'POST', body: { receipts }, signal }),
  favorite: (cardId: string, isFavorite: boolean) =>
    api<void>(`/cards/${encodeURIComponent(cardId)}/favorite`, { method: 'PATCH', body: { isFavorite } }),
}
