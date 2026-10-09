/**
 * Marché d'échange de doublons : création (doublon libre exigé, même rareté),
 * réservation des exemplaires proposés, marché filtré, échange atomique,
 * annulation, et surtout les cas limites — échanges et créations simultanés :
 * aucune carte ne se crée ni ne se perd.
 */
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('trades')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')

const PASSWORD = 'motdepasse-test'

/** Petit set : trois Communes, deux Rares, dont une en Série 2. */
const CARDS = [
  { id: 'common-a', rarity: 'COMMON', series: 1 },
  { id: 'common-b', rarity: 'COMMON', series: 1 },
  { id: 'common-c', rarity: 'COMMON', series: 1 },
  { id: 'rare-a', rarity: 'RARE', series: 1 },
  { id: 'rare-b', rarity: 'RARE', series: 2 },
] as const

before(async () => {
  await prisma.card.createMany({
    data: CARDS.map((card, index) => ({
      id: card.id,
      number: index + 1,
      series: card.series,
      title: `Œuvre ${card.id}`,
      name: `Œuvre ${card.id}`,
      imageUrl: `/api/covers/${index}`,
      rarity: card.rarity,
      mangaId: `manga-${card.id}`,
    })),
  })
})

type Account = TestClient & { userId: string }

/*
 * Quelques comptes inscrits une fois (l'inscription est limitée par IP), remis
 * à zéro avant chaque test : ni carte, ni offre, ni avatar.
 */
const POOL_SIZE = 5
const pool: Account[] = []
let taken = 0

before(async () => {
  for (let index = 0; index < POOL_SIZE; index += 1) {
    const account = client()
    await account.signUp({ email: `trades-${index}-${Date.now()}@example.com`, password: PASSWORD, displayName: `Collectionneuse ${index}` })
    const userId = (await account.request('GET', '/auth/me')).body.user.id as string
    pool.push(Object.assign(account, { userId }))
  }
})

beforeEach(async () => {
  taken = 0
  await prisma.tradeOffer.deleteMany()
  await prisma.userCard.deleteMany()
  await prisma.user.updateMany({ data: { avatarCardId: null, featuredCardIds: '[]' } })
})

/** Un compte du groupe, différent à chaque appel dans un même test. */
async function signedUp(): Promise<Account> {
  const account = pool[taken]
  taken += 1
  if (!account) throw new Error(`Plus de ${POOL_SIZE} comptes dans un test : agrandir POOL_SIZE.`)
  return account
}

/** Exemplaires possédés (sans passer par un booster). */
async function give(account: Account, cardId: string, count: number) {
  await prisma.userCard.upsert({
    where: { userId_cardId: { userId: account.userId, cardId } },
    create: { userId: account.userId, cardId, count },
    update: { count },
  })
}

const copies = async (account: Account, cardId: string) =>
  (await prisma.userCard.findUnique({ where: { userId_cardId: { userId: account.userId, cardId } } }))?.count ?? 0

/** Exemplaires de chaque carte, tous comptes confondus : un échange ne doit jamais changer ce total. */
async function totals(): Promise<Record<string, number>> {
  const rows = await prisma.userCard.groupBy({ by: ['cardId'], _sum: { count: true } })
  return Object.fromEntries(rows.map((row) => [row.cardId, row._sum.count ?? 0]))
}

const offer = (account: Account, offeredCardId: string, requestedCardId: string) =>
  account.request('POST', '/trades', { offeredCardId, requestedCardId })

describe('marché — accès', () => {
  it('réservé aux comptes : 401 pour un invité', async () => {
    const guest = client()
    for (const [method, route] of [['GET', '/trades'], ['GET', '/trades/mine'], ['POST', '/trades'], ['POST', '/trades/x/accept'], ['DELETE', '/trades/x']] as const) {
      assert.equal((await guest.request(method, route, method === 'POST' ? {} : undefined)).status, 401, route)
    }
  })
})

