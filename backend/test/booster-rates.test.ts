import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { seededRandom } from '../src/lib/seeded.js'
import {
  CARDS_PER_PACK,
  HARD_PITY_PACKS,
  LEGENDARY_PITY_PACKS,
  RARITIES,
  SET_LAYOUT,
  drawPack,
  slotRates,
  hasReachedHardPity,
  hasReachedLegendaryPity,
  nextLegendaryPityCount,
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
    let legendaryPacks = 0
    const bySeries = { 1: 0, 2: 0 }
    const packs = 10_000

    for (let pack = 0; pack < packs; pack += 1) {
      const cards = drawPack(SET, random)
      if (cards.some((card) => card.rarity === 'MYTHIC')) mythicPacks += 1
      if (cards.some((card) => card.rarity === 'LEGENDARY')) legendaryPacks += 1
      cards.forEach((card, slot) => {
        counts[slot]![card.rarity as Rarity] += 1
        bySeries[card.series as 1 | 2] += 1
      })
    }

    const expected = Array.from({ length: CARDS_PER_PACK }, (_, slot) => slotRates(slot, CARDS_PER_PACK))
    counts.forEach((slot, index) => {
      for (const rarity of RARITIES) {
        const observed = slot[rarity] / packs
        assert.ok(Math.abs(observed - expected[index]![rarity]) < 0.015, `slot ${index + 1} ${rarity}: ${observed}`)
      }
    })

    // Cartes 3 et 4 : Légendaire 0,5 % et Mythique 0,20 % chacune, soit ≈ 1,00 % et ≈ 0,40 % par booster.
    const legendary = 1 - 0.995 ** 2
    const mythic = 1 - 0.998 ** 2
    assert.ok(Math.abs(mythicPacks / packs - mythic) < 0.003, `boosters mythiques : ${mythicPacks}`)
    assert.ok(Math.abs(legendaryPacks / packs - legendary) < 0.004, `boosters légendaires : ${legendaryPacks}`)
    assert.ok(Math.abs(bySeries[1] / (packs * CARDS_PER_PACK) - 0.5) < 0.015, `Série 1 : ${bySeries[1]}`)
    assert.ok(Math.abs(bySeries[2] / (packs * CARDS_PER_PACK) - 0.5) < 0.015, `Série 2 : ${bySeries[2]}`)
  })

  it('force le dernier slot du 400e booster sec et réinitialise le compteur', () => {
    assert.equal(hasReachedHardPity(HARD_PITY_PACKS - 2), false)
    assert.equal(hasReachedHardPity(HARD_PITY_PACKS - 1), true)

    const cards = drawPack(SET, () => 0, { forceMythic: true })

    assert.equal(cards[CARDS_PER_PACK - 1]!.rarity, 'MYTHIC')
    assert.equal(nextPityCount(HARD_PITY_PACKS - 1, cards.map((card) => card.rarity)), 0)
  })

  it('cartes 1 et 2 : 0 % de Légendaire et de Mythique ; cartes 3 et 4 : 0,5 % et 0,20 % ; chaque table fait 100 %', () => {
    for (let slot = 0; slot < CARDS_PER_PACK; slot += 1) {
      const rates = slotRates(slot, CARDS_PER_PACK)
      const base = slot < 2
      assert.equal(rates.LEGENDARY, base ? 0 : 0.005, `slot ${slot + 1}`)
      assert.equal(rates.MYTHIC, base ? 0 : 0.002, `slot ${slot + 1}`)
      assert.ok(Math.abs(RARITIES.reduce((sum, rarity) => sum + rates[rarity], 0) - 1) < 1e-12, `slot ${slot + 1}`)
    }
  })

  it('garantit une Légendaire (ou mieux) au 125e booster sec, puis remet le compteur à zéro', () => {
    assert.equal(LEGENDARY_PITY_PACKS, 125)
    assert.equal(hasReachedLegendaryPity(LEGENDARY_PITY_PACKS - 2), false)
    assert.equal(hasReachedLegendaryPity(LEGENDARY_PITY_PACKS - 1), true)
    for (const roll of [0, 0.5, 0.7142, 0.72, 0.9999]) {
      const cards = drawPack(SET, () => roll, { forceLegendary: true })
      assert.ok(['LEGENDARY', 'MYTHIC'].includes(cards[CARDS_PER_PACK - 1]!.rarity), `tirage ${roll}`)
    }
    assert.equal(nextLegendaryPityCount(LEGENDARY_PITY_PACKS - 1, ['COMMON', 'RARE', 'EPIC', 'LEGENDARY']), 0)
    assert.equal(nextLegendaryPityCount(50, ['COMMON', 'RARE', 'EPIC', 'MYTHIC']), 0)
    assert.equal(nextLegendaryPityCount(50, ['COMMON', 'RARE', 'EPIC', 'EPIC']), 51)
  })

  it('simulation : au plus 125 boosters sans Légendaire ou mieux, avec la garantie', () => {
    const random = seededRandom('legendary-pity')
    let dry = 0
    let longest = 0
    for (let pack = 0; pack < 40_000; pack += 1) {
      const cards = drawPack(SET, random, { forceLegendary: hasReachedLegendaryPity(dry) })
      dry = nextLegendaryPityCount(dry, cards.map((card) => card.rarity))
      longest = Math.max(longest, dry)
    }
    assert.ok(longest <= LEGENDARY_PITY_PACKS - 1, `série sèche : ${longest}`)
  })
})
