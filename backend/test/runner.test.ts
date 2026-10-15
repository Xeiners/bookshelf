/**
 * Manga Runner 3D : bornes de plausibilité (distance selon le temps, ✦ selon la
 * distance), score et plafond du jour, puis l'API (course, records, Poussières,
 * classement, invité avec reçus).
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('runner')
// Le Runner est réservé aux administrateurs pour l'instant.
process.env.ADMIN_EMAILS = 'ana-runner@example.com, chef-runner@example.com, dressing-runner@example.com, giver-runner@example.com, taker-runner@example.com'
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')
const logic = await import('../src/modules/runner/runner.logic.js')
const wardrobe = await import('../src/modules/runner/runner.wardrobe.js')

type Account = TestClient & { userId: string }

async function account(name: string, email = `${name.toLowerCase()}-${Date.now()}@example.com`): Promise<Account> {
  const device = client()
  const signed = await device.signUp({ email, password: 'motdepasse-test', displayName: name })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(device, { userId: signed.body.user.id as string })
}

describe('Manga Runner — règles', () => {
  it('distance bornée par la vitesse, ✦ et quiz bornés par la distance', () => {
    assert.ok(logic.maxDistance(0) <= 30)
    assert.ok(logic.maxDistance(10) < 200, 'on ne parcourt pas 200 m en 10 s')
    assert.ok(logic.maxDistance(60) > 13 * 60, 'une vraie minute de course passe')
    const claim = logic.plausible({ distance: 99_999, stardust: 99_999, quiz: 99 }, 20_000)
    assert.equal(claim.distance, logic.maxDistance(20))
    assert.equal(claim.stardust, logic.maxStardust(claim.distance))
    assert.equal(claim.quiz, logic.maxQuiz(claim.distance))
    assert.deepEqual(logic.plausible({ distance: 120.7, stardust: 12, quiz: 0 }, 20_000), { distance: 120, stardust: 12, quiz: 0 })
  })

  it('score : distance × multiplicateur des ✦, plus les quiz ; plafond du jour', () => {
    assert.equal(logic.multiplierFor(19), 1)
    assert.equal(logic.multiplierFor(40), 1.2)
    assert.equal(logic.scoreFor(1000, 40, 1), 1200 + logic.QUIZ_POINTS)
    assert.equal(logic.cappedReward(30, 1, 0), 30 + logic.QUIZ_REWARD)
    assert.equal(logic.cappedReward(500, 0, 0), logic.RUNNER_DAILY_CAP)
    assert.equal(logic.cappedReward(30, 0, logic.RUNNER_DAILY_CAP - 5), 5)
  })
})

describe('Manga Runner — API', () => {
  it('une course : bilan borné, record, Poussières créditées et plafonnées, classement', async () => {
    const ana = await account('Ana', 'ana-runner@example.com')
    const start = await ana.request('POST', '/runner/runs')
    assert.equal(start.status, 201)
    assert.match(start.body.id, /^[0-9a-f]{18}$/)
    assert.equal(typeof start.body.seed, 'number')
    // Course déclarée trop belle pour le temps écoulé : rognée.
    const end = await ana.request('POST', `/runner/runs/${start.body.id}/end`, { distance: 5000, stardust: 40, quiz: 0 })
    assert.equal(end.status, 200, JSON.stringify(end.body))
    assert.ok(end.body.distance <= logic.maxDistance(5))
    assert.ok(end.body.stardust <= logic.maxStardust(end.body.distance))
    assert.equal(end.body.reward, end.body.stardust)
    assert.equal(end.body.record, end.body.score > 0)
    assert.equal(end.body.balance, end.body.reward)
    // Une course ne se termine qu'une fois.
    assert.equal((await ana.request('POST', `/runner/runs/${start.body.id}/end`, { distance: 10, stardust: 0, quiz: 0 })).status, 404)

    // Plafond du jour presque atteint : la course suivante n'en reçoit que le reste.
    const again = await ana.request('POST', '/runner/runs')
    const stats = await prisma.runnerStats.update({ where: { userId: ana.userId }, data: { dayEarned: logic.RUNNER_DAILY_CAP - 3 } })
    assert.equal(stats.games, 1)
    const capped = await ana.request('POST', `/runner/runs/${again.body.id}/end`, { distance: 20, stardust: 8, quiz: 0 })
    assert.equal(capped.body.reward, 3)
    assert.equal(capped.body.capped, true)

    const overview = await ana.request('GET', '/runner')
    assert.equal(overview.status, 200)
    assert.equal(overview.body.me.games, 2)
    assert.equal(overview.body.me.earnedToday, logic.RUNNER_DAILY_CAP)
    assert.equal(overview.body.dailyCap, logic.RUNNER_DAILY_CAP)
    assert.ok(overview.body.leaderboard.some((row: { me: boolean }) => row.me))
    assert.equal(overview.body.myRank, 1)
  })

  it('revivre : 50 ✦, puis le double ; refusé sans solde suffisant ou après trois fois', async () => {
    const chef = await account('Chef', 'chef-runner@example.com')
    await prisma.user.update({ where: { id: chef.userId }, data: { stardust: 120 } })
    const run = await chef.request('POST', '/runner/runs')
    const first = await chef.request('POST', `/runner/runs/${run.body.id}/revive`)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.deepEqual(first.body, { cost: 50, balance: 70, revives: 1, nextCost: 100 })
    const broke = await chef.request('POST', `/runner/runs/${run.body.id}/revive`)
    assert.equal(broke.status, 409)
    assert.equal(broke.body.error.code, 'not_enough_stardust')
    await prisma.user.update({ where: { id: chef.userId }, data: { stardust: 1000 } })
    assert.equal((await chef.request('POST', `/runner/runs/${run.body.id}/revive`)).body.cost, 100)
    const third = await chef.request('POST', `/runner/runs/${run.body.id}/revive`)
    assert.deepEqual([third.body.cost, third.body.nextCost], [200, null])
    const limit = await chef.request('POST', `/runner/runs/${run.body.id}/revive`)
    assert.equal(limit.body.error.code, 'revive_limit')
    assert.equal((await prisma.user.findUnique({ where: { id: chef.userId } }))!.stardust, 700)
    assert.equal(await prisma.stardustEntry.count({ where: { userId: chef.userId, reason: 'runner_revive' } }), 3)
    // La course continue : elle se termine normalement.
    assert.equal((await chef.request('POST', `/runner/runs/${run.body.id}/end`, { distance: 10, stardust: 0, quiz: 0 })).status, 200)
    assert.equal((await chef.request('POST', `/runner/runs/${run.body.id}/revive`)).status, 404)
  })

  it('réservé aux administrateurs : un compte ordinaire et un invité ne le voient pas', async () => {
    const bob = await account('Bob')
    assert.equal((await bob.request('GET', '/runner')).status, 404)
    assert.equal((await bob.request('POST', '/runner/runs')).status, 404)
    const guest = client()
    assert.equal((await guest.request('POST', '/dle/guest', { name: 'Coureur' })).status, 200)
    assert.equal((await guest.request('POST', '/runner/runs')).status, 401)
    assert.equal((await client().request('POST', '/runner/runs')).status, 401)
  })
})

describe('Manga Runner — garde-robe', () => {
  it('50 pièces : dix par emplacement, deux légendaires, deux épiques, deux rares, quatre communes', () => {
    assert.equal(wardrobe.WARDROBE.length, 50)
    assert.equal(new Set(wardrobe.WARDROBE.map((item) => item.id)).size, 50)
    for (const slot of wardrobe.WARDROBE_SLOTS) {
      const items = wardrobe.WARDROBE.filter((item) => item.slot === slot)
      assert.deepEqual(items.map((item) => item.rarity).sort(), ['common', 'common', 'common', 'common', 'epic', 'epic', 'legendary', 'legendary', 'rare', 'rare'])
    }
    assert.equal(Object.values(wardrobe.RARITY_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100)
  })

  it('tirage : rareté selon le ticket, pièce nouvelle d’abord, doublon remboursé, garantie légendaire', () => {
    const sequence = (...values: number[]) => () => values.shift() ?? 0
    assert.equal(wardrobe.rollBox(sequence(0.01, 0), new Set(), 0).item.rarity, 'legendary')
    assert.equal(wardrobe.rollBox(sequence(0.99, 0), new Set(), 0).item.rarity, 'common')
    // Une commune déjà possédée : l'autre commune de la même rareté est choisie.
    const commons = wardrobe.WARDROBE.filter((item) => item.rarity === 'common')
    const owned = new Set(commons.slice(1).map((item) => item.id))
    const fresh = wardrobe.rollBox(sequence(0.99, 0.99), owned, 0)
    assert.equal(fresh.item.id, commons[0]!.id)
    assert.equal(fresh.duplicate, false)
    // Toutes les communes possédées : doublon, remboursé.
    const twice = wardrobe.rollBox(sequence(0.99, 0), new Set(commons.map((item) => item.id)), 0)
    assert.deepEqual([twice.duplicate, twice.refund], [true, wardrobe.DUPLICATE_REFUND.common])
    // Garantie : la boîte n° BOX_PITY sans légendaire en contient une.
    const pity = wardrobe.rollBox(sequence(0.99, 0), new Set(), wardrobe.BOX_PITY - 1)
    assert.deepEqual([pity.item.rarity, pity.guaranteed], ['legendary', true])
    assert.deepEqual(wardrobe.readOutfit('{"hat":"hat-straw","top":"hat-ace","shoes":"nope"}', new Set(['hat-straw', 'hat-ace'])), { hat: 'hat-straw' })
    assert.deepEqual(wardrobe.readOutfit('pas du json', new Set()), {})
  })

  it('boîtes : une gratuite par 24 h, les autres payées ; tenue équipée seulement avec ses pièces', async () => {
    const dressing = await account('Dressing', 'dressing-runner@example.com')
    const empty = await dressing.request('GET', '/runner/wardrobe')
    assert.equal(empty.status, 200, JSON.stringify(empty.body))
    assert.equal(empty.body.items.length, 50)
    assert.deepEqual([empty.body.owned, empty.body.outfit, empty.body.freeAt, empty.body.price], [{}, {}, null, wardrobe.BOX_PRICE])

    const free = await dressing.request('POST', '/runner/boxes', { free: true })
    assert.equal(free.status, 201, JSON.stringify(free.body))
    assert.equal(free.body.free, true)
    assert.equal(free.body.duplicate, false)
    assert.equal(free.body.wardrobe.owned[free.body.item.id], 1)
    assert.ok(Date.parse(free.body.wardrobe.freeAt) > Date.now() + 23 * 3600 * 1000)
    const again = await dressing.request('POST', '/runner/boxes', { free: true })
    assert.equal(again.status, 409)
    assert.equal(again.body.error.code, 'free_box_not_ready')

    // Payée : refusée sans solde, puis débitée.
    const broke = await dressing.request('POST', '/runner/boxes', { free: false })
    assert.equal(broke.body.error.code, 'not_enough_stardust')
    await prisma.user.update({ where: { id: dressing.userId }, data: { stardust: wardrobe.BOX_PRICE * 30 } })
    let balance = wardrobe.BOX_PRICE * 30
    let legendary = free.body.item.rarity === 'legendary'
    for (let box = 0; box < 24; box += 1) {
      const paid = await dressing.request('POST', '/runner/boxes', {})
      assert.equal(paid.status, 201, JSON.stringify(paid.body))
      balance += paid.body.refund - wardrobe.BOX_PRICE
      assert.equal(paid.body.wardrobe.balance, balance)
      legendary ||= paid.body.item.rarity === 'legendary'
    }
    assert.ok(legendary, 'la garantie a donné au moins une légendaire')
    const view = (await dressing.request('GET', '/runner/wardrobe')).body
    assert.equal(view.boxes, 25)
    assert.equal(Object.values(view.owned as Record<string, number>).reduce((sum, count) => sum + count, 0), 25)
    assert.equal(await prisma.stardustEntry.count({ where: { userId: dressing.userId, reason: 'runner_box' } }), 24)

    // Tenue : une pièce possédée, à son emplacement.
    const mine = Object.keys(view.owned)[0]!
    const slot = wardrobe.wardrobeItem(mine)!.slot
    const dressed = await dressing.request('PATCH', '/runner/outfit', { [slot]: mine })
    assert.equal(dressed.status, 200, JSON.stringify(dressed.body))
    assert.deepEqual(dressed.body.outfit, { [slot]: mine })
    const missing = wardrobe.WARDROBE.find((item) => !view.owned[item.id])
    if (missing) assert.equal((await dressing.request('PATCH', '/runner/outfit', { [missing.slot]: missing.id })).status, 400)
    const wrongSlot = wardrobe.WARDROBE_SLOTS.find((other) => other !== slot)!
    assert.equal((await dressing.request('PATCH', '/runner/outfit', { [wrongSlot]: mine })).status, 400)
    assert.deepEqual((await dressing.request('PATCH', '/runner/outfit', { [slot]: null })).body.outfit, {})
  })

  it('offrir une boîte : payée par l’expéditeur, ouverte par le destinataire, notifiée', async () => {
    const giver = await account('Giver', 'giver-runner@example.com')
    const taker = await account('Taker', 'taker-runner@example.com')
    assert.equal((await giver.request('POST', '/runner/gifts', { to: taker.userId })).body.error.code, 'not_enough_stardust')
    await prisma.user.update({ where: { id: giver.userId }, data: { stardust: wardrobe.BOX_PRICE + 10 } })
    assert.equal((await giver.request('POST', '/runner/gifts', { to: giver.userId })).status, 400)
    const sent = await giver.request('POST', '/runner/gifts', { to: taker.userId, message: '  Bonne course !  ' })
    assert.equal(sent.status, 201, JSON.stringify(sent.body))
    assert.equal(sent.body.balance, 10)
    const notification = await prisma.notification.findFirst({ where: { userId: taker.userId, type: 'box_gift' } })
    assert.ok(notification)
    assert.equal(JSON.parse(notification.data).message, 'Bonne course !')
    assert.equal((await taker.request('GET', '/runner/wardrobe')).body.gifts, 1)
    const opened = await taker.request('POST', '/runner/boxes', { gift: true })
    assert.equal(opened.status, 201, JSON.stringify(opened.body))
    assert.equal(opened.body.source, 'gift')
    assert.equal(opened.body.wardrobe.gifts, 0)
    assert.equal(opened.body.wardrobe.balance, 0)
    assert.equal((await taker.request('POST', '/runner/boxes', { gift: true })).body.error.code, 'no_gift_box')
  })
})
