/**
 * Doublons → Poussières : barème par rareté, un exemplaire toujours gardé, exemplaires réservés par
 * une offre du Marché intouchables, conversion d'une carte ou de raretés entières (favoris exceptés),
 * tout-ou-rien, et conversions simultanées qui ne cèdent jamais le même exemplaire.
 */
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { BASE_SLOT_RATES, HIGH_RARITY_SLOT_RATES, RARITIES, WILDCARD_SLOT_RATES } from '../src/modules/cards/boosters.logic.js'
import { CONVERTIBLE_RARITIES, DUPLICATE_VALUE, convertibleCopies } from '../src/modules/cards/duplicates/duplicates.logic.js'
import { BOOSTER_PRICE } from '../src/modules/stardust/prices.js'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('duplicates')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/core/db.js')

const CARDS = [
  { id: 'c1', rarity: 'COMMON' },
  { id: 'c2', rarity: 'COMMON' },
  { id: 'r1', rarity: 'RARE' },
  { id: 'e1', rarity: 'EPIC' },
  { id: 'l1', rarity: 'LEGENDARY' },
  { id: 'm1', rarity: 'MYTHIC' },
] as const

before(async () => {
  await prisma.card.createMany({
    data: CARDS.map((card, index) => ({ id: card.id, number: index + 1, series: 1, title: `Œuvre ${card.id}`, name: `Œuvre ${card.id}`, imageUrl: `/api/covers/${index}`, rarity: card.rarity, mangaId: `manga-${card.id}` })),
  })
})

type Account = TestClient & { userId: string }
const pool: Account[] = []
let taken = 0

before(async () => {
  for (let index = 0; index < 3; index += 1) {
    const account = client()
    await account.signUp({ email: `dup-${index}-${Date.now()}@example.com`, password: 'motdepasse-test', displayName: `Doublon ${index}` })
    pool.push(Object.assign(account, { userId: (await account.request('GET', '/auth/me')).body.user.id as string }))
  }
})

beforeEach(async () => {
  taken = 0
  await prisma.tradeOffer.deleteMany()
  await prisma.userCard.deleteMany()
  await prisma.stardustEntry.deleteMany()
  await prisma.user.updateMany({ data: { stardust: 0 } })
})

const signedUp = (): Account => {
  const account = pool[taken]
  taken += 1
  if (!account) throw new Error('Plus de comptes dans le test.')
  return account
}

const give = (account: Account, cardId: string, count: number, isFavorite = false) =>
  prisma.userCard.upsert({ where: { userId_cardId: { userId: account.userId, cardId } }, create: { userId: account.userId, cardId, count, isFavorite }, update: { count, isFavorite } })
const copies = async (account: Account, cardId: string) => (await prisma.userCard.findUnique({ where: { userId_cardId: { userId: account.userId, cardId } } }))?.count ?? 0
const balance = async (account: Account) => (await prisma.user.findUniqueOrThrow({ where: { id: account.userId } })).stardust

describe('doublons — barème', () => {
  it('croît avec la rareté ; on en garde toujours un et les offres du Marché en réservent', () => {
    const values = CONVERTIBLE_RARITIES.map((rarity) => DUPLICATE_VALUE[rarity])
    assert.deepEqual(values, [5, 10, 25, 250])
    assert.equal(Object.keys(DUPLICATE_VALUE).includes('MYTHIC'), false, 'les Mythiques sont invendables')
    assert.deepEqual(values, [...values].sort((a, b) => a - b))
    assert.equal(convertibleCopies(1, 0), 0)
    assert.equal(convertibleCopies(3, 0), 2)
    assert.equal(convertibleCopies(3, 1), 1)
    assert.equal(convertibleCopies(2, 1), 0)
  })

  it('un booster fait uniquement de doublons rend bien moins que son prix (pas de boucle à Poussières)', () => {
    const slot = (rates: Record<(typeof RARITIES)[number], number>) => CONVERTIBLE_RARITIES.reduce((sum, rarity) => sum + rates[rarity] * DUPLICATE_VALUE[rarity], 0)
    const worstCase = 2 * slot(BASE_SLOT_RATES) + slot(WILDCARD_SLOT_RATES) + slot(HIGH_RARITY_SLOT_RATES)
    assert.ok(worstCase < BOOSTER_PRICE * 0.3, `${worstCase.toFixed(1)} ✦ pour un booster à ${BOOSTER_PRICE} ✦`)
  })
})

