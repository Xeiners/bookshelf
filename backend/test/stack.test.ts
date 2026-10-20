/**
 * Page Stack : barèmes et bornes de plausibilité (pages selon le temps, score selon les pages
 * et les parfaites), plafond du jour, puis l'API (partie, records, Poussières, classement,
 * invité avec reçus).
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('stack')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/core/db.js')
const logic = await import('../src/modules/stack/stack.logic.js')

type Account = TestClient & { userId: string }

async function account(name: string, email = `${name.toLowerCase()}-${Date.now()}@example.com`): Promise<Account> {
  const device = client()
  const signed = await device.signUp({ email, password: 'motdepasse-test', displayName: name })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(device, { userId: signed.body.user.id as string })
}

describe('Page Stack — règles', () => {
  it('points : une page simple, une parfaite, un combo qui plafonne', () => {
    assert.equal(logic.placePoints(false, 0), logic.PAGE_POINTS)
    assert.equal(logic.placePoints(true, 1), logic.PAGE_POINTS + logic.PERFECT_BONUS)
    assert.equal(logic.placePoints(true, 3), logic.PAGE_POINTS + logic.PERFECT_BONUS + 2 * logic.COMBO_STEP)
    assert.equal(logic.placePoints(true, 99), logic.placePoints(true, logic.COMBO_CAP))
  })

  it('score maximal : jamais atteint par aucune suite réelle de poses', () => {
    for (const perfects of [0, 7, 25, 60]) {
      let total = 0
      for (let combo = 1; combo <= perfects; combo += 1) total += logic.placePoints(true, combo)
      assert.ok(total <= logic.maxScore(perfects, perfects), `${perfects} parfaites`)
    }
    assert.equal(logic.maxScore(10, 0), 10 * logic.PAGE_POINTS)
    assert.equal(logic.maxScore(10, 99), logic.maxScore(10, 10), 'pas plus de parfaites que de pages')
  })

  it('pages bornées par le temps, parfaites par les pages, score par les deux', () => {
    assert.ok(logic.maxPages(0) >= 1)
    assert.ok(logic.maxPages(10) < 40, '40 pages en 10 s : impossible')
    assert.ok(logic.maxPages(60) >= 60, 'une vraie minute de jeu passe')
    const claim = logic.plausible({ score: 999_999, pages: 5000, perfects: 9000 }, 10_000)
    assert.equal(claim.pages, logic.maxPages(10))
    assert.equal(claim.perfects, claim.pages)
    assert.equal(claim.score, logic.maxScore(claim.pages, claim.perfects))
    assert.deepEqual(logic.plausible({ score: 120, pages: 9, perfects: 2 }, 60_000), { score: 120, pages: 9, perfects: 2 })
  })

  it('Poussières : une pour 20 points, plafonnées par jour', () => {
    assert.equal(logic.cappedReward(199, 0), 9)
    assert.equal(logic.cappedReward(400, 0), 20)
    assert.equal(logic.cappedReward(1_000_000, 0), logic.STACK_DAILY_CAP)
    assert.equal(logic.cappedReward(400, logic.STACK_DAILY_CAP - 3), 3)
    assert.equal(logic.cappedReward(400, logic.STACK_DAILY_CAP), 0)
  })
})

describe('Page Stack — couvertures de tomes', () => {
  it('une couverture par manga, les plus suivis d’abord, sans personnages de la série 3', async () => {
    const { pickCovers } = await import('../src/modules/stack/stack.covers.js')
    const work = (id: string, name: string, popularity: number, series = 1, imageUrl = `/api/covers/${id}/c.jpg?size=512`) => ({ id, name, popularity, series, imageUrl })
    const picked = pickCovers([
      work('a', 'One Piece', 100),
      work('b', 'Naruto', 300),
      work('c', 'one piece ', 50, 2),
      work('d', 'Luffy', 900, 3),
      work('e', 'Sans image', 80, 1, ''),
      work('f', 'Berserk', 200),
    ])
    assert.deepEqual(picked.map((cover) => cover.title), ['Naruto', 'Berserk', 'One Piece'])
    assert.deepEqual(picked[0], { id: 'b', title: 'Naruto', url: '/api/covers/b/c.jpg?size=512' })
    assert.deepEqual(pickCovers([]), [])
    const many = Array.from({ length: 100 }, (_, index) => work(`id${index}`, `Manga ${index}`, index))
    assert.equal(pickCovers(many).length, 60)
  })

  it('l’API répond même sans collection prête : liste vide, jamais une erreur', async () => {
    const response = await client().request('GET', '/stack/covers')
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.covers, [])
  })
})

describe('Page Stack — API', () => {
  it('une partie : bilan borné, record, Poussières créditées, classement', async () => {
    const ana = await account('Ana', 'ana-stack@example.com')
    const start = await ana.request('POST', '/stack/runs')
    assert.equal(start.status, 201)
    assert.match(start.body.id, /^[0-9a-f]{18}$/)
    // Partie déclarée trop belle pour le temps écoulé : rognée.
    const end = await ana.request('POST', `/stack/runs/${start.body.id}/end`, { score: 100_000, pages: 500, perfects: 500 })
    assert.equal(end.status, 200, JSON.stringify(end.body))
    assert.ok(end.body.pages <= logic.maxPages(5))
    assert.ok(end.body.score <= logic.maxScore(end.body.pages, end.body.perfects))
    assert.equal(end.body.record, true, 'premier score : record personnel')
    assert.equal(end.body.recordReward ?? null, null, 'aucun record de tous les temps à battre au premier score')
    assert.equal(end.body.reward, Math.floor(end.body.score / logic.POINTS_PER_STARDUST))
    const wallet = await prisma.user.findUniqueOrThrow({ where: { id: ana.userId } })
    assert.equal(wallet.stardust, end.body.reward)
    assert.equal(end.body.balance, wallet.stardust)

    // La même partie ne se solde pas deux fois.
    assert.equal((await ana.request('POST', `/stack/runs/${start.body.id}/end`, { score: 10, pages: 1, perfects: 0 })).status, 404)
    // Identifiant d'une autre partie : introuvable.
    assert.equal((await ana.request('POST', `/stack/runs/${'0'.repeat(18)}/end`, { score: 10, pages: 1, perfects: 0 })).status, 404)

    const overview = (await ana.request('GET', '/stack')).body
    assert.equal(overview.me.best, end.body.score)
    assert.equal(overview.me.games, 1)
    assert.equal(overview.dailyCap, logic.STACK_DAILY_CAP)
    assert.deepEqual(overview.leaderboard.map((row: { name: string; me: boolean }) => [row.name, row.me]), [['Ana', true]])
    assert.equal(overview.myRank, 1)
  })

  it('battre le record de tous les temps offre une récompense à choisir (un score personnel plus bas n’en offre pas)', async () => {
    const { startStackRun, finishStackRun } = await import('../src/modules/stack/stack.service.js')
    const play = async (userId: string, claim: { score: number; pages: number; perfects: number }) => {
      const t0 = Date.now() - 120_000
      const { id } = startStackRun(userId, t0)
      return finishStackRun(userId, id, claim, new Date(t0 + 120_000))
    }
    const bea = await account('Bea')
    const first = await play(bea.userId, { score: 50, pages: 5, perfects: 0 })
    assert.equal(first.record, true)
    assert.equal(first.recordReward ?? null, null, 'un record personnel n’est pas un record de tous les temps')
    const same = await play(bea.userId, { score: 50, pages: 5, perfects: 0 })
    assert.equal(same.record, false, 'égaler son score n’est pas le battre')

    const dan = await account('Dan')
    const allTime = (await prisma.stackStats.aggregate({ _max: { best: true } }))._max.best ?? 0
    assert.ok(allTime >= 50)
    const beaten = await play(dan.userId, { score: allTime + 40, pages: 200, perfects: 200 })
    assert.equal(beaten.record, true)
    assert.equal(beaten.recordReward?.game, 'stack')
    assert.equal(beaten.recordReward?.previous, allTime)
    assert.equal(beaten.recordReward?.score, allTime + 40)
    assert.equal((await dan.request('GET', '/rewards')).body.rewards.length, 1)

    const overview = (await dan.request('GET', '/stack')).body
    assert.deepEqual(overview.leaderboard[0], { ...overview.leaderboard[0], rank: 1, name: 'Dan', score: allTime + 40, me: true })
    assert.equal(overview.myRank, 1)
  })

  it('le plafond du jour borne les Poussières, pas le score', async () => {
    const { startStackRun, finishStackRun } = await import('../src/modules/stack/stack.service.js')
    const cleo = await account('Cleo')
    await prisma.stackStats.create({ data: { userId: cleo.userId, day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()), dayEarned: logic.STACK_DAILY_CAP - 2 } })
    const t0 = Date.now() - 60_000
    const { id } = startStackRun(cleo.userId, t0)
    const end = await finishStackRun(cleo.userId, id, { score: 100, pages: 8, perfects: 0 }, new Date(t0 + 60_000))
    assert.equal(end.score, 80, 'huit pages simples : 80 points')
    assert.equal(end.reward, 2)
    assert.equal(end.capped, true)
    assert.equal(end.earnedToday, logic.STACK_DAILY_CAP)
  })

  it('un invité joue, ses Poussières sont des reçus signés', async () => {
    const guest = client()
    assert.equal((await guest.request('POST', '/dle/guest', { name: 'Pageur' })).status, 200)
    const start = await guest.request('POST', '/stack/runs')
    assert.equal(start.status, 201)
    const end = await guest.request('POST', `/stack/runs/${start.body.id}/end`, { score: 200, pages: 15, perfects: 0 })
    assert.equal(end.status, 200, JSON.stringify(end.body))
    assert.equal(end.body.balance, 0)
    assert.ok(Array.isArray(end.body.receipts))
    const { readReceipt } = await import('../src/modules/dle/dle.guests.js')
    const total = end.body.receipts.reduce((sum: number, receipt: string) => sum + (readReceipt(receipt)?.amount ?? 0), 0)
    assert.equal(total, end.body.reward)
    assert.equal((await guest.request('GET', '/stack')).body.me.best, end.body.score)
  })

  it('sans identité : refusé', async () => {
    assert.equal((await client().request('GET', '/stack')).status, 401)
  })
})