describe('marché — créer une offre', () => {
  it('sans doublon : 409 not_duplicate (une seule carte, ou aucune)', async () => {
    const seller = await signedUp()
    await give(seller, 'common-a', 1)
    assert.equal((await offer(seller, 'common-a', 'common-b')).body.error.code, 'not_duplicate')
    assert.equal((await offer(seller, 'common-c', 'common-b')).body.error.code, 'not_duplicate')
  })

  it('un doublon : l’offre est ouverte, et l’exemplaire proposé est réservé', async () => {
    const seller = await signedUp()
    await give(seller, 'common-a', 2)
    const created = await offer(seller, 'common-a', 'common-b')
    assert.equal(created.status, 201)
    assert.equal(created.body.offer.status, 'OPEN')
    assert.equal(created.body.offer.offered.id, 'common-a')
    assert.equal(created.body.offer.requested.id, 'common-b')
    assert.equal(created.body.offer.mine, true)
    // Deux exemplaires : un proposé, un gardé. Une seconde offre n'a plus de doublon libre.
    const second = await offer(seller, 'common-a', 'common-c')
    assert.equal(second.status, 409)
    assert.equal(second.body.error.code, 'not_duplicate')
    // Proposer ne retire encore rien de l'album.
    assert.equal(await copies(seller, 'common-a'), 2)
  })

  it('trois exemplaires : deux offres possibles, jamais deux fois la même', async () => {
    const seller = await signedUp()
    await give(seller, 'common-a', 3)
    assert.equal((await offer(seller, 'common-a', 'common-b')).status, 201)
    assert.equal((await offer(seller, 'common-a', 'common-b')).body.error.code, 'offer_exists')
    assert.equal((await offer(seller, 'common-a', 'common-c')).status, 201)
  })

  it('même rareté, autre carte, carte connue', async () => {
    const seller = await signedUp()
    await give(seller, 'common-a', 2)
    assert.equal((await offer(seller, 'common-a', 'rare-a')).body.error.code, 'rarity_mismatch')
    assert.equal((await offer(seller, 'common-a', 'common-a')).body.error.code, 'same_card')
    assert.equal((await offer(seller, 'common-a', 'nexiste-pas')).status, 404)
    assert.equal((await seller.request('POST', '/trades', { offeredCardId: 'common-a' })).status, 400)
  })

  it('créations simultanées sur le même doublon : une seule passe', async () => {
    const seller = await signedUp()
    await give(seller, 'common-a', 2)
    const results = await Promise.all([offer(seller, 'common-a', 'common-b'), offer(seller, 'common-a', 'common-c')])
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409])
    assert.equal(await prisma.tradeOffer.count({ where: { userId: seller.userId, status: 'OPEN' } }), 1)
  })
})

describe('marché — les offres des autres', () => {
  it('filtres, offres propres exclues, « remplissables » seulement', async () => {
    const seller = await signedUp()
    const buyer = await signedUp()
    await give(seller, 'common-a', 2)
    await give(seller, 'rare-b', 2)
    const common = (await offer(seller, 'common-a', 'common-b')).body.offer.id as string
    const rare = (await offer(seller, 'rare-b', 'rare-a')).body.offer.id as string

    const ids = async (account: Account, query = '') =>
      ((await account.request('GET', `/trades${query}`)).body.offers as { id: string }[]).map((entry) => entry.id)

    assert.ok(!(await ids(seller)).includes(common), 'ses propres offres ne sont pas au marché')
    const market = await ids(buyer)
    assert.ok(market.includes(common) && market.includes(rare))
    assert.ok(!(await ids(buyer, '?rarity=COMMON')).includes(rare))
    assert.ok((await ids(buyer, '?series=2')).includes(rare))
    assert.ok(!(await ids(buyer, '?series=2')).includes(common))
    // Valeur inconnue : ignorée, pas refusée.
    assert.equal((await buyer.request('GET', '/trades?rarity=PLATINE&series=9')).status, 200)

    // Sans la carte demandée : visible, mais pas « remplissable ».
    const listed = (await buyer.request('GET', '/trades')).body.offers.find((entry: { id: string }) => entry.id === common)
    assert.equal(listed.canAccept, false)
    assert.ok(!(await ids(buyer, '?fillable=1')).includes(common))
    await give(buyer, 'common-b', 1)
    const fillable = (await buyer.request('GET', '/trades?fillable=1')).body.offers
    assert.ok(fillable.some((entry: { id: string; canAccept: boolean }) => entry.id === common && entry.canAccept))
    // L'adresse e-mail du créateur ne fuit jamais.
    assert.deepEqual(Object.keys(listed.owner).sort(), ['displayName', 'id'])
  })
})

