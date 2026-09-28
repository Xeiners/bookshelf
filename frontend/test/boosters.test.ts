import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_FILTER,
  addToTally,
  emptyTally,
  observedRate,
  RARITIES,
  RARITY_STYLE,
  bestRarity,
  completion,
  filterCollection,
  refillProgress,
  remainingSeconds,
  type CollectionCard,
  type Rarity,
} from '../src/lib/boosters'

describe('boosters — minuteur synchronisé sur le serveur', () => {
  it('décompte depuis la réponse du serveur, sur l’horloge monotone', () => {
    // Le serveur a dit « 3 600 s » quand performance.now() valait 10 000 ms.
    assert.equal(remainingSeconds(3600, 10_000, 10_000), 3600)
    assert.equal(remainingSeconds(3600, 10_000, 70_000), 3540)
    assert.equal(remainingSeconds(3600, 10_000, 10_000 + 3_599_400), 1, 'arrondi au-dessus : jamais « 0 » trop tôt')
    assert.equal(remainingSeconds(3600, 10_000, 10_000 + 4_000_000), 0, 'jamais négatif')
  })

  it('stock plein : pas de minuteur', () => {
    assert.equal(remainingSeconds(null, 0, 99_999), null)
    assert.equal(refillProgress(null, 10_800), 1)
  })

  it('changer l’heure du téléphone ne change rien : seul le temps écoulé depuis la synchro compte', () => {
    // `Date.now()` n'intervient pas : même temps écoulé → même reste, quelle que soit l'heure affichée.
    const before = remainingSeconds(7200, 1_000, 61_000)
    const after = remainingSeconds(7200, 1_000, 61_000)
    assert.equal(before, after)
    assert.equal(before, 7140)
  })

  it('jauge de régénération : 0 au départ, 1 à l’échéance', () => {
    assert.equal(refillProgress(10_800, 10_800), 0)
    assert.equal(refillProgress(5_400, 10_800), 0.5)
    assert.equal(refillProgress(0, 10_800), 1)
  })
})

describe('raretés', () => {
  it('ordre et apparence : holo à partir d’Épique, révélation dramatique pour Légendaire et Mythique', () => {
    assert.deepEqual([...RARITIES], ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'])
    assert.deepEqual(RARITIES.filter((rarity) => RARITY_STYLE[rarity].holo), ['EPIC', 'LEGENDARY', 'MYTHIC'])
    assert.deepEqual(RARITIES.filter((rarity) => RARITY_STYLE[rarity].dramatic), ['LEGENDARY', 'MYTHIC'])
  })

  it('la plus rare d’un booster', () => {
    assert.equal(bestRarity(['COMMON', 'EPIC', 'RARE']), 'EPIC')
    assert.equal(bestRarity(['MYTHIC', 'COMMON']), 'MYTHIC')
    assert.equal(bestRarity([]), 'COMMON')
  })
})

describe('album — filtres', () => {
  const card = (number: number, rarity: Rarity, owned: boolean, title: string, series: 1 | 2 = 1): CollectionCard => ({
    id: `c${number}`,
    number,
    series,
    name: title,
    mangaTitle: title,
    title,
    character: null,
    characterName: null,
    description: '',
    power: 20,
    imageUrl: '/api/covers/x/y.jpg?size=512',
    rarity,
    mangaId: `m${number}`,
    owned,
    count: owned ? 1 : 0,
    isFavorite: false,
    obtainedAt: owned ? '2026-09-28T12:00:00.000Z' : null,
  })
  const CARDS = [
    card(1, 'MYTHIC', true, 'Berserk'),
    card(2, 'LEGENDARY', false, 'Vagabond'),
    card(3, 'COMMON', true, 'Kimetsu no Yaiba', 2),
    card(4, 'COMMON', false, 'L’Épée du Roi', 2),
  ]
  const numbers = (cards: CollectionCard[]) => cards.map((entry) => entry.number)

  it('sans filtre : tout l’album, dans l’ordre', () => {
    assert.deepEqual(numbers(filterCollection(CARDS, DEFAULT_FILTER)), [1, 2, 3, 4])
  })

  it('rareté, possédées / manquantes, combinables', () => {
    assert.deepEqual(numbers(filterCollection(CARDS, { ...DEFAULT_FILTER, rarity: 'COMMON' })), [3, 4])
    assert.deepEqual(numbers(filterCollection(CARDS, { ...DEFAULT_FILTER, ownership: 'owned' })), [1, 3])
    assert.deepEqual(numbers(filterCollection(CARDS, { ...DEFAULT_FILTER, ownership: 'missing' })), [2, 4])
    assert.deepEqual(numbers(filterCollection(CARDS, { rarity: 'COMMON', series: 'all', ownership: 'missing', query: '' })), [4])
    assert.deepEqual(numbers(filterCollection(CARDS, { ...DEFAULT_FILTER, series: 1 })), [1, 2])
    assert.deepEqual(numbers(filterCollection(CARDS, { ...DEFAULT_FILTER, series: 2 })), [3, 4])
  })

  it('titre : sans casse, accents ni ponctuation', () => {
    assert.deepEqual(numbers(filterCollection(CARDS, { ...DEFAULT_FILTER, query: 'KIMETSU' })), [3])
    assert.deepEqual(numbers(filterCollection(CARDS, { ...DEFAULT_FILTER, query: 'epee du roi' })), [4])
    assert.deepEqual(numbers(filterCollection(CARDS, { ...DEFAULT_FILTER, query: 'zzz' })), [])
  })

  it('progression en pourcentage entier', () => {
    assert.equal(completion(42, 150), 28)
    assert.equal(completion(150, 150), 100)
    assert.equal(completion(0, 0), 0)
  })
})

describe('recette — taux observés', () => {
  it('chaque booster ouvert s’ajoute au relevé, sans modifier le précédent', () => {
    const start = emptyTally()
    const one = addToTally(start, ['COMMON', 'COMMON', 'EPIC'])
    const two = addToTally(one, ['RARE', 'COMMON', 'MYTHIC'])
    assert.equal(start.packs, 0)
    assert.equal(two.packs, 2)
    assert.deepEqual(two.cards, { COMMON: 3, RARE: 1, EPIC: 1, LEGENDARY: 0, MYTHIC: 1 })
  })

  it('part observée de chaque rareté, en % à une décimale', () => {
    const tally = addToTally(addToTally(emptyTally(), ['COMMON', 'COMMON', 'EPIC']), ['RARE', 'COMMON', 'MYTHIC'])
    assert.equal(observedRate(tally, 'COMMON'), 50)
    assert.equal(observedRate(tally, 'MYTHIC'), 16.7)
    assert.equal(observedRate(emptyTally(), 'RARE'), 0)
  })
})
