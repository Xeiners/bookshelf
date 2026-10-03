/**
 * Higher or Lower : générateur de duels (écart de rang selon la série, jamais
 * d'égalité, cartes récentes écartées), paliers et plafond des Poussières, données,
 * puis l'API (valeur cachée jusqu'à la réponse, fin de partie, records, classements,
 * abandon, plafond du jour, profil).
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('higherlower')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')
const logic = await import('../src/modules/higherlower/hl.logic.js')
const { HL_ENTRIES, HL_METRICS, HL_WORKS } = await import('../src/modules/higherlower/hl.data.js')
const { forgetRuns } = await import('../src/modules/higherlower/hl.service.js')

after(() => forgetRuns())

/** Hasard reproductible (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const POOL = Array.from({ length: 50 }, (_, index) => ({ id: `c${index}`, value: (index + 1) * 10 }))
const rank = logic.rankOf(POOL)
const gap = (a: { value: number }, b: { value: number }) => Math.abs(rank(a.value) - rank(b.value))

describe('Higher or Lower — générateur de duels', () => {
  it('début de série : des valeurs très éloignées', () => {
    const random = seeded(1)
    for (let draw = 0; draw < 200; draw += 1) {
      const current = POOL[Math.floor(random() * POOL.length)]!
      const challenger = logic.pickChallenger(POOL, current, 0, new Set(), random)
      assert.ok(challenger)
      assert.ok(gap(current, challenger) >= 0.35, `écart ${gap(current, challenger)} trop serré au début`)
    }
  })

  it('longue série : des valeurs de plus en plus proches', () => {
    const random = seeded(2)
    const average = (streak: number) => {
      let total = 0
      for (let draw = 0; draw < 300; draw += 1) {
        const current = POOL[Math.floor(random() * POOL.length)]!
        total += gap(current, logic.pickChallenger(POOL, current, streak, new Set(), random)!)
      }
      return total / 300
    }
    const gaps = [0, 8, 13, 20, 30].map(average)
    for (let index = 1; index < gaps.length; index += 1) assert.ok(gaps[index]! < gaps[index - 1]!, `écarts moyens ${gaps.join(' > ')}`)
    const random2 = seeded(3)
    for (let draw = 0; draw < 200; draw += 1) {
      const current = POOL[Math.floor(random2() * POOL.length)]!
      assert.ok(gap(current, logic.pickChallenger(POOL, current, 30, new Set(), random2)!) <= 0.1)
    }
  })

  it('jamais la même carte ni la même valeur (aucune égalité à trancher)', () => {
    const pool = [
      { id: 'a', value: 100 },
      { id: 'b', value: 100 },
      { id: 'c', value: 100 },
      { id: 'd', value: 200 },
    ]
    const random = seeded(4)
    for (let draw = 0; draw < 50; draw += 1) {
      const challenger = logic.pickChallenger(pool, pool[0]!, draw, new Set(), random)
      assert.equal(challenger?.id, 'd')
    }
    assert.equal(logic.pickChallenger([{ id: 'a', value: 1 }, { id: 'b', value: 1 }], { id: 'a', value: 1 }, 0, new Set(), random), null)
    assert.equal(logic.pickOpening([{ id: 'a', value: 1 }, { id: 'b', value: 1 }], random), null)
  })

  it('écarte les cartes vues récemment, sauf s’il ne reste qu’elles', () => {
    const random = seeded(5)
    const recent = new Set(POOL.slice(0, 45).map((entry) => entry.id))
    for (let draw = 0; draw < 100; draw += 1) {
      const challenger = logic.pickChallenger(POOL, POOL[0]!, 0, recent, random)
      assert.ok(challenger && !recent.has(challenger.id))
    }
    const everything = new Set(POOL.map((entry) => entry.id))
    assert.ok(logic.pickChallenger(POOL, POOL[0]!, 0, everything, random))
  })

  it('préfère les cartes pas vues aux parties précédentes', () => {
    const random = seeded(7)
    const stale = new Set(POOL.slice(0, 40).map((entry) => entry.id))
    for (let draw = 0; draw < 100; draw += 1) {
      const opening = logic.pickOpening(POOL, random, stale)
      assert.ok(opening && !stale.has(opening.id))
      const challenger = logic.pickChallenger(POOL, POOL[0]!, 0, new Set(), random, stale)
      assert.ok(challenger && !stale.has(challenger.id))
    }
    // Simple préférence : tout vu, le tirage continue.
    const everything = new Set(POOL.map((entry) => entry.id))
    assert.ok(logic.pickOpening(POOL, random, everything))
    assert.ok(logic.pickChallenger(POOL, POOL[0]!, 0, new Set(), random, everything))
  })

  it('historique d’une partie à l’autre : la plus récente en dernier, sans doublon, tronqué', () => {
    assert.deepEqual(logic.remember(['a', 'b', 'c'], ['b', 'd'], 10), ['a', 'c', 'b', 'd'])
    assert.deepEqual(logic.remember(['a', 'b', 'c'], ['d', 'e'], 3), ['c', 'd', 'e'])
    assert.equal(logic.historyWindow(80), 60)
    assert.equal(logic.recentWindow(80), 40)
  })

  it('assouplit l’écart voulu quand aucune carte ne convient', () => {
    const tiny = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ]
    // Série longue : écart visé ≤ 0,1, mais la seule autre carte est à l'opposé.
    assert.equal(logic.pickChallenger(tiny, tiny[0]!, 40, new Set(), seeded(6))?.id, 'b')
  })

  it('juste ou faux', () => {
    assert.equal(logic.isCorrect('higher', 10, 20), true)
    assert.equal(logic.isCorrect('higher', 20, 10), false)
    assert.equal(logic.isCorrect('lower', 20, 10), true)
    assert.equal(logic.isCorrect('lower', 10, 20), false)
  })
})

describe('Higher or Lower — Poussières', () => {
  it('paliers de série', () => {
    assert.deepEqual([0, 2, 3, 4, 5, 9, 10, 15, 20, 29, 30, 80].map(logic.rewardFor), [0, 0, 5, 5, 15, 15, 40, 70, 100, 100, 150, 150])
    assert.deepEqual(logic.nextTier(0), { streak: 3, reward: 5 })
    assert.deepEqual(logic.nextTier(10), { streak: 15, reward: 70 })
    assert.equal(logic.nextTier(30), null)
  })

  it('plafond du jour', () => {
    assert.equal(logic.cappedReward(10, 0), 40)
    assert.equal(logic.cappedReward(10, logic.HL_DAILY_CAP - 12), 12)
    assert.equal(logic.cappedReward(10, logic.HL_DAILY_CAP), 0)
    assert.equal(logic.cappedReward(10, logic.HL_DAILY_CAP + 50), 0)
  })
})

describe('Higher or Lower — données', () => {
  it('chaque métrique a de quoi tenir une longue série', () => {
    for (const metric of HL_METRICS) {
      const entries = HL_ENTRIES[metric]
      assert.ok(entries.length >= 25, `${metric} : ${entries.length} cartes`)
      assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length, `${metric} : ids en double`)
      assert.ok(new Set(entries.map((entry) => entry.value)).size >= 20, `${metric} : trop de valeurs égales`)
      for (const entry of entries) assert.ok(Number.isFinite(entry.value) && entry.value > 0, `${metric} : ${entry.name}`)
    }
  })

  it('valeurs plausibles', () => {
    assert.equal(new Set(HL_WORKS.map((work) => work.id)).size, HL_WORKS.length)
    for (const entry of HL_ENTRIES.score) assert.ok(entry.value >= 5 && entry.value <= 10, entry.name)
    for (const entry of HL_ENTRIES.chapters) assert.ok(Number.isInteger(entry.value), entry.name)
    for (const entry of HL_ENTRIES.bounty) assert.ok(entry.character, entry.name)
  })
})

/* ---- API --------------------------------------------------------------------------- */

