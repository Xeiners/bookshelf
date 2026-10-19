/**
 * Conversion des doublons en Poussières — logique pure (ni réseau ni base), testée
 * (`backend/test/duplicates.test.ts`).
 *
 * Un exemplaire en plus rend d'autant plus que la carte est rare. Le barème reste très en dessous
 * du prix d'un booster (340 ✦) : même un booster composé de quatre doublons ne rend qu'environ
 * un quart de son prix, de sorte qu'acheter des boosters pour les convertir ne crée pas de Poussières.
 */
import type { Rarity } from './boosters.logic.js'

export const DUPLICATE_VALUE: Record<Rarity, number> = {
  COMMON: 5,
  RARE: 10,
  EPIC: 25,
  LEGENDARY: 250,
  MYTHIC: 700,
}

/** Cartes distinctes au plus par conversion groupée. */
export const MAX_CONVERT_CARDS = 1000

/**
 * Exemplaires convertibles d'une carte : on en garde toujours un, et chaque offre ouverte au
 * Marché en réserve un (comme pour proposer ou céder une carte, cf. `trades.service.ts`).
 */
export const convertibleCopies = (count: number, reserved: number): number => Math.max(0, count - 1 - reserved)

export const valueOf = (rarity: Rarity, copies: number): number => DUPLICATE_VALUE[rarity] * copies
