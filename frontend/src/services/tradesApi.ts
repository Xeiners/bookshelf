import type { CardSeries, Rarity } from '../lib/boosters'
import { api } from './api'
import type { PulledCard } from './cardsApi'

/** Fiche d'une carte, sans ce que le compte en possède. */
export type TradeCard = PulledCard['card']

export type TradeStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED'

export interface TradeParty {
  id: string
  /** `null` : pas de pseudo (l'adresse e-mail n'est jamais transmise). */
  displayName: string | null
}

/** Offre d'échange (cf. `backend/src/modules/trades/`). */
export interface TradeOffer {
  id: string
  status: TradeStatus
  createdAt: string
  updatedAt: string
  /** Le doublon proposé : ce que reçoit celui qui accepte. */
  offered: TradeCard
  /** La carte demandée : ce qu'il cède. */
  requested: TradeCard
  owner: TradeParty
  acceptedBy: TradeParty | null
  mine: boolean
  /** Le compte peut accepter (exemplaire libre de la carte demandée). */
  canAccept: boolean
  /** Le compte possède déjà la carte proposée. */
  ownsOffered: boolean
}

export interface MarketQuery {
  rarity: Rarity | 'all'
  series: CardSeries | 'all'
  fillable: boolean
}

export interface TradeResult {
  offer: TradeOffer
  received: TradeCard
  given: TradeCard
}

const queryOf = ({ rarity, series, fillable }: MarketQuery) => {
  const params = new URLSearchParams()
  if (rarity !== 'all') params.set('rarity', rarity)
  if (series !== 'all') params.set('series', String(series))
  if (fillable) params.set('fillable', '1')
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** Marché d'échange de doublons. Réservé aux comptes. */
export const tradesApi = {
  market: (query: MarketQuery, signal?: AbortSignal) => api<{ offers: TradeOffer[] }>(`/trades${queryOf(query)}`, { signal }),
  mine: (signal?: AbortSignal) => api<{ offers: TradeOffer[] }>('/trades/mine', { signal }),
  create: (offeredCardId: string, requestedCardId: string) =>
    api<{ offer: TradeOffer }>('/trades', { method: 'POST', body: { offeredCardId, requestedCardId } }),
  accept: (id: string) => api<TradeResult>(`/trades/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  cancel: (id: string) => api<{ offer: TradeOffer }>(`/trades/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
