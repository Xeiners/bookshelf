/**
 * Retrait des Séries 1 et 2 : barème (doublons, Mythique à part), conversion d'un compte en une
 * transaction, jamais deux fois (appels simultanés, rechargement), animation acquittée, offres du
 * Marché annulées, avatar et vitrine libérés, cartes d'essai d'un invité converties à l'inscription,
 * et la Série 3 seule en jeu (tirages, album, vitrine, Marché).
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('retirement')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/core/db.js')
const { SERIES_3_SIZE, SERIES_3_START_NUMBER } = await import('../src/modules/cards/seeds/series3.seed.js')
const { resetSeriesRetirement, seriesRetired } = await import('../src/modules/cards/series.js')
const { RETIREMENT_VALUE, MAX_HIGHLIGHTS, mergeSummaries, summarize } = await import('../src/modules/cards/retirement/retirement.logic.js')
const { retireAll, retireUser } = await import('../src/modules/cards/retirement/retirement.service.js')
const { signGuestPack } = await import('../src/modules/cards/guestPacks.js')

const OLD = [
  { id: 'o-c', series: 1, rarity: 'COMMON' },
  { id: 'o-r', series: 1, rarity: 'RARE' },
  { id: 'o-e', series: 2, rarity: 'EPIC' },
  { id: 'o-l', series: 2, rarity: 'LEGENDARY' },
  { id: 'o-m', series: 1, rarity: 'MYTHIC' },
] as const

type Account = TestClient & { userId: string }
let taken = 0
async function member(): Promise<Account> {
  taken += 1
  const account = client()
  await account.signUp({ email: `retire-${taken}-${Date.now()}@example.com`, password: 'motdepasse-test', displayName: `Retrait ${taken}` })
  return Object.assign(account, { userId: (await account.request('GET', '/auth/me')).body.user.id as string })
}

const give = (userId: string, cards: Record<string, number>) =>
  prisma.userCard.createMany({ data: Object.entries(cards).map(([cardId, count]) => ({ userId, cardId, count })) })
const balanceOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { stardust: true } })).stardust

before(async () => {
  await prisma.card.createMany({
    data: OLD.map((card, index) => ({ id: card.id, number: index + 1, series: card.series, title: `Œuvre ${card.id}`, name: `Œuvre ${card.id}`, imageUrl: `/api/covers/${index}`, rarity: card.rarity, mangaId: `manga-${card.id}` })),
  })
})

/** La Série 3 complète : c'est elle qui déclenche le retrait. */
async function completeSeries3() {
  await prisma.card.createMany({
    data: Array.from({ length: SERIES_3_SIZE }, (_, index) => ({
      id: `s3_${index}`,
      number: SERIES_3_START_NUMBER + index,
      series: 3,
      title: `Perso ${index}`,
      name: `Perso ${index}`,
      mangaTitle: 'Œuvre',
      imageUrl: `/api/cards/art/s3_${index}`,
      rarity: index < 40 ? 'MYTHIC' : index < 120 ? 'LEGENDARY' : index < 280 ? 'EPIC' : index < 600 ? 'RARE' : 'COMMON',
      mangaId: `mal-character-${index}`,
    })),
  })
  resetSeriesRetirement()
}

