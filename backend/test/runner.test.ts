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
process.env.ADMIN_EMAILS = 'ana-runner@example.com, chef-runner@example.com'
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')
const logic = await import('../src/modules/runner/runner.logic.js')

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
