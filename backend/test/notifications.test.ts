/**
 * Notifications : échange conclu (le créateur de l'offre l'apprend), nouvelle
 * offre intéressante (comptes à qui la carte manque et qui ont la carte
 * demandée), offre devenue inactive, sondage `since`, lecture, effacement,
 * isolement entre comptes, plafond d'alertes par heure.
 */
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('notifications')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')
const { MATCH_BURST } = await import('../src/modules/notifications/notifications.service.js')

const CARDS = ['common-a', 'common-b', 'common-c', 'common-d', 'common-e', 'common-f', 'common-g', 'common-h'] as const

before(async () => {
  await prisma.card.createMany({
    data: CARDS.map((id, index) => ({
      id,
      number: index + 1,
      title: `Œuvre ${id}`,
      name: `Œuvre ${id}`,
      imageUrl: `/api/covers/${index}`,
      rarity: 'COMMON',
      mangaId: `manga-${id}`,
    })),
  })
})

type Account = TestClient & { userId: string }

/* Comptes inscrits une fois (l'inscription est limitée par IP), remis à zéro avant chaque test. */
const pool: Account[] = []
let taken = 0

before(async () => {
  for (let index = 0; index < 4; index += 1) {
    const account = client()
    await account.signUp({ email: `notif-${index}-${Date.now()}@example.com`, password: 'motdepasse-test', displayName: `Lectrice ${index}` })
    const userId = (await account.request('GET', '/auth/me')).body.user.id as string
    pool.push(Object.assign(account, { userId }))
  }
})

beforeEach(async () => {
  taken = 0
  await prisma.notification.deleteMany()
  await prisma.tradeOffer.deleteMany()
  await prisma.userCard.deleteMany()
})

function account(): Account {
  const next = pool[taken]
  taken += 1
  if (!next) throw new Error('Plus de comptes dans le groupe : en ajouter.')
  return next
}

const give = (owner: Account, cardId: string, count: number) =>
  prisma.userCard.upsert({
    where: { userId_cardId: { userId: owner.userId, cardId } },
    create: { userId: owner.userId, cardId, count },
    update: { count },
  })

const list = async (owner: Account, since?: string) =>
  (await owner.request('GET', `/notifications${since ? `?since=${encodeURIComponent(since)}` : ''}`)).body as {
    notifications: { id: string; type: string; data: any; read: boolean; active: boolean; createdAt: string }[]
    unread: number
  }

describe('notifications — accès', () => {
  it('réservé aux comptes : 401 pour un invité', async () => {
    const guest = client()
    assert.equal((await guest.request('GET', '/notifications')).status, 401)
    assert.equal((await guest.request('POST', '/notifications/read', {})).status, 401)
    assert.equal((await guest.request('DELETE', '/notifications/x')).status, 401)
  })
})

describe('notifications — échange conclu', () => {
  it('le créateur de l’offre est prévenu : carte reçue, carte cédée, qui a accepté', async () => {
    const seller = account()
    const buyer = account()
    await give(seller, 'common-a', 2)
    await give(buyer, 'common-b', 1)
    const created = await seller.request('POST', '/trades', { offeredCardId: 'common-a', requestedCardId: 'common-b' })
    assert.equal((await buyer.request('POST', `/trades/${created.body.offer.id}/accept`)).status, 200)

    const { notifications, unread } = await list(seller)
    assert.equal(unread, 1)
    assert.equal(notifications.length, 1)
    const [notification] = notifications
    assert.equal(notification!.type, 'trade_accepted')
    assert.equal(notification!.read, false)
    assert.equal(notification!.data.received.id, 'common-b')
    assert.equal(notification!.data.given.id, 'common-a')
    assert.equal(notification!.data.by.displayName, 'Lectrice 1')
    assert.equal(notification!.data.by.email, undefined)

    // Celui qui accepte sait déjà : rien pour lui (il pouvait recevoir l'alerte de l'offre, mais il l'avait déjà).
    assert.equal((await list(buyer)).notifications.filter((item) => item.type === 'trade_accepted').length, 0)
  })

  it('un échange refusé ne prévient personne', async () => {
    const seller = account()
    const buyer = account()
    await give(seller, 'common-a', 2)
    const created = await seller.request('POST', '/trades', { offeredCardId: 'common-a', requestedCardId: 'common-b' })
    // L'acheteur n'a pas la carte demandée : 409, transaction annulée.
    assert.equal((await buyer.request('POST', `/trades/${created.body.offer.id}/accept`)).status, 409)
    assert.equal((await list(seller)).unread, 0)
  })
})