describe('doublons — accès et lecture', () => {
  it('réservé aux comptes', async () => {
    const guest = client()
    assert.equal((await guest.request('GET', '/cards/duplicates')).status, 401)
    assert.equal((await guest.request('POST', '/cards/convert', { rarities: ['COMMON'] })).status, 401)
  })

  it('liste les exemplaires libres, leur valeur, et ignore les cartes en un seul exemplaire', async () => {
    const account = signedUp()
    await give(account, 'c1', 3)
    await give(account, 'r1', 1)
    await give(account, 'l1', 2, true)
    await give(account, 'm1', 6)
    const { status, body } = await account.request('GET', '/cards/duplicates')
    assert.equal(status, 200)
    assert.deepEqual(body.values, DUPLICATE_VALUE)
    assert.deepEqual(
      body.items.map((item: { cardId: string; extra: number; value: number; isFavorite: boolean }) => [item.cardId, item.extra, item.value, item.isFavorite]).sort(),
      [['c1', 2, 10, false], ['l1', 1, 250, true]].sort(),
    )
  })
})

describe('doublons — conversion d’une carte', () => {
  it('rend la valeur de la rareté, garde un exemplaire et inscrit le mouvement', async () => {
    const account = signedUp()
    await give(account, 'e1', 4)
    const done = await account.request('POST', '/cards/convert', { cardId: 'e1', copies: 2 })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.deepEqual([done.body.gained, done.body.copies, done.body.balance], [50, 2, 50])
    assert.equal(await copies(account, 'e1'), 2)
    assert.equal(await balance(account), 50)
    const entry = await prisma.stardustEntry.findFirstOrThrow({ where: { userId: account.userId, reason: 'card_convert' } })
    assert.equal(entry.amount, 50)
  })

  it('les Mythiques sont invendables : refusées, même en nombre', async () => {
    const account = signedUp()
    await give(account, 'm1', 5)
    const refused = await account.request('POST', '/cards/convert', { cardId: 'm1', copies: 1 })
    assert.equal(refused.status, 409)
    assert.equal(refused.body.error.code, 'not_convertible')
    assert.equal((await account.request('POST', '/cards/convert', { rarities: ['MYTHIC'] })).status, 400)
    assert.equal(await copies(account, 'm1'), 5)
    assert.equal(await balance(account), 0)
  })

  it('jamais le dernier exemplaire, ni plus que le libre : 409 et rien ne bouge', async () => {
    const account = signedUp()
    await give(account, 'l1', 2)
    const tooMany = await account.request('POST', '/cards/convert', { cardId: 'l1', copies: 2 })
    assert.equal(tooMany.status, 409)
    assert.equal(tooMany.body.error.code, 'not_enough_duplicates')
    assert.equal(await copies(account, 'l1'), 2)
    assert.equal(await balance(account), 0)
    await give(account, 'c1', 1)
    assert.equal((await account.request('POST', '/cards/convert', { cardId: 'c1', copies: 1 })).body.error.code, 'not_enough_duplicates')
    assert.equal((await account.request('POST', '/cards/convert', { cardId: 'c2', copies: 1 })).body.error.code, 'card_not_owned')
    assert.equal((await account.request('POST', '/cards/convert', { cardId: 'c1', copies: 0 })).status, 400)
  })

  it('un exemplaire réservé par une offre ouverte au Marché ne se convertit pas', async () => {
    const account = signedUp()
    await give(account, 'c1', 3)
    assert.equal((await account.request('POST', '/trades', { offeredCardId: 'c1', requestedCardId: 'c2' })).status, 201)
    // Trois exemplaires : un gardé, un réservé par l'offre, donc un seul de libre.
    const view = (await account.request('GET', '/cards/duplicates')).body
    assert.equal(view.items[0].extra, 1)
    assert.equal((await account.request('POST', '/cards/convert', { cardId: 'c1', copies: 2 })).status, 409)
    assert.equal((await account.request('POST', '/cards/convert', { cardId: 'c1', copies: 1 })).status, 200)
    assert.equal(await copies(account, 'c1'), 2)
    // L'offre reste honorable : il reste de quoi la remplir.
    assert.equal((await prisma.tradeOffer.count({ where: { userId: account.userId, status: 'OPEN' } })), 1)
  })
})

