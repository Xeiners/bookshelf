import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countDuration, decimalsOf, flameLevel, formatHlValue, initialsOf, tierProgress, tierReward } from '../src/lib/higherLower'

const TIERS = [
  { streak: 3, reward: 5 },
  { streak: 5, reward: 15 },
  { streak: 10, reward: 40 },
]

/** Espaces fines insécables du français → espaces simples, pour comparer. */
const plain = (text: string) => text.replace(/[  ]/g, ' ')

describe('Higher or Lower — affichage', () => {
  it('valeurs dans la langue de l’interface', () => {
    assert.equal(plain(formatHlValue(3_000_000_000, 'bounty', 'fr')), '3 000 000 000')
    assert.equal(formatHlValue(3_000_000_000, 'bounty', 'en'), '3,000,000,000')
    assert.equal(formatHlValue(9.2, 'score', 'fr'), '9,20')
    assert.equal(formatHlValue(8.416, 'score', 'en'), '8.42')
    // Pendant le compteur : jamais de décimales parasites sur un entier.
    assert.equal(formatHlValue(519.6, 'chapters', 'en'), '520')
    assert.equal(decimalsOf('score'), 2)
    assert.equal(decimalsOf('sales'), 0)
  })

  it('paliers : récompense et progression', () => {
    assert.deepEqual([0, 3, 4, 5, 12].map((streak) => tierReward(streak, TIERS)), [0, 5, 5, 15, 40])
    assert.deepEqual(tierProgress(0, TIERS), { next: TIERS[0], ratio: 0 })
    assert.deepEqual(tierProgress(4, TIERS), { next: TIERS[1], ratio: 0.5 })
    assert.deepEqual(tierProgress(5, TIERS), { next: TIERS[2], ratio: 0 })
    assert.deepEqual(tierProgress(10, TIERS), { next: null, ratio: 1 })
    assert.deepEqual(tierProgress(3, []), { next: null, ratio: 1 })
  })

  it('flamme de série', () => {
    assert.deepEqual([0, 4, 5, 9, 10, 19, 20, 99].map(flameLevel), [0, 0, 1, 1, 2, 2, 3, 3])
  })

  it('compteur : plus long pour un grand nombre, borné', () => {
    assert.ok(countDuration(9) < countDuration(5_000_000_000))
    assert.ok(countDuration(5_000_000_000) <= 1.5)
    assert.ok(countDuration(0) > 0)
  })

  it('initiales d’une œuvre sans couverture', () => {
    assert.equal(initialsOf('Fist of the North Star'), 'FT')
    assert.equal(initialsOf('One Piece'), 'OP')
    assert.equal(initialsOf('20th Century Boys'), '2C')
    assert.equal(initialsOf('Nana'), 'N')
    assert.equal(initialsOf('Dr. Stone'), 'S')
  })
})