describe('marché — échange', () => {
  it('les deux cartes changent de main ; le dernier exemplaire donné quitte l’album', async () => {
    const seller = await signedUp()
    const buyer = await signedUp()
    await give(seller, 'common-a', 2)
    await give(buyer, 'common-b', 1)
    const id = (await offer(seller, 'common-a', 'common-b')).body.offer.id as string
    const before = await totals()

    const accepted = await buyer.request('POST', `/trades/${id}/accept`)
    assert.equal(accepted.status, 200)
    assert.equal(accepted.body.offer.status, 'COMPLETED')
    assert.equal(accepted.body.offer.acceptedBy.id, buyer.userId)
    assert.equal(accepted.body.received.id, 'common-a')
    assert.equal(accepted.body.given.id, 'common-b')

    assert.equal(await copies(seller, 'common-a'), 1)
    assert.equal(await copies(seller, 'common-b'), 1)
    assert.equal(await copies(buyer, 'common-a'), 1)
    assert.equal(await prisma.userCard.count({ where: { userId: buyer.userId, cardId: 'common-b' } }), 0)
    assert.deepEqual(await totals(), before, 'aucune carte créée ni perdue')

    // Une offre acceptée ne se rejoue pas.
    assert.equal((await buyer.request('POST', `/trades/${id}/accept`)).body.error.code, 'offer_closed')
  })

  it('refus sans effet : sa propre offre, carte absente, carte réservée par ses offres', async () => {
    const seller = await signedUp()
    const buyer = await signedUp()
    await give(seller, 'common-a', 2)
    const id = (await offer(seller, 'common-a', 'common-b')).body.offer.id as string

    assert.equal((await seller.request('POST', `/trades/${id}/accept`)).body.error.code, 'own_offer')
    assert.equal((await buyer.request('POST', `/trades/${id}/accept`)).body.error.code, 'card_not_available')

    // Deux exemplaires, dont un proposé ailleurs : céder le second romprait la réservation.
    await give(buyer, 'common-b', 2)
    assert.equal((await offer(buyer, 'common-b', 'common-c')).status, 201)
    const reserved = await buyer.request('POST', `/trades/${id}/accept`)
    assert.equal(reserved.status, 409)
    assert.equal(reserved.body.error.code, 'card_not_available')

    // Rien n'a bougé : l'offre reste ouverte, les albums intacts.
    assert.equal((await prisma.tradeOffer.findUniqueOrThrow({ where: { id } })).status, 'OPEN')
    assert.equal(await copies(seller, 'common-a'), 2)
    assert.equal(await copies(buyer, 'common-b'), 2)
    assert.equal(await copies(buyer, 'common-a'), 0)

    // Un troisième exemplaire libère l'échange.
    await give(buyer, 'common-b', 3)
    assert.equal((await buyer.request('POST', `/trades/${id}/accept`)).status, 200)
  })

  it('acceptations simultanées : un seul échange, aucune carte dupliquée ni perdue', async () => {
    const seller = await signedUp()
    const buyers = await Promise.all([signedUp(), signedUp(), signedUp()])
    await give(seller, 'rare-a', 2)
    for (const buyer of buyers) await give(buyer, 'rare-b', 1)
    const id = (await offer(seller, 'rare-a', 'rare-b')).body.offer.id as string
    const before = await totals()

    const results = await Promise.all(buyers.map((buyer) => buyer.request('POST', `/trades/${id}/accept`)))
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409, 409])
    assert.ok(results.filter((result) => result.status === 409).every((result) => result.body.error.code === 'offer_closed'))

    assert.deepEqual(await totals(), before)
    assert.equal(await copies(seller, 'rare-a'), 1)
    assert.equal(await copies(seller, 'rare-b'), 1)
    const winners = await Promise.all(buyers.map((buyer) => copies(buyer, 'rare-a')))
    assert.deepEqual(winners.sort(), [0, 0, 1])
  })

  it('deux offres du même doublon acceptées en même temps : le créateur garde toujours un exemplaire', async () => {
    const seller = await signedUp()
    const [first, second] = await Promise.all([signedUp(), signedUp()])
    await give(seller, 'common-c', 3)
    await give(first, 'common-a', 1)
    await give(second, 'common-b', 1)
    const a = (await offer(seller, 'common-c', 'common-a')).body.offer.id as string
    const b = (await offer(seller, 'common-c', 'common-b')).body.offer.id as string
    const before = await totals()

    await Promise.all([first.request('POST', `/trades/${a}/accept`), second.request('POST', `/trades/${b}/accept`)])
    assert.ok((await copies(seller, 'common-c')) >= 1)
    assert.deepEqual(await totals(), before)
  })

  it('carte cédée qui était l’avatar et en vitrine : retirée du profil', async () => {
    const seller = await signedUp()
    const buyer = await signedUp()
    await give(seller, 'rare-a', 2)
    await give(buyer, 'rare-b', 1)
    await buyer.request('PATCH', '/profile', { avatarCardId: 'rare-b', featuredCardIds: ['rare-b'] })
    const id = (await offer(seller, 'rare-a', 'rare-b')).body.offer.id as string
    assert.equal((await buyer.request('POST', `/trades/${id}/accept`)).status, 200)

    const user = await prisma.user.findUniqueOrThrow({ where: { id: buyer.userId } })
    assert.equal(user.avatarCardId, null)
    assert.deepEqual(JSON.parse(user.featuredCardIds), [])
  })
})

