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

export interface DuplicatesView {
  /** Valeur d'un doublon par rareté ; les Mythiques, invendables, n'y figurent pas. */
  values: Partial<Record<Rarity, number>>
  items: { cardId: string; rarity: Rarity; extra: number; value: number; isFavorite: boolean }[]
}

export interface ConversionResult {
  gained: number
  copies: number
  balance: number
  converted: { cardId: string; copies: number; value: number }[]
}

/** Les séries du set : chaque booster appartient à l'une d'elles. */
export const CARD_SERIES = [1, 2, 3] as const
export type CardSeries = (typeof CARD_SERIES)[number]
/**
 * Séries en jeu : la Série 3 seule. Les Séries 1 et 2 sont retirées (leurs cartes converties en
 * Poussières, cf. `SeriesRetirement`) ; avec une seule série, plus de choix ni de roulette.
 */
export const LIVE_SERIES: readonly CardSeries[] = [3]
/** À l'ouverture : une série, ou la roulette. */
export type SeriesChoice = CardSeries | 'random'

export interface SeriesShowcase {
  series: CardSeries
  size: number
  /** Couvertures des cartes les plus rares de la série. */
  covers: string[]
}

/** Boosters et collection (cf. `backend/src/modules/cards/`). Les routes `guest` servent les boosters d'essai. */
/** Carte retirée (Séries 1 et 2), telle qu'elle était au moment de sa conversion. */
export interface RetiredCard {
  id: string
  number: number
  series: number
  name: string
  title: string
  imageUrl: string
  rarity: Rarity
  /** Exemplaires convertis. */
  count: number
}

/** Bilan du retrait des Séries 1 et 2 pour un compte (cf. `backend/src/modules/cards/retirement/`). */
export interface SeriesRetirement {
  stardust: number
  copies: number
  cards: number
  byRarity: Record<Rarity, { copies: number; stardust: number }>
  /** Les cartes les plus rares converties (l'animation les montre). */
  highlights: RetiredCard[]
  /** Solde de Poussières actuel. */
  balance: number
  createdAt: string
}

export const cardsApi = {
  status: (signal?: AbortSignal) => api<BoosterStatus>('/boosters/status', { signal }),
  /** Ouvre `packs` boosters d'un coup (1 à `MAX_PACKS_AT_ONCE`) : 4 cartes chacun, tirés comme à la suite. */
  open: (series: SeriesChoice, packs = 1) =>
    api<{ cards: PulledCard[]; status: BoosterStatus; series: CardSeries; packs: number }>('/boosters/open', { method: 'POST', body: { series, packs } }),
  /** Ouvre un pack Légendaire offert. 409 `no_legendary_pack` s'il n'en reste pas. */
  openLegendary: () => api<{ cards: PulledCard[]; status: BoosterStatus; series: CardSeries }>('/boosters/legendary/open', { method: 'POST' }),
  /** Les séries et leurs couvertures (illustration des boosters). */
  series: () => api<{ series: SeriesShowcase[] }>('/boosters/series'),
  collection: (signal?: AbortSignal) => api<Collection>('/cards/collection', { signal }),
  /** Doublons convertibles en Poussières (un exemplaire gardé, ceux des offres du Marché réservés) et barème. */
  duplicates: (signal?: AbortSignal) => api<DuplicatesView>('/cards/duplicates', { signal }),
  /** Convertit des doublons : une carte, ou tous ceux des raretés choisies (favoris exceptés). */
  convert: (request: { cardId: string; copies: number } | { items: { cardId: string; copies: number }[] } | { rarities: Exclude<Rarity, 'MYTHIC'>[] }) => api<ConversionResult>('/cards/convert', { method: 'POST', body: request }),
  /** « Informer » : montre des cartes possédées à des membres, prévenus à leur prochaine visite. */
  /** « Informer » : des membres choisis, ou `everyone` (tous les membres, une fois par jour : 429 sinon). */
  share: (cardIds: string[], toUserIds: string[], message: string | null, everyone = false) =>
    api<{ notified: number }>('/cards/share', { method: 'POST', body: { cardIds, toUserIds, message, everyone } }),
  /** Booster d'essai : cartes tirées et leur reçu signé. 409 une fois l'essai épuisé. */
  guestOpen: (receipts: string[], series: SeriesChoice) =>
    api<{ cards: PulledCard[]; receipt: string; remaining: number; series: CardSeries }>('/boosters/guest/open', { method: 'POST', body: { receipts, series } }),
  /** Album d'un invité, reconstitué par le serveur depuis ses reçus. */
  guestCollection: (receipts: string[], signal?: AbortSignal) =>
    api<Collection>('/cards/guest/collection', { method: 'POST', body: { receipts }, signal }),
  /** Bilan du retrait des Séries 1 et 2, tant que son animation n'a pas été vue ; `null` sinon. */
  retirement: () => api<{ retirement: SeriesRetirement | null }>('/cards/retirement'),
  /** L'animation du retrait a été vue jusqu'au bout. */
  retirementSeen: () => api<void>('/cards/retirement/seen', { method: 'POST' }),
  favorite: (cardId: string, isFavorite: boolean) =>
    api<void>(`/cards/${encodeURIComponent(cardId)}/favorite`, { method: 'PATCH', body: { isFavorite } }),
}