type Account = TestClient & { userId: string }

async function account(email: string, displayName: string): Promise<Account> {
  const device = client()
  const signed = await device.signUp({ email, password: 'motdepasse-test', displayName })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(device, { userId: signed.body.user.id as string })
}

/** La vraie valeur d'une carte (le test triche : il lit les données). */
const valueOf = (metric: string, id: string) => HL_ENTRIES[metric as keyof typeof HL_ENTRIES].find((entry) => entry.id === id)!.value

/** Joue `streak` bonnes réponses puis se trompe jusqu'à perdre toutes ses chances ; renvoie la réponse finale. */
async function play(player: Account, metric: string, streak: number) {
  const started = await player.request('POST', '/higher-lower/runs', { metric })
  assert.equal(started.status, 201, JSON.stringify(started.body))
  assert.equal(started.body.lives, logic.HL_LIVES)
  let { current, next } = started.body
  const id = started.body.id as string
  let right = 0
  let lives = logic.HL_LIVES
  for (;;) {
    const higher = valueOf(metric, next.id) > current.value
    const choice = right < streak ? (higher ? 'higher' : 'lower') : higher ? 'lower' : 'higher'
    const answer = await player.request('POST', `/higher-lower/runs/${id}/guess`, { choice })
    assert.equal(answer.status, 200, JSON.stringify(answer.body))
    assert.equal(answer.body.value, valueOf(metric, next.id))
    if (right < streak) {
      right += 1
      assert.equal(answer.body.correct, true)
    } else {
      assert.equal(answer.body.correct, false)
      if (lives === 0) return { id, answer: answer.body }
      // Erreur pardonnée : une chance de moins, la série reste, la partie continue.
      lives -= 1
      assert.equal(answer.body.result, null)
    }
    assert.equal(answer.body.streak, right)
    assert.equal(answer.body.lives, lives)
    current = { ...next, value: answer.body.value }
    next = answer.body.next
    assert.equal(next.value, null)
  }
}

