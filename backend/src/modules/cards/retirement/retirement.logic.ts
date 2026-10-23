/**
 * Retrait des Séries 1 et 2 — logique pure (ni réseau ni base), testée
 * (`backend/test/retirement.test.ts`).
 *
 * Chaque exemplaire d'une carte retirée rend des Poussières au barème de la vente des doublons
 * (cf. `duplicates.logic.ts`). Les Mythiques, invendables d'ordinaire, ont ici leur propre valeur :
 * elles disparaissent, elles aussi.
 */
import { RARITIES, isRarity, type Rarity } from '../boosters.logic.js'
import { DUPLICATE_VALUE } from '../duplicates/duplicates.logic.js'

export const RETIREMENT_VALUE: Record<Rarity, number> = { ...DUPLICATE_VALUE, MYTHIC: 1000 }

/** Cartes gardées pour l'animation : les plus rares, puis les plus nombreuses. */
export const MAX_HIGHLIGHTS = 36

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

export type RarityTally = Record<Rarity, { copies: number; stardust: number }>

export interface RetirementSummary {
  stardust: number
  copies: number
  cards: number
  byRarity: RarityTally
  highlights: RetiredCard[]
}

export const emptyTally = (): RarityTally => Object.fromEntries(RARITIES.map((rarity) => [rarity, { copies: 0, stardust: 0 }])) as RarityTally

const rank = (rarity: Rarity) => RARITIES.indexOf(rarity)
const byPrestige = (a: RetiredCard, b: RetiredCard) => rank(b.rarity) - rank(a.rarity) || b.count - a.count || a.number - b.number

/** Ce que rendent des cartes retirées (une rareté inconnue ne rend rien et n'est pas montrée). */
export function summarize(cards: readonly RetiredCard[]): RetirementSummary {
  const byRarity = emptyTally()
  let stardust = 0
  let copies = 0
  const kept: RetiredCard[] = []
  for (const card of cards) {
    if (!isRarity(card.rarity) || card.count <= 0) continue
    const value = RETIREMENT_VALUE[card.rarity] * card.count
    byRarity[card.rarity].copies += card.count
    byRarity[card.rarity].stardust += value
    stardust += value
    copies += card.count
    kept.push(card)
  }
  return { stardust, copies, cards: kept.length, byRarity, highlights: [...kept].sort(byPrestige).slice(0, MAX_HIGHLIGHTS) }
}

/** Une conversion plus tardive (cartes d'essai d'un invité devenu membre) s'ajoute à la première. */
export function mergeSummaries(before: RetirementSummary, added: RetirementSummary): RetirementSummary {
  const byRarity = emptyTally()
  for (const rarity of RARITIES) {
    byRarity[rarity] = {
      copies: (before.byRarity[rarity]?.copies ?? 0) + added.byRarity[rarity].copies,
      stardust: (before.byRarity[rarity]?.stardust ?? 0) + added.byRarity[rarity].stardust,
    }
  }
  const highlights = new Map<string, RetiredCard>()
  for (const card of [...before.highlights, ...added.highlights]) {
    const known = highlights.get(card.id)
    highlights.set(card.id, known ? { ...known, count: known.count + card.count } : card)
  }
  return {
    stardust: before.stardust + added.stardust,
    copies: before.copies + added.copies,
    cards: before.cards + added.cards,
    byRarity,
    highlights: [...highlights.values()].sort(byPrestige).slice(0, MAX_HIGHLIGHTS),
  }
}