describe('marché — annuler, suivre ses échanges', () => {
  it('annuler libère le doublon ; seulement sa propre offre, et une seule fois', async () => {
    const seller = await signedUp()
    const other = await signedUp()
    await give(seller, 'common-a', 2)
    const id = (await offer(seller, 'common-a', 'common-b')).body.offer.id as string

    assert.equal((await other.request('DELETE', `/trades/${id}`)).status, 404)
    const cancelled = await seller.request('DELETE', `/trades/${id}`)
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.body.offer.status, 'CANCELLED')
    assert.equal((await seller.request('DELETE', `/trades/${id}`)).body.error.code, 'offer_closed')
    await give(other, 'common-b', 1)
    assert.equal((await other.request('POST', `/trades/${id}/accept`)).body.error.code, 'offer_closed')
    // Le doublon est de nouveau libre.
    assert.equal((await offer(seller, 'common-a', 'common-c')).status, 201)
  })

  it('« Mes échanges » : mes offres ouvertes d’abord, puis l’historique, y compris ce que j’ai accepté', async () => {
    const seller = await signedUp()
    const buyer = await signedUp()
    await give(seller, 'common-a', 3)
    await give(buyer, 'common-b', 1)
    const done = (await offer(seller, 'common-a', 'common-b')).body.offer.id as string
    const open = (await offer(seller, 'common-a', 'common-c')).body.offer.id as string
    await buyer.request('POST', `/trades/${done}/accept`)

    const mine = (await seller.request('GET', '/trades/mine')).body.offers as { id: string; status: string }[]
    assert.deepEqual(mine.map((entry) => [entry.id, entry.status]), [[open, 'OPEN'], [done, 'COMPLETED']])
    const accepted = (await buyer.request('GET', '/trades/mine')).body.offers as { id: string; mine: boolean }[]
    assert.deepEqual(accepted.map((entry) => [entry.id, entry.mine]), [[done, false]])
  })
})

describe('cadeau de carte à un membre', () => {
  it('un exemplaire passe de mon album au sien, avec une notification signée', async () => {
    const [ana, bob] = [await signedUp(), await signedUp()]
    await give(ana, 'common-a', 2)
    const before = await totals()
    const gift = await ana.request('POST', '/cards/common-a/gift', { toUserId: bob.userId, message: '  Pour ta collection !  ' })
    assert.equal(gift.status, 200, JSON.stringify(gift.body))
    assert.equal(gift.body.remaining, 1)
    assert.equal(gift.body.to.id, bob.userId)
    assert.equal(await copies(ana, 'common-a'), 1)
    assert.equal(await copies(bob, 'common-a'), 1)
    assert.deepEqual(await totals(), before, 'un cadeau ne crée ni ne détruit de carte')
    const { body } = await bob.request('GET', '/notifications')
    const notification = body.notifications.find((item: { type: string }) => item.type === 'card_gift')
    assert.ok(notification, JSON.stringify(body))
    assert.equal(notification.data.card.id, 'common-a')
    assert.equal(notification.data.message, 'Pour ta collection !')
    assert.equal(notification.data.from.id, ana.userId)
  })

  it('le dernier exemplaire quitte l’album ; ni à soi-même, ni une carte qu’on n’a pas', async () => {
    const [ana, bob] = [await signedUp(), await signedUp()]
    await give(ana, 'rare-a', 1)
    assert.equal((await ana.request('POST', '/cards/rare-a/gift', { toUserId: ana.userId })).status, 400)
    const last = await ana.request('POST', '/cards/rare-a/gift', { toUserId: bob.userId })
    assert.equal(last.status, 200)
    assert.equal(last.body.remaining, 0)
    assert.equal(await prisma.userCard.count({ where: { userId: ana.userId, cardId: 'rare-a' } }), 0)
    const again = await ana.request('POST', '/cards/rare-a/gift', { toUserId: bob.userId })
    assert.equal(again.status, 409)
    assert.equal(again.body.code ?? again.body.error?.code ?? 'gift_unavailable', 'gift_unavailable')
    assert.equal((await ana.request('POST', '/cards/common-a/gift', { toUserId: 'inconnu' })).status, 404)
  })

  it('un exemplaire réservé par une offre ouverte au Marché ne peut pas partir', async () => {
    const [ana, bob] = [await signedUp(), await signedUp()]
    await give(ana, 'common-a', 2)
    assert.equal((await offer(ana, 'common-a', 'common-b')).status, 201)
    // Deux exemplaires, une offre ouverte : il en faut trois pour pouvoir en céder un.
    assert.equal((await ana.request('POST', '/cards/common-a/gift', { toUserId: bob.userId })).status, 409)
    assert.equal(await copies(ana, 'common-a'), 2)
  })
})