describe('retrait des séries 1 et 2', () => {
  it('logique : barème des doublons, Mythique à part, cartes les plus rares en tête, fusion', () => {
    assert.deepEqual(RETIREMENT_VALUE, { COMMON: 5, RARE: 10, EPIC: 25, LEGENDARY: 250, MYTHIC: 1000 })
    const card = (id: string, rarity: 'COMMON' | 'LEGENDARY' | 'MYTHIC', count: number, number = 1) => ({ id, number, series: 1, name: id, title: id, imageUrl: '', rarity, count })
    const first = summarize([card('a', 'COMMON', 3), card('b', 'MYTHIC', 1), card('c', 'LEGENDARY', 2)])
    assert.equal(first.stardust, 3 * 5 + 1000 + 2 * 250)
    assert.equal(first.copies, 6)
    assert.equal(first.cards, 3)
    assert.deepEqual(first.highlights.map((entry) => entry.id), ['b', 'c', 'a'])
    assert.deepEqual(first.byRarity.LEGENDARY, { copies: 2, stardust: 500 })
    const merged = mergeSummaries(first, summarize([card('a', 'COMMON', 1)]))
    assert.equal(merged.stardust, first.stardust + 5)
    assert.equal(merged.highlights.find((entry) => entry.id === 'a')?.count, 4)
    const many = summarize(Array.from({ length: 50 }, (_, index) => card(`x${index}`, 'COMMON', 1, index)))
    assert.equal(many.highlights.length, MAX_HIGHLIGHTS)
    assert.equal(many.cards, 50)
  })

  it('tant que la Série 3 n’est pas complète : rien n’est retiré', async () => {
    const account = await member()
    await give(account.userId, { 'o-c': 2 })
    assert.equal(await seriesRetired(), false)
    assert.equal(await retireUser(account.userId), false)
    assert.equal((await account.request('GET', '/cards/retirement')).body.retirement, null)
    assert.equal(await prisma.userCard.count({ where: { userId: account.userId } }), 1)
    await prisma.userCard.deleteMany({ where: { userId: account.userId } })
  })

  it('convertit tout une seule fois, même appelé en même temps ; le bilan revient jusqu’à être vu', async () => {
    await completeSeries3()
    assert.equal(await seriesRetired(), true)
    const account = await member()
    const other = await member()
    await give(account.userId, { 'o-c': 3, 'o-r': 1, 'o-e': 2, 'o-l': 1, 'o-m': 1, s3_700: 2 })
    await give(other.userId, { 'o-r': 1 })
    await prisma.user.update({ where: { id: account.userId }, data: { stardust: 40, avatarCardId: 'o-l', featuredCardIds: JSON.stringify(['o-m', 's3_700']) } })
    // Ses offres autour des séries retirées, et celle d'un autre qui demande une carte retirée.
    const mine = await prisma.tradeOffer.create({ data: { userId: account.userId, offeredCardId: 'o-c', requestedCardId: 'o-r' } })
    const theirs = await prisma.tradeOffer.create({ data: { userId: other.userId, offeredCardId: 'o-r', requestedCardId: 'o-c' } })

    const expected = 3 * 5 + 10 + 2 * 25 + 250 + 1000
    // Démarrage du serveur et ouverture de l'app au même instant : un seul crédit.
    const [results] = await Promise.all([Promise.all([retireUser(account.userId), retireUser(account.userId), retireUser(account.userId)]), account.request('GET', '/cards/retirement')])
    assert.equal(results.filter(Boolean).length <= 1, true)
    assert.equal(await balanceOf(account.userId), 40 + expected)
    assert.equal(await prisma.stardustEntry.count({ where: { userId: account.userId, reason: 'series_retirement' } }), 1)

    const shown = await account.request('GET', '/cards/retirement')
    assert.equal(shown.status, 200)
    const view = shown.body.retirement
    assert.equal(view.stardust, expected)
    assert.equal(view.copies, 8)
    assert.equal(view.cards, 5)
    assert.equal(view.balance, 40 + expected)
    assert.equal(view.highlights[0].rarity, 'MYTHIC')
    assert.deepEqual(view.byRarity.EPIC, { copies: 2, stardust: 50 })

    // Les cartes retirées ont disparu, la Série 3 reste ; avatar et vitrine libérés.
    assert.deepEqual((await prisma.userCard.findMany({ where: { userId: account.userId } })).map((row) => [row.cardId, row.count]), [['s3_700', 2]])
    const user = await prisma.user.findUniqueOrThrow({ where: { id: account.userId } })
    assert.equal(user.avatarCardId, null)
    assert.deepEqual(JSON.parse(user.featuredCardIds), ['s3_700'])
    assert.equal((await prisma.tradeOffer.findUniqueOrThrow({ where: { id: mine.id } })).status, 'CANCELLED')

    // Rechargement de la page avant la fin de l'animation : même bilan, rien de plus.
    assert.equal((await account.request('GET', '/cards/retirement')).body.retirement.stardust, expected)
    assert.equal(await balanceOf(account.userId), 40 + expected)
    assert.equal((await account.request('POST', '/cards/retirement/seen')).status, 204)
    assert.equal((await account.request('GET', '/cards/retirement')).body.retirement, null)
    assert.equal(await retireUser(account.userId), false)
    assert.equal(await balanceOf(account.userId), 40 + expected)

    // Au démarrage : les autres comptes, et l'offre restante qui demandait une carte retirée.
    await retireAll()
    assert.equal((await prisma.tradeOffer.findUniqueOrThrow({ where: { id: theirs.id } })).status, 'CANCELLED')
    assert.equal(await prisma.userCard.count({ where: { userId: other.userId } }), 0)
    assert.equal(await balanceOf(other.userId), 10)
    assert.equal(await prisma.seriesRetirement.count({ where: { userId: other.userId } }), 1)
  })

  it('la Série 3 seule : tirages, album, vitrine des séries, Marché, cadeaux', async () => {
    const account = await member()
    for (const series of [1, 'random', 3] as const) {
      const opened = await account.request('POST', '/boosters/open', { series })
      assert.equal(opened.status, 200, JSON.stringify(opened.body))
      assert.equal(opened.body.series, 3)
      assert.ok(opened.body.cards.every((pulled: { card: { series: number } }) => pulled.card.series === 3))
    }
    const album = await account.request('GET', '/cards/collection')
    assert.equal(album.body.total, SERIES_3_SIZE)
    assert.ok(album.body.cards.every((card: { series: number }) => card.series === 3))
    const series = await client().request('GET', '/boosters/series')
    assert.deepEqual(series.body.series.map((entry: { series: number }) => entry.series), [3])
    // Un échange autour d'une carte retirée est refusé.
    const offer = await account.request('POST', '/trades', { offeredCardId: 's3_700', requestedCardId: 'o-c' })
    assert.equal(offer.status, 400)
    assert.equal(offer.body.error.code, 'series_retired')
  })

  it('pack Légendaire offert : dernière carte Légendaire ou mieux, jamais ouvert deux fois, stock et garanties intacts', async () => {
    const account = await member()
    await prisma.userBooster.create({ data: { userId: account.userId, legendaryPacks: 2, boostersSinceLastLegendary: 40 } })
    const results = await Promise.all([0, 1, 2].map(() => account.request('POST', '/boosters/legendary/open')))
    const opened = results.filter((result) => result.status === 200)
    assert.equal(opened.length, 2)
    assert.equal(results.find((result) => result.status !== 200)?.body.error.code, 'no_legendary_pack')
    for (const { body } of opened) {
      assert.equal(body.cards.length, 4)
      assert.ok(['LEGENDARY', 'MYTHIC'].includes(body.cards[3].card.rarity))
      assert.ok(body.cards.every((pulled: { card: { series: number } }) => pulled.card.series === 3))
    }
    const row = await prisma.userBooster.findUniqueOrThrow({ where: { userId: account.userId } })
    assert.equal(row.legendaryPacks, 0)
    assert.equal(row.availableBoosters, 3)
    assert.equal(row.boostersSinceLastLegendary, 40)
    const status = await account.request('GET', '/boosters/status')
    assert.equal(status.body.legendaryPacks, 0)
    assert.equal(status.body.available, 3)
  })

  it('inscription d’un invité : ses cartes d’essai retirées deviennent des Poussières, montrées à leur tour', async () => {
    const receipt = signGuestPack(['o-c', 'o-c', 'o-e', 's3_900'])
    const account = client()
    const signed = await account.signUp({ email: `retire-guest-${Date.now()}@example.com`, password: 'motdepasse-test', displayName: 'Invité', guestPacks: [receipt] })
    assert.equal(signed.status, 201)
    const userId = (await account.request('GET', '/auth/me')).body.user.id as string
    assert.deepEqual((await prisma.userCard.findMany({ where: { userId } })).map((row) => row.cardId), ['s3_900'])
    const view = (await account.request('GET', '/cards/retirement')).body.retirement
    assert.equal(view.stardust, 2 * 5 + 25)
    assert.equal(await prisma.stardustEntry.count({ where: { userId, reason: 'series_retirement' } }), 1)
  })
})