describe('doublons — conversion d’une sélection', () => {
  it('seules les cartes choisies sont converties, avec leurs quantités', async () => {
    const account = signedUp()
    await give(account, 'c1', 4)
    await give(account, 'r1', 3)
    await give(account, 'l1', 2)
    const done = await account.request('POST', '/cards/convert', { items: [{ cardId: 'c1', copies: 3 }, { cardId: 'l1', copies: 1 }] })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.deepEqual([done.body.gained, done.body.copies], [15 + 250, 4])
    assert.deepEqual([await copies(account, 'c1'), await copies(account, 'r1'), await copies(account, 'l1')], [1, 3, 1])
    assert.equal(await balance(account), 265)
  })

  it('une seule ligne refusée annule tout : rien n’est converti ni crédité', async () => {
    const account = signedUp()
    await give(account, 'c1', 4)
    await give(account, 'm1', 3)
    for (const bad of [{ cardId: 'm1', copies: 1 }, { cardId: 'c1', copies: 4 }, { cardId: 'c2', copies: 1 }]) {
      const refused = await account.request('POST', '/cards/convert', { items: [{ cardId: 'c1', copies: 1 }, bad] })
      assert.ok([400, 409].includes(refused.status), `${bad.cardId} : ${refused.status}`)
    }
    assert.deepEqual([await copies(account, 'c1'), await copies(account, 'm1'), await balance(account)], [4, 3, 0])
    assert.equal((await account.request('POST', '/cards/convert', { items: [] })).status, 400)
  })

  it('la même carte listée deux fois est comptée une fois, sur le libre', async () => {
    const account = signedUp()
    await give(account, 'r1', 3)
    assert.equal((await account.request('POST', '/cards/convert', { items: [{ cardId: 'r1', copies: 2 }, { cardId: 'r1', copies: 1 }] })).status, 409)
    assert.equal((await account.request('POST', '/cards/convert', { items: [{ cardId: 'r1', copies: 1 }, { cardId: 'r1', copies: 1 }] })).status, 200)
    assert.equal(await copies(account, 'r1'), 1)
  })
})

describe('doublons — conversion par raretés', () => {
  it('toutes les raretés choisies d’un coup, favoris et autres raretés intouchés', async () => {
    const account = signedUp()
    await give(account, 'c1', 4)
    await give(account, 'c2', 2, true)
    await give(account, 'r1', 3)
    await give(account, 'e1', 2)
    await give(account, 'l1', 5)
    await give(account, 'm1', 4)
    const done = await account.request('POST', '/cards/convert', { rarities: ['COMMON', 'RARE'] })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    // c1 : 3 × 5 ; r1 : 2 × 10 ; le favori c2 reste.
    assert.deepEqual([done.body.gained, done.body.copies], [35, 5])
    assert.deepEqual([await copies(account, 'c1'), await copies(account, 'c2'), await copies(account, 'r1'), await copies(account, 'e1'), await copies(account, 'l1')], [1, 2, 1, 2, 5])
    assert.equal(await copies(account, 'm1'), 4)
    assert.equal(await balance(account), 35)
  })

  it('rien à convertir : 409 no_duplicates ; raretés inconnues : 400', async () => {
    const account = signedUp()
    await give(account, 'c1', 1)
    assert.equal((await account.request('POST', '/cards/convert', { rarities: ['COMMON'] })).body.error.code, 'no_duplicates')
    assert.equal((await account.request('POST', '/cards/convert', { rarities: ['SHINY'] })).status, 400)
    assert.equal((await account.request('POST', '/cards/convert', { rarities: [] })).status, 400)
  })
})

describe('doublons — conversions simultanées', () => {
  it('un seul exemplaire libre : une seule des deux requêtes l’emporte, les Poussières ne sont créditées qu’une fois', async () => {
    const account = signedUp()
    await give(account, 'l1', 2)
    const results = await Promise.all([account.request('POST', '/cards/convert', { cardId: 'l1', copies: 1 }), account.request('POST', '/cards/convert', { cardId: 'l1', copies: 1 })])
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409])
    assert.equal(await copies(account, 'l1'), 1)
    assert.equal(await balance(account), 250)
    assert.equal(await prisma.stardustEntry.count({ where: { userId: account.userId, reason: 'card_convert' } }), 1)
  })
})
