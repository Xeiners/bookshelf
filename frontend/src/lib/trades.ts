/**
 * Marché d'échange côté front — fonctions pures, testées
 * (`frontend/test/trades.test.ts`). Mêmes règles que l'API
 * (`backend/src/modules/trades/trades.service.ts`) : elle seule tranche, ceci
 * n'évite que des propositions vouées au refus.
 */
import { rarityRank, type CollectionCard } from './boosters'
import type { TradeOffer } from '../services/tradesApi'

/** Exemplaires réservés par mes offres ouvertes, par carte proposée. */
export function reservedCopies(offers: readonly TradeOffer[]): Map<string, number> {
  const reserved = new Map<string, number>()
  for (const offer of offers) {
    if (offer.mine && offer.status === 'OPEN') reserved.set(offer.offered.id, (reserved.get(offer.offered.id) ?? 0) + 1)
  }
  return reserved
}

export interface Duplicate extends CollectionCard {
  /** Exemplaires encore proposables : ni réservés par une offre, ni celui qu'on garde. */
  free: number
}

/**
 * Doublons proposables : au moins deux exemplaires libres (un pour l'offre, un
 * que l'on garde toujours). Dans l'ordre de l'album : des plus rares aux plus communes.
 */
export function offerableDuplicates(cards: readonly CollectionCard[], reserved: ReadonlyMap<string, number>): Duplicate[] {
  return cards
    .map((card) => ({ ...card, free: card.count - (reserved.get(card.id) ?? 0) - 1 }))
    .filter((card) => card.owned && card.free >= 1)
    .sort((a, b) => a.number - b.number)
}

/**
 * Cartes que l'on peut demander contre `offered` : même rareté, autre carte.
 * `missingOnly` : seulement celles absentes de l'album. Manquantes d'abord.
 */
export function requestableFor(
  cards: readonly CollectionCard[],
  offered: Pick<CollectionCard, 'id' | 'rarity'>,
  options: { missingOnly: boolean; query?: string },
): CollectionCard[] {
  const query = normalize(options.query ?? '')
  return cards
    .filter(
      (card) =>
        card.rarity === offered.rarity &&
        card.id !== offered.id &&
        (!options.missingOnly || !card.owned) &&
        (!query || normalize(`${card.name} ${card.mangaTitle}`).includes(query)),
    )
    .sort((a, b) => Number(a.owned) - Number(b.owned) || a.number - b.number)
}

/** Nom d'un collectionneur, ou l'anonyme de repli. */
export const partyName = (party: { displayName: string | null } | null, anonymous: string) =>
  party?.displayName?.trim() || anonymous

/** Mes offres ouvertes d'abord, puis l'historique du plus récent au plus ancien. */
export function splitMine(offers: readonly TradeOffer[]): { open: TradeOffer[]; history: TradeOffer[] } {
  return {
    open: offers.filter((offer) => offer.mine && offer.status === 'OPEN'),
    history: offers
      .filter((offer) => offer.status !== 'OPEN')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  }
}

/**
 * Rafraîchissement du marché sans bousculer l'écran : les offres affichées
 * gardent leur place (mises à jour si l'API les renvoie), celles qui ont
 * disparu sont signalées `gone`, les nouvelles attendent dans `incoming`.
 */
export function diffMarket(
  shown: readonly TradeOffer[],
  fetched: readonly TradeOffer[],
): { market: TradeOffer[]; incoming: TradeOffer[]; gone: string[] } {
  const fresh = new Map(fetched.map((offer) => [offer.id, offer]))
  const shownIds = new Set(shown.map((offer) => offer.id))
  return {
    market: shown.map((offer) => fresh.get(offer.id) ?? offer),
    incoming: fetched.filter((offer) => !shownIds.has(offer.id)),
    gone: shown.filter((offer) => !fresh.has(offer.id)).map((offer) => offer.id),
  }
}

export type MarketSort = 'recent' | 'best'

/**
 * « Pour moi » : d'abord ce que je peux échanger, puis ce qui me manque, puis
 * les plus rares ; à égalité, les plus récentes. « Récentes » : l'ordre de l'API.
 */
export function sortMarket(offers: readonly TradeOffer[], sort: MarketSort): TradeOffer[] {
  if (sort === 'recent') return [...offers]
  return [...offers].sort(
    (a, b) =>
      Number(b.canAccept) - Number(a.canAccept) ||
      Number(a.ownsOffered) - Number(b.ownsOffered) ||
      rarityRank(b.offered.rarity) - rarityRank(a.offered.rarity) ||
      b.createdAt.localeCompare(a.createdAt),
  )
}

/** « Kimetsu no Yaiba » ≈ « kimetsu » : minuscules, sans accents ni ponctuation. */
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
