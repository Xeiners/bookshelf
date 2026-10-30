/**
 * Page Jump : barèmes, plausibilité (hauteur bornée par le temps, éclats et onis par la hauteur),
 * Poussières plafonnées, et l'API (départ, bilan unique, records, classement).
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('jump')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/core/db.js')
const logic = await import('../src/modules/jump/jump.logic.js')

type Account = TestClient & { userId: string }

async function account(name: string, email: string): Promise<Account> {
  const device = client()
  const signed = await device.signUp({ email, password: 'motdepasse-test', displayName: name })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(device, { userId: signed.body.user.id as string })
}

describe('Page Jump — règles', () => {
  it('score : hauteur, éclats, onis', () => {
    assert.equal(logic.scoreOf(1234, 3, 2), 123 + 3 * logic.STAR_POINTS + 2 * logic.STOMP_POINTS)
  })

  it('hauteur bornée par le temps, éclats et onis par la hauteur, score recalculé', () => {
    const claim = logic.plausible({ score: 9_999_999, height: 1_000_000, stars: 50_000, stomps: 50_000 }, 10_000)
    assert.equal(claim.height, logic.MAX_CLIMB_PER_SECOND * 10 + logic.CLIMB_ALLOWANCE)
    assert.equal(claim.stars, Math.floor(claim.height / logic.MIN_STAR_SPACING) + 2)
    assert.equal(claim.stomps, Math.floor(claim.height / logic.MIN_ENEMY_SPACING) + 1)
    assert.equal(claim.score, logic.scoreOf(claim.height, claim.stars, claim.stomps))
    // Une vraie partie passe telle quelle.
    assert.deepEqual(logic.plausible({ score: 400, height: 3000, stars: 7, stomps: 1 }, 60_000), { score: 400, height: 3000, stars: 7, stomps: 1 })
  })

  it('Poussières : une pour 20 points, plafonnées par jour', () => {
    assert.equal(logic.cappedReward(199, 0), 9)
    assert.equal(logic.cappedReward(1_000_000, 0), logic.JUMP_DAILY_CAP)
    assert.equal(logic.cappedReward(400, logic.JUMP_DAILY_CAP - 3), 3)
  })
})

describe('Page Jump — API', () => {
  it('une partie : bilan borné, record, Poussières créditées, classement', async () => {
    const ana = await account('Ana', 'ana-jump@example.com')
    const start = await ana.request('POST', '/jump/runs')
    assert.equal(start.status, 201)
    assert.match(start.body.id, /^[0-9a-f]{18}$/)
    const end = await ana.request('POST', `/jump/runs/${start.body.id}/end`, { score: 1_000_000, height: 900_000, stars: 999, stomps: 999 })
    assert.equal(end.status, 200, JSON.stringify(end.body))
    assert.ok(end.body.height <= logic.MAX_CLIMB_PER_SECOND * 5 + logic.CLIMB_ALLOWANCE, 'hauteur rognée')
    assert.ok(end.body.score <= logic.scoreOf(end.body.height, end.body.stars, end.body.stomps))
    assert.equal(end.body.record, true)
    assert.equal(end.body.recordReward ?? null, null, 'aucun record de tous les temps à battre au premier score')
    assert.equal(end.body.reward, Math.floor(end.body.score / logic.POINTS_PER_STARDUST))
    const wallet = await prisma.user.findUniqueOrThrow({ where: { id: ana.userId } })
    assert.equal(wallet.stardust, end.body.reward)

    // La même partie ne se solde pas deux fois.
    assert.equal((await ana.request('POST', `/jump/runs/${start.body.id}/end`, { score: 10, height: 100, stars: 0, stomps: 0 })).status, 404)

    const overview = (await ana.request('GET', '/jump')).body
    assert.equal(overview.me.best, end.body.score)
    assert.equal(overview.me.bestHeight, end.body.height)
    assert.equal(overview.me.games, 1)
    assert.deepEqual(overview.leaderboard.map((row: { name: string; me: boolean }) => [row.name, row.me]), [['Ana', true]])

    const history = await prisma.stardustEntry.findFirst({ where: { userId: ana.userId }, orderBy: { createdAt: 'desc' } })
    assert.equal(history?.reason, 'page_jump')
  })

  it('battre le record de tous les temps donne une récompense à choisir', async () => {
    const leo = await account('Leo', 'leo-jump@example.com')
    const best = (await prisma.jumpStats.aggregate({ _max: { best: true } }))._max.best ?? 0
    const start = await leo.request('POST', '/jump/runs')
    // Le départ est antidaté : la partie a « duré » assez longtemps pour cette hauteur.
    const { startJumpRun } = await import('../src/modules/jump/jump.service.js')
    const run = startJumpRun(leo.userId, Date.now() - 600_000)
    assert.ok(start.body.id)
    const height = (best + 100) * logic.HEIGHT_PER_POINT
    const end = await leo.request('POST', `/jump/runs/${run.id}/end`, { score: logic.scoreOf(height, 0, 0), height, stars: 0, stomps: 0 })
    assert.equal(end.status, 200, JSON.stringify(end.body))
    assert.ok(end.body.score > best)
    assert.equal(end.body.recordReward?.game, 'jump')
  })

  it('invité : il joue avec son pseudo, ses Poussières sont des reçus', async () => {
    const guest = client()
    const named = await guest.request('POST', '/dle/guest', { name: '' })
    assert.ok(named.status === 200 || named.status === 201, JSON.stringify(named.body))
    const start = await guest.request('POST', '/jump/runs')
    assert.equal(start.status, 201)
    const end = await guest.request('POST', `/jump/runs/${start.body.id}/end`, { score: 100, height: 1000, stars: 0, stomps: 0 })
    assert.equal(end.status, 200, JSON.stringify(end.body))
    assert.equal(end.body.receipts.length > 0, end.body.reward > 0)
  })
})

describe('Page Jump — personnages', () => {
  it('la Lune pour tous ; acheter débite, choisit, une seule fois ; choisir demande de posséder', async () => {
    const mia = await account('Mia', 'mia-jump@example.com')
    const start = (await mia.request('GET', '/jump')).body.characters
    assert.deepEqual(start, { owned: ['moon'], selected: 'moon' })

    assert.equal((await mia.request('POST', '/jump/characters/goku/select')).status, 404, 'pas encore à elle')
    assert.equal((await mia.request('POST', '/jump/characters/inconnu/buy')).status, 404)

    await prisma.user.update({ where: { id: mia.userId }, data: { stardust: 500 } })
    const poor = await mia.request('POST', '/jump/characters/goku/buy')
    assert.equal(poor.status, 409)
    assert.equal(poor.body.error.code, 'not_enough_stardust')
    assert.equal(await prisma.jumpCharacter.count({ where: { userId: mia.userId } }), 0, 'rien n’est acquis sans le débit')

    const bought = await mia.request('POST', '/jump/characters/pakkun/buy')
    assert.equal(bought.status, 200, JSON.stringify(bought.body))
    assert.equal(bought.body.balance, 100)
    assert.deepEqual(bought.body.owned, ['moon', 'pakkun'])
    assert.equal(bought.body.selected, 'pakkun')
    assert.equal((await mia.request('POST', '/jump/characters/pakkun/buy')).body.error.code, 'character_owned')

    assert.equal((await mia.request('POST', '/jump/characters/moon/select')).body.selected, 'moon')
    assert.equal((await mia.request('GET', '/jump')).body.characters.selected, 'moon')
  })

  it('un invité joue avec la Lune et ne peut rien acheter', async () => {
    const guest = client()
    await guest.request('POST', '/dle/guest', { name: '' })
    assert.equal((await guest.request('GET', '/jump')).body.characters.selected, 'moon')
    assert.equal((await guest.request('POST', '/jump/characters/pakkun/buy')).status, 401)
  })
})