describe('notifications — nouvelle offre intéressante', () => {
  it('prévient ceux à qui la carte manque et qui ont la carte demandée, eux seuls', async () => {
    const seller = account()
    const interested = account()
    const alreadyHasIt = account()
    const cannotPay = account()
    await give(seller, 'common-a', 2)
    await give(interested, 'common-b', 1)
    await give(alreadyHasIt, 'common-b', 1)
    await give(alreadyHasIt, 'common-a', 1)
    await give(cannotPay, 'common-c', 1)

    const created = await seller.request('POST', '/trades', { offeredCardId: 'common-a', requestedCardId: 'common-b' })
    assert.equal(created.status, 201)

    const mine = await list(interested)
    assert.equal(mine.unread, 1)
    assert.equal(mine.notifications[0]!.type, 'trade_match')
    assert.equal(mine.notifications[0]!.active, true)
    assert.equal(mine.notifications[0]!.data.offerId, created.body.offer.id)
    assert.equal(mine.notifications[0]!.data.offered.id, 'common-a')
    assert.equal(mine.notifications[0]!.data.requested.id, 'common-b')
    assert.equal((await list(alreadyHasIt)).unread, 0)
    assert.equal((await list(cannotPay)).unread, 0)
    assert.equal((await list(seller)).unread, 0)
  })

  it('offre acceptée ou annulée : l’alerte reste, mais n’est plus active', async () => {
    const seller = account()
    const interested = account()
    await give(seller, 'common-a', 3)
    await give(interested, 'common-b', 1)
    await give(interested, 'common-c', 1)
    const first = await seller.request('POST', '/trades', { offeredCardId: 'common-a', requestedCardId: 'common-b' })
    const second = await seller.request('POST', '/trades', { offeredCardId: 'common-a', requestedCardId: 'common-c' })
    assert.equal((await interested.request('POST', `/trades/${first.body.offer.id}/accept`)).status, 200)

    const byOffer = (items: Awaited<ReturnType<typeof list>>['notifications'], id: string) => items.find((item) => item.data.offerId === id)
    let items = (await list(interested)).notifications
    assert.equal(byOffer(items, first.body.offer.id)?.active, false)
    assert.equal(byOffer(items, second.body.offer.id)?.active, true)

    assert.equal((await seller.request('DELETE', `/trades/${second.body.offer.id}`)).status, 200)
    items = (await list(interested)).notifications
    assert.equal(byOffer(items, second.body.offer.id)?.active, false)
  })

  it(`au plus ${MATCH_BURST} alertes par heure pour un même compte`, async () => {
    const seller = account()
    const interested = account()
    // Un doublon par offre, chacune contre la même carte que l'intéressée possède.
    const offered = CARDS.filter((id) => id !== 'common-h')
    for (const id of offered) await give(seller, id, 2)
    await give(interested, 'common-h', 1)
    for (const id of offered) {
      assert.equal((await seller.request('POST', '/trades', { offeredCardId: id, requestedCardId: 'common-h' })).status, 201)
    }
    assert.ok(offered.length > MATCH_BURST)
    assert.equal((await list(interested)).unread, MATCH_BURST)
  })
})

describe('notifications — lecture, sondage, effacement', () => {
  async function twoMatches() {
    const seller = account()
    const reader = account()
    await give(seller, 'common-a', 2)
    await give(seller, 'common-c', 2)
    await give(reader, 'common-b', 1)
    await seller.request('POST', '/trades', { offeredCardId: 'common-a', requestedCardId: 'common-b' })
    // Horodatages distincts : le sondage compare au millième de seconde.
    await new Promise((resolve) => setTimeout(resolve, 15))
    await seller.request('POST', '/trades', { offeredCardId: 'common-c', requestedCardId: 'common-b' })
    return { seller, reader }
  }

  it('since : seulement les plus récentes ; le compte des non lues reste complet', async () => {
    const { reader } = await twoMatches()
    const all = await list(reader)
    assert.equal(all.notifications.length, 2)
    // Les plus récentes d'abord.
    assert.ok(all.notifications[0]!.createdAt > all.notifications[1]!.createdAt)
    const newer = await list(reader, all.notifications[1]!.createdAt)
    assert.equal(newer.notifications.length, 1)
    assert.equal(newer.notifications[0]!.id, all.notifications[0]!.id)
    assert.equal(newer.unread, 2)
    // Date illisible : ignorée, liste complète.
    assert.equal((await reader.request('GET', '/notifications?since=hier')).body.notifications.length, 2)
  })

  it('lire une notification, puis toutes', async () => {
    const { reader } = await twoMatches()
    const [first] = (await list(reader)).notifications
    const one = await reader.request('POST', '/notifications/read', { ids: [first!.id] })
    assert.deepEqual(one.body, { unread: 1 })
    assert.equal((await list(reader)).notifications.find((item) => item.id === first!.id)?.read, true)
    assert.deepEqual((await reader.request('POST', '/notifications/read', {})).body, { unread: 0 })
  })

  it('effacer : la sienne seulement, sans erreur pour celle d’un autre', async () => {
    const { seller, reader } = await twoMatches()
    const [first] = (await list(reader)).notifications
    // Le vendeur ne voit pas les notifications de la lectrice : rien n'est effacé, ni lu.
    assert.equal((await seller.request('DELETE', `/notifications/${first!.id}`)).status, 200)
    assert.equal((await seller.request('POST', '/notifications/read', { ids: [first!.id] })).status, 200)
    let mine = await list(reader)
    assert.equal(mine.notifications.length, 2)
    assert.equal(mine.unread, 2)

    assert.deepEqual((await reader.request('DELETE', `/notifications/${first!.id}`)).body, { unread: 1 })
    mine = await list(reader)
    assert.equal(mine.notifications.length, 1)
  })

  it('au-delà de 30 jours, une notification disparaît', async () => {
    const { reader } = await twoMatches()
    const [first] = (await list(reader)).notifications
    await prisma.notification.update({ where: { id: first!.id }, data: { createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) } })
    assert.equal((await list(reader)).notifications.length, 1)
  })
})
