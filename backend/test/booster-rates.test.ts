import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { seededRandom } from '../src/lib/seeded.js'
import {
  BASE_SLOT_RATES,
  CARDS_PER_PACK,
  HARD_PITY_PACKS,
  HIGH_RARITY_SLOT_RATES,
  RARITIES,
  SET_LAYOUT,
  WILDCARD_SLOT_RATES,
  drawPack,
  hasReachedHardPity,
  nextPityCount,
  type Rarity,
} from '../src/modules/cards/boosters.logic.js'

const SET = [1, 2].flatMap((series) =>
  RARITIES.flatMap((rarity) =>
    Array.from({ length: SET_LAYOUT[rarity] }, (_, index) => ({ id: `${series}-${rarity}-${index}`, rarity, series })),
  ),
)

describe('boosters — pool partagé Séries 1 et 2', () => {
  it('simule 10 000 boosters et respecte les probabilités de chaque slot', () => {
    const random = seededRandom('series-one-10k')
    const counts = Array.from({ length: CARDS_PER_PACK }, () =>
      Object.fromEntries(RARITIES.map((rarity) => [rarity, 0])) as Record<Rarity, number>,
    )
    let mythicPacks = 0
    const bySeries = { 1: 0, 2: 0 }
    const packs = 10_000

    for (let pack = 0; pack < packs; pack += 1) {
      const cards = drawPack(SET, random)
      if (cards.some((card) => card.rarity === 'MYTHIC')) mythicPacks += 1
      cards.forEach((card, slot) => {
        counts[slot]![card.rarity as Rarity] += 1
        bySeries[card.series as 1 | 2] += 1
      })
    }

    const expected = [BASE_SLOT_RATES, BASE_SLOT_RATES, BASE_SLOT_RATES, WILDCARD_SLOT_RATES, HIGH_RARITY_SLOT_RATES]
    counts.forEach((slot, index) => {
      for (const rarity of RARITIES) {
        const observed = slot[rarity] / packs
        assert.ok(Math.abs(observed - expected[index]![rarity]) < 0.015, `slot ${index + 1} ${rarity}: ${observed}`)
      }
    })

    // Probabilité exacte sans pity : 1 - (0,99 × 0,95) = 5,95 %.
    assert.ok(mythicPacks / packs > 0.05 && mythicPacks / packs < 0.07, `boosters mythiques : ${mythicPacks}`)
    assert.ok(Math.abs(bySeries[1] / (packs * CARDS_PER_PACK) - 0.5) < 0.015, `Série 1 : ${bySeries[1]}`)
    assert.ok(Math.abs(bySeries[2] / (packs * CARDS_PER_PACK) - 0.5) < 0.015, `Série 2 : ${bySeries[2]}`)
  })

  it('force le slot 5 du 30e booster sec et réinitialise le compteur', () => {
    assert.equal(hasReachedHardPity(HARD_PITY_PACKS - 2), false)
    assert.equal(hasReachedHardPity(HARD_PITY_PACKS - 1), true)

    const cards = drawPack(SET, () => 0, { forceMythic: true })

    assert.equal(cards[4]!.rarity, 'MYTHIC')
    assert.equal(nextPityCount(HARD_PITY_PACKS - 1, cards.map((card) => card.rarity)), 0)
  })
})