let alice: Account
let bastien: Account

before(async () => {
  alice = await account('alice-hl@example.com', 'Alice')
  bastien = await account('bastien-hl@example.com', 'Bastien')
})

describe('Higher or Lower — API', () => {
  it('réservé aux comptes', async () => {
    assert.equal((await client().request('GET', '/higher-lower')).status, 401)
    assert.equal((await client().request('POST', '/higher-lower/runs', { metric: 'bounty' })).status, 401)
  })

  it('accueil d’un nouveau joueur', async () => {
    const { status, body } = await alice.request('GET', '/higher-lower')
    assert.equal(status, 200)
    assert.deepEqual(body.me, { best: 0, bestMetric: null, todayBest: 0, earnedToday: 0, games: 0 })
    assert.deepEqual(body.metrics.map((entry: { metric: string }) => entry.metric), [...HL_METRICS])
    assert.equal(body.dailyCap, logic.HL_DAILY_CAP)
    assert.deepEqual(body.leaderboard.today, [])
    assert.equal(body.leaderboard.myAllTime, null)
    // Vitrine : un duel par terrain, la carte B sans sa valeur.
    for (const metric of HL_METRICS) {
      assert.equal(typeof body.samples[metric].current.value, 'number')
      assert.equal(body.samples[metric].next.value, null)
    }
    assert.match(body.samples.bounty.next.image, /luffy/)
  })

  it('la valeur de la carte à deviner ne quitte pas le serveur', async () => {
    const { status, body } = await alice.request('POST', '/higher-lower/runs', { metric: 'bounty' })
    assert.equal(status, 201)
    assert.equal(typeof body.current.value, 'number')
    assert.equal(body.next.value, null)
    assert.notEqual(body.current.id, body.next.id)
    assert.match(body.current.image, /^\/api\/dle\/characters\/onepiece\//)
    // Nulle part une valeur JSON égale à celle de la carte B (la référence mise à part).
    const hidden = valueOf('bounty', body.next.id)
    assert.ok(!new RegExp(`:${hidden}[,}]`).test(JSON.stringify({ ...body, current: { ...body.current, value: null } })))
    assert.equal((await alice.request('POST', '/higher-lower/runs', { metric: 'nope' })).status, 400)
  })

  it('une série de 5 puis une erreur : record, Poussières, partie close', async () => {
    const { id, answer } = await play(alice, 'sales', 5)
    assert.equal(answer.correct, false)
    assert.equal(answer.next, null)
    assert.deepEqual(
      { streak: answer.result.streak, reward: answer.result.reward, balance: answer.result.balance, best: answer.result.best, record: answer.result.record },
      { streak: 5, reward: 15, balance: 15, best: 5, record: true },
    )
    assert.equal((await alice.request('POST', `/higher-lower/runs/${id}/guess`, { choice: 'higher' })).status, 404)
    const entry = await prisma.stardustEntry.findFirst({ where: { userId: alice.userId, reason: 'higher_lower' } })
    assert.equal(entry?.amount, 15)
    assert.deepEqual(JSON.parse(entry!.data), { streak: 5, metric: 'sales' })
  })

  it('une série plus courte ne bat pas le record', async () => {
    const { answer } = await play(alice, 'score', 3)
    assert.equal(answer.result.reward, 5)
    assert.equal(answer.result.record, false)
    assert.equal(answer.result.best, 5)
    assert.equal(answer.result.earnedToday, 20)
  })

  it('classements du jour et de tous les temps', async () => {
    await play(bastien, 'chapters', 7)
    const { body } = await alice.request('GET', '/higher-lower')
    assert.deepEqual(
      body.leaderboard.allTime.map((row: { name: string; streak: number; rank: number; me: boolean }) => [row.name, row.streak, row.rank, row.me]),
      [
        ['Bastien', 7, 1, false],
        ['Alice', 5, 2, true],
      ],
    )
    assert.equal(body.leaderboard.today[0].metric, 'chapters')
    assert.equal(body.leaderboard.myToday, 2)
    // Trois parties : celle laissée en plan au test de la valeur cachée compte aussi.
    assert.deepEqual(body.me, { best: 5, bestMetric: 'sales', todayBest: 5, earnedToday: 20, games: 3 })
    // Jamais d'e-mail dans le classement.
    assert.ok(!JSON.stringify(body).includes('@example.com'))
  })

  it('abandonner compte comme une fin de partie ; une nouvelle partie clôt la précédente', async () => {
    const first = await bastien.request('POST', '/higher-lower/runs', { metric: 'bounty' })
    const second = await bastien.request('POST', '/higher-lower/runs', { metric: 'score' })
    assert.equal((await bastien.request('POST', `/higher-lower/runs/${first.body.id}/guess`, { choice: 'higher' })).status, 404)
    const ended = await bastien.request('POST', `/higher-lower/runs/${second.body.id}/end`)
    assert.equal(ended.status, 200)
    assert.equal(ended.body.streak, 0)
    assert.equal(ended.body.reward, 0)
    const stats = await prisma.higherLowerStats.findUnique({ where: { userId: bastien.userId } })
    assert.equal(stats?.games, 3)
    assert.equal((await alice.request('POST', `/higher-lower/runs/${second.body.id}/end`)).status, 404)
  })

  it('plafond du jour : la récompense est rognée, la série compte quand même', async () => {
    await prisma.higherLowerStats.update({ where: { userId: alice.userId }, data: { dayEarned: logic.HL_DAILY_CAP - 3 } })
    const { answer } = await play(alice, 'bounty', 6)
    assert.equal(answer.result.reward, 3)
    assert.equal(answer.result.capped, true)
    assert.equal(answer.result.best, 6)
    assert.equal(answer.result.record, true)
    const again = await play(alice, 'bounty', 3)
    assert.equal(again.answer.result.reward, 0)
    assert.equal(again.answer.result.capped, true)
  })

  it('d’une partie à l’autre, les cartes déjà vues ne reviennent pas tout de suite', async () => {
    const player = await account('carla-hl@example.com', 'Carla')
    const pool = HL_ENTRIES.bounty.length
    const seen: string[] = []
    // Six parties abandonnées d'emblée : deux cartes chacune.
    for (let game = 0; game < 6; game += 1) {
      const { body } = await player.request('POST', '/higher-lower/runs', { metric: 'bounty' })
      seen.push(body.current.id, body.next.id)
      assert.equal((await player.request('POST', `/higher-lower/runs/${body.id}/end`)).status, 200)
    }
    assert.ok(seen.length < logic.historyWindow(pool))
    assert.equal(new Set(seen).size, seen.length, `cartes revues : ${seen.join(', ')}`)
  })

  it('le profil montre les records', async () => {
    const { body } = await alice.request('GET', '/profile/me')
    assert.deepEqual(body.stats.higherLower, { best: 6, todayBest: 6 })
  })
})

/* ---- COOP ---------------------------------------------------------------------------- */

describe('Higher or Lower — COOP', async () => {
  const coop = await import('../src/modules/higherlower/hl.coop.js')
  after(() => coop.resetCoop())

  let dora: Account
  let eli: Account
  let fanny: Account
  let code: string

  before(async () => {
    dora = await account('dora-hl@example.com', 'Dora')
    eli = await account('eli-hl@example.com', 'Eli')
    fanny = await account('fanny-hl@example.com', 'Fanny')
  })

  /** La bonne (ou la mauvaise) réponse au tour en cours ; le test lit la valeur cachée. */
  const answer = (view: { current: { value: number } }, right: boolean) => {
    const higher = coop.coopNextValueForTests(code)! > view.current.value
    return right === higher ? 'higher' : 'lower'
  }

  it('salon : créer, rejoindre, l’hôte seul lance, à deux au moins', async () => {
    const created = await dora.request('POST', '/higher-lower/coop', { metric: 'sales' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    code = created.body.code
    assert.equal(created.body.phase, 'lobby')
    assert.equal(created.body.hostId, dora.userId)
    assert.equal(created.body.current, null)

    const alone = await dora.request('POST', `/higher-lower/coop/${code}/start`)
    assert.equal(alone.status, 409)
    assert.equal(alone.body.error.code, 'need_players')

    const joined = await eli.request('POST', `/higher-lower/coop/${code}/join`)
    assert.equal(joined.status, 200)
    assert.deepEqual(joined.body.players.map((entry: { name: string }) => entry.name), ['Dora', 'Eli'])
    assert.equal((await eli.request('POST', `/higher-lower/coop/${code}/start`)).status, 403)
    assert.equal((await fanny.request('GET', `/higher-lower/coop/${code}`)).status, 403)

    // L'hôte change de terrain avant de lancer.
    const metric = await dora.request('POST', `/higher-lower/coop/${code}/metric`, { metric: 'bounty' })
    assert.equal(metric.body.metric, 'bounty')
    const overview = await eli.request('GET', '/higher-lower')
    assert.equal(overview.body.currentCoop, code)
  })

  it('chacun son tour, chances communes, la valeur à deviner reste cachée', async () => {
    const started = await dora.request('POST', `/higher-lower/coop/${code}/start`)
    assert.equal(started.status, 200, JSON.stringify(started.body))
    let view = started.body
    assert.equal(view.phase, 'playing')
    assert.deepEqual(view.order, [dora.userId, eli.userId])
    assert.equal(view.active, dora.userId)
    assert.equal(view.lives, logic.HL_LIVES)
    assert.equal(view.next.value, null)
    assert.ok(!new RegExp(`:${coop.coopNextValueForTests(code)}[,}]`).test(JSON.stringify({ ...view, current: { ...view.current, value: null } })))

    // Pas son tour.
    const early = await eli.request('POST', `/higher-lower/coop/${code}/guess`, { choice: 'higher', turn: 0 })
    assert.equal(early.status, 409)
    assert.equal(early.body.error.code, 'not_your_turn')

    // Dora répond juste : la main passe à Eli.
    let reply = await dora.request('POST', `/higher-lower/coop/${code}/guess`, { choice: answer(view, true), turn: 0 })
    assert.equal(reply.status, 200, JSON.stringify(reply.body))
    view = reply.body
    assert.equal(view.streak, 1)
    assert.equal(view.active, eli.userId)
    assert.equal(view.last.by, dora.userId)
    assert.equal(view.last.correct, true)
    assert.equal(typeof view.last.guessed.value, 'number')
    // Un double envoi du même tour ne compte pas deux fois.
    const twice = await dora.request('POST', `/higher-lower/coop/${code}/guess`, { choice: 'higher', turn: 0 })
    assert.equal(twice.status, 409)

    // L'attente longue renvoie tout de suite une version plus récente que celle connue.
    const watched = await dora.request('GET', `/higher-lower/coop/${code}?v=1`)
    assert.equal(watched.body.version, view.version)

    // Eli se trompe : une chance de moins pour toute l'équipe, la série reste.
    reply = await eli.request('POST', `/higher-lower/coop/${code}/guess`, { choice: answer(view, false), turn: view.turn })
    view = reply.body
    assert.equal(view.streak, 1)
    assert.equal(view.lives, logic.HL_LIVES - 1)
    assert.equal(view.active, dora.userId)

    // Erreurs jusqu'à la dernière chance : fin de partie, Poussières pour chacun.
    while (view.phase === 'playing') {
      const who = view.active === dora.userId ? dora : eli
      view = (await who.request('POST', `/higher-lower/coop/${code}/guess`, { choice: answer(view, false), turn: view.turn })).body
    }
    assert.equal(view.phase, 'results')
    assert.equal(view.result.streak, 1)
    assert.equal(view.result.endedBy, 'lives')
    assert.equal(view.result.reward, 0)
    const stats = view.players.map((entry: { name: string; correct: number; misses: number }) => [entry.name, entry.correct, entry.misses])
    assert.deepEqual(stats, [
      ['Dora', 1, 1],
      ['Eli', 0, 2],
    ])
  })

  it('une bonne série rapporte à chacun, sans toucher aux records du solo', async () => {
    let view = (await dora.request('POST', `/higher-lower/coop/${code}/start`)).body
    assert.equal(view.phase, 'playing')
    for (let index = 0; index < 3; index += 1) {
      const who = view.active === dora.userId ? dora : eli
      view = (await who.request('POST', `/higher-lower/coop/${code}/guess`, { choice: answer(view, true), turn: view.turn })).body
    }
    while (view.phase === 'playing') {
      const who = view.active === dora.userId ? dora : eli
      view = (await who.request('POST', `/higher-lower/coop/${code}/guess`, { choice: answer(view, false), turn: view.turn })).body
    }
    assert.equal(view.result.streak, 3)
    assert.equal(view.result.reward, 5)
    const eliView = (await eli.request('GET', `/higher-lower/coop/${code}`)).body
    assert.equal(eliView.result.reward, 5)
    const stats = await prisma.higherLowerStats.findUnique({ where: { userId: eli.userId } })
    assert.equal(stats?.best, 0)
    assert.equal(stats?.dayEarned, 5)
  })

  it('temps écoulé : le tour compte comme une erreur et la main passe', async () => {
    const turnMs = coop.COOP_TIMING.turnMs
    const introMs = coop.COOP_TIMING.introMs
    coop.COOP_TIMING.turnMs = 60
    coop.COOP_TIMING.introMs = 0
    try {
      const view = (await dora.request('POST', `/higher-lower/coop/${code}/start`)).body
      assert.equal(view.active, dora.userId)
      await new Promise((done) => setTimeout(done, 150))
      const after = (await eli.request('GET', `/higher-lower/coop/${code}`)).body
      assert.equal(after.last.by, dora.userId)
      assert.equal(after.last.choice, null)
      assert.equal(after.last.correct, false)
      assert.equal(after.lives, logic.HL_LIVES - 1)
      assert.equal(after.active, eli.userId)
    } finally {
      coop.COOP_TIMING.turnMs = turnMs
      coop.COOP_TIMING.introMs = introMs
    }
  })

  it('quitter en pleine partie : la main passe ; le dernier ferme le salon', async () => {
    const view = (await eli.request('GET', `/higher-lower/coop/${code}`)).body
    assert.equal(view.phase, 'playing')
    assert.equal((await eli.request('POST', `/higher-lower/coop/${code}/leave`)).status, 204)
    const after = (await dora.request('GET', `/higher-lower/coop/${code}`)).body
    assert.equal(after.active, dora.userId)
    assert.equal(after.players.find((entry: { id: string }) => entry.id === eli.userId).left, true)
    assert.equal((await dora.request('POST', `/higher-lower/coop/${code}/leave`)).status, 204)
    assert.equal((await dora.request('GET', `/higher-lower/coop/${code}`)).status, 404)
  })
})
