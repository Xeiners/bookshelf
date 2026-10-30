/**
 * Promotions (prix réduit d'un booster ou d'une boîte, décidé par un administrateur,
 * annoncé à tous) et récompenses de record (record de tous les temps battu : un booster
 * ou une boîte mystère, au choix).
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('promotions')
process.env.ADMIN_EMAILS = 'promo-chef@example.com'
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/core/db.js')
const { BOOSTER_PRICE } = await import('../src/modules/stardust/prices.js')
const { BOX_PRICE, WELCOME_GIFT_BOXES } = await import('../src/modules/runner/runner.wardrobe.js')

type Account = TestClient & { userId: string }
async function account(name: string, email = `${name.toLowerCase()}-${Date.now()}@example.com`): Promise<Account> {
  const device = client()
  const signed = await device.signUp({ email, password: 'motdepasse-test', displayName: name })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(device, { userId: signed.body.user.id as string })
}

describe('Promotions', () => {
  it('un administrateur baisse le prix d’un booster : tout le monde est prévenu, l’achat débite le prix réduit', async () => {
    const chef = await account('Chef', 'promo-chef@example.com')
    const lea = await account('Lea')
    assert.equal((await lea.request('POST', '/admin/promotions', { target: 'booster', price: 60, hours: 24 })).status, 404, 'réservé aux administrateurs')
    assert.equal((await chef.request('POST', '/admin/promotions', { target: 'booster', price: BOOSTER_PRICE, hours: 24 })).status, 400, 'pas une baisse')

    const created = await chef.request('POST', '/admin/promotions', { target: 'booster', price: 60, hours: 24, message: '  Soldes d’automne !  ' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal(created.body.promotion.price, 60)
    assert.equal(created.body.promotion.regular, BOOSTER_PRICE)
    assert.equal(created.body.promotion.message, 'Soldes d’automne !')
    assert.ok(created.body.notified >= 2)

    const notifications = (await lea.request('GET', '/notifications')).body.notifications
    const promo = notifications.find((notification: { type: string }) => notification.type === 'promotion')
    assert.ok(promo, 'notification reçue')
    assert.equal(promo.data.price, 60)
    assert.equal(promo.active, true)

    assert.deepEqual(
      (await client().request('GET', '/promotions')).body.promotions.map((item: { target: string; price: number }) => [item.target, item.price]),
      [['booster', 60]],
    )
    assert.equal((await lea.request('GET', '/dle')).body.boosterPrice, 60)
    const wallet = (await lea.request('GET', '/stardust')).body
    assert.deepEqual([wallet.boosterPrice, wallet.boosterRegular], [60, BOOSTER_PRICE])

    await prisma.user.update({ where: { id: lea.userId }, data: { stardust: 110 } })
    const bought = await lea.request('POST', '/stardust/booster')
    assert.equal(bought.status, 200, JSON.stringify(bought.body))
    assert.equal(bought.body.balance, 50)

    // Une nouvelle promotion remplace l'ancienne ; arrêtée, le prix habituel revient.
    const second = await chef.request('POST', '/admin/promotions', { target: 'booster', price: 45, hours: 2 })
    assert.equal((await lea.request('GET', '/dle')).body.boosterPrice, 45)
    const listed = (await chef.request('GET', '/admin/promotions')).body.promotions
    assert.equal(listed.filter((item: { active: boolean }) => item.active).length, 1)
    const ended = await chef.request('POST', `/admin/promotions/${second.body.promotion.id}/end`)
    assert.equal(ended.body.promotion.active, false)
    assert.equal((await lea.request('GET', '/dle')).body.boosterPrice, BOOSTER_PRICE)
    assert.equal(await prisma.adminAction.count({ where: { action: { in: ['promotion', 'promotion_end'] } } }), 3)
  })

  it('une boîte mystère en promotion : prix de la garde-robe, de l’achat et du cadeau', async () => {
    const chef = await prisma.user.findUniqueOrThrow({ where: { email: 'promo-chef@example.com' } })
    const { createPromotion } = await import('../src/modules/promotions/promotions.service.js')
    await createPromotion({ id: chef.id, email: chef.email }, { target: 'box', price: 300, hours: 1, message: null })
    const max = await account('Max')
    const view = (await max.request('GET', '/runner/wardrobe')).body
    assert.deepEqual([view.price, view.regular], [300, BOX_PRICE])
    await prisma.user.update({ where: { id: max.userId }, data: { stardust: 310 } })
    const opened = await max.request('POST', '/runner/boxes', {})
    assert.equal(opened.status, 201, JSON.stringify(opened.body))
    assert.ok(opened.body.wardrobe.balance >= 10)
  })
})

describe('Récompenses de record', () => {
  it('battre le record de tous les temps du Manga Runner : une récompense à choisir, une seule fois', async () => {
    const holder = await account('Holder')
    await prisma.runnerStats.upsert({ where: { userId: holder.userId }, create: { userId: holder.userId, best: 10 }, update: { best: 10 } })
    const zoe = await account('Zoe')
    const run = await zoe.request('POST', '/runner/runs')
    const end = await zoe.request('POST', `/runner/runs/${run.body.id}/end`, { distance: 25, stardust: 5, quiz: 0 })
    assert.equal(end.status, 200, JSON.stringify(end.body))
    assert.ok(end.body.score > 10)
    assert.ok(end.body.recordReward, 'record battu')
    assert.equal(end.body.recordReward.previous, 10)
    const notification = (await zoe.request('GET', '/notifications')).body.notifications.find((item: { type: string }) => item.type === 'record_reward')
    assert.equal(notification?.active, true)

    const pending = (await zoe.request('GET', '/rewards')).body.rewards
    assert.equal(pending.length, 1)
    assert.equal((await holder.request('POST', `/rewards/${pending[0].id}/claim`, { choice: 'box' })).status, 404, 'pas la sienne')
    const claimed = await zoe.request('POST', `/rewards/${pending[0].id}/claim`, { choice: 'box' })
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body))
    assert.deepEqual(claimed.body.pending, [])
    assert.equal((await zoe.request('GET', '/runner/wardrobe')).body.gifts, WELCOME_GIFT_BOXES + 1)
    assert.equal((await zoe.request('POST', `/rewards/${pending[0].id}/claim`, { choice: 'booster' })).body.error.code, 'reward_claimed')

    // Une course moins bonne ne rapporte rien ; le premier record d'un mode non plus.
    const again = await zoe.request('POST', '/runner/runs')
    const weak = await zoe.request('POST', `/runner/runs/${again.body.id}/end`, { distance: 2, stardust: 0, quiz: 0 })
    assert.equal(weak.body.recordReward, null)
  })

  it('le booster choisi rejoint la réserve', async () => {
    const tom = await account('Tom')
    const { prisma: db } = await import('../src/core/db.js')
    const reward = await db.recordReward.create({ data: { userId: tom.userId, game: 'higher_lower', score: 12, previous: 9 } })
    const before = (await tom.request('GET', '/boosters/status')).body.available
    const claimed = await tom.request('POST', `/rewards/${reward.id}/claim`, { choice: 'booster' })
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body))
    assert.equal((await tom.request('GET', '/boosters/status')).body.available, before + 1)
  })
})
