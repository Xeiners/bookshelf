/**
 * Récompense quotidienne : calendrier de 30 jours (logique pure), série à jours consécutifs
 * (heure de Paris), crédit des récompenses, et pack du 30e jour à Légendaire garantie.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { WorkStatistics } from '../src/services/catalog.service.js'
import { catalogManga } from './fixtures.js'
import { installMangadexMock, prepareEnvironment, startServer } from './harness.js'

prepareEnvironment('daily')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')
const { CYCLE_DAYS, MILESTONE_DAYS, calendarFor, planDaily, shiftDay, stateOf, tierOf } = await import('../src/modules/daily/daily.logic.js')
const { claimDaily, dailyStatus } = await import('../src/modules/daily/daily.service.js')
const { WELCOME_GIFT_BOXES } = await import('../src/modules/runner/runner.wardrobe.js')

const statistics = new Map<string, WorkStatistics>()
const WORKS = Array.from({ length: 720 }, (_, index) => {
  const manga = catalogManga({ genres: ['Action'], originalLanguage: (['ja', 'ja', 'ko', 'zh'] as const)[index % 4] })
  statistics.set(manga.id, { follows: 1000 + index * 37, rating: 6 + (index % 35) / 10 })
  return manga
})

/** Jour de Paris → midi ce jour-là (à l'abri des changements d'heure). */
const noon = (day: string) => new Date(`${day}T12:00:00+02:00`)

async function account(name: string) {
  const device = client()
  const signed = await device.signUp({ email: `${name.toLowerCase()}-${Date.now()}@example.com`, password: 'motdepasse-test', displayName: name })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(device, { userId: signed.body.user.id as string })
}

/** Valeur approximative d'une case : un booster ≈ 340 Poussières, une boîte ≈ 300. */
const worth = (reward: { stardust: number; boosters: number; boxes: number }) => reward.stardust + 340 * reward.boosters + 300 * reward.boxes

describe('calendrier (logique pure)', () => {
  it('30 cases, toujours les mêmes pour un compte et un cycle, autres pour un autre cycle', () => {
    const first = calendarFor('u1', 0)
    assert.equal(first.length, CYCLE_DAYS)
    assert.deepEqual(first, calendarFor('u1', 0))
    assert.notDeepEqual(first.map((day) => day.reward), calendarFor('u1', 1).map((day) => day.reward))
    assert.notDeepEqual(first.map((day) => day.reward), calendarFor('u2', 0).map((day) => day.reward))
  })

  it('chaque case contient quelque chose ; jalons 7/14/21 plus riches ; le 30e est le pack à Légendaire', () => {
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const days = calendarFor('u1', cycle)
      for (const { reward, tier, day } of days) {
        assert.ok(reward.stardust + reward.boosters + reward.boxes > 0 || reward.pack, `jour ${day} vide`)
        assert.equal(tier, tierOf(day))
        if (tier === 'common') {
          assert.equal(reward.pack, false)
          assert.ok(worth(reward) <= 340, `jour ${day} trop riche pour un jour ordinaire`)
        }
      }
      for (const day of MILESTONE_DAYS) {
        const { reward } = days[day - 1]!
        assert.ok(worth(reward) >= 400, `jalon ${day} trop maigre`)
      }
      assert.equal(days[CYCLE_DAYS - 1]!.reward.pack, true)
      assert.equal(days.filter((entry) => entry.reward.pack).length, 1)
    }
  })

  it('un calendrier mêle Poussières, boosters et boîtes', () => {
    const kinds = new Set<string>()
    for (const { reward } of calendarFor('u1', 3)) {
      if (reward.stardust) kinds.add('stardust')
      if (reward.boosters) kinds.add('boosters')
      if (reward.boxes) kinds.add('boxes')
    }
    assert.deepEqual([...kinds].sort(), ['boosters', 'boxes', 'stardust'])
  })

  it('shiftDay franchit les mois et les années', () => {
    assert.equal(shiftDay('2026-03-01', -1), '2026-02-28')
    assert.equal(shiftDay('2026-12-31', 1), '2027-01-01')
    assert.equal(shiftDay('2028-03-01', -1), '2028-02-29')
  })

  it('planDaily : premier jour, lendemain, même jour, jour manqué, calendrier terminé', () => {
    assert.deepEqual(planDaily(null, '2026-10-18'), { claimable: true, day: 1, cycle: 0, streak: 0, broken: false })
    const row = { streak: 4, cycle: 2, lastDay: '2026-10-17' }
    assert.deepEqual(planDaily(row, '2026-10-18'), { claimable: true, day: 5, cycle: 2, streak: 4, broken: false })
    assert.deepEqual(planDaily({ ...row, lastDay: '2026-10-18' }, '2026-10-18'), { claimable: false, day: 4, cycle: 2, streak: 4, broken: false })
    // Un jour manqué : retour à 1, autre calendrier, série perdue signalée.
    assert.deepEqual(planDaily({ ...row, lastDay: '2026-10-16' }, '2026-10-18'), { claimable: true, day: 1, cycle: 3, streak: 0, broken: true })
    // 30 jours pris : le lendemain ouvre un nouveau calendrier, sans « série perdue ».
    assert.deepEqual(planDaily({ streak: 30, cycle: 2, lastDay: '2026-10-17' }, '2026-10-18'), { claimable: true, day: 1, cycle: 3, streak: 0, broken: false })
    assert.equal(planDaily({ streak: 30, cycle: 2, lastDay: '2026-09-01' }, '2026-10-18').broken, false)
  })

  it('stateOf : pris, aujourd’hui, à venir', () => {
    const plan = planDaily({ streak: 2, cycle: 0, lastDay: '2026-10-17' }, '2026-10-18')
    assert.deepEqual([1, 2, 3, 4].map((day) => stateOf(plan, day)), ['claimed', 'claimed', 'today', 'upcoming'])
    const done = planDaily({ streak: 3, cycle: 0, lastDay: '2026-10-18' }, '2026-10-18')
    assert.deepEqual([3, 4].map((day) => stateOf(done, day)), ['claimed', 'upcoming'])
  })
})

describe('récompense quotidienne — API', () => {
  before(async () => {
    const { upsertWorks, reloadPool } = await import('../src/services/catalog.service.js')
    await upsertWorks(WORKS, statistics)
    await reloadPool()
  })

  it('sans compte : refusé', async () => {
    assert.equal((await client().request('GET', '/daily')).status, 401)
    assert.equal((await client().request('POST', '/daily/claim')).status, 401)
  })

  it('un compte neuf ouvre le calendrier, prend la case du jour une seule fois, et la reçoit', async () => {
    const lea = await account('Lea')
    const status = (await lea.request('GET', '/daily')).body
    assert.equal(status.claimable, true)
    assert.equal(status.day, 1)
    assert.equal(status.calendar.length, 30)
    assert.equal(status.calendar[0].state, 'today')
    assert.ok(status.secondsUntilReset >= 1 && status.secondsUntilReset <= 24 * 3600 + 3600)

    const before = {
      stardust: (await prisma.user.findUniqueOrThrow({ where: { id: lea.userId } })).stardust,
      gifted: (await prisma.userBooster.findUnique({ where: { userId: lea.userId } }))?.giftedBoosters ?? 0,
      boxes: (await prisma.runnerStats.findUnique({ where: { userId: lea.userId } }))?.giftBoxes ?? WELCOME_GIFT_BOXES,
    }
    const expected = status.calendar[0].reward
    const claimed = await lea.request('POST', '/daily/claim')
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body))
    assert.deepEqual(claimed.body.reward, expected)
    assert.equal(claimed.body.status.claimable, false)
    assert.equal(claimed.body.status.streak, 1)
    assert.equal(claimed.body.status.calendar[0].state, 'claimed')

    const after = {
      stardust: (await prisma.user.findUniqueOrThrow({ where: { id: lea.userId } })).stardust,
      gifted: (await prisma.userBooster.findUnique({ where: { userId: lea.userId } }))?.giftedBoosters ?? 0,
      boxes: (await prisma.runnerStats.findUnique({ where: { userId: lea.userId } }))?.giftBoxes ?? WELCOME_GIFT_BOXES,
    }
    assert.equal(after.stardust - before.stardust, expected.stardust)
    assert.equal(after.gifted - before.gifted, expected.boosters)
    assert.equal(after.boxes - before.boxes, expected.boxes)

    const again = await lea.request('POST', '/daily/claim')
    assert.equal(again.status, 409)
    assert.equal(again.body.error.code, 'daily_claimed')
  })

  it('deux prises simultanées : une seule est créditée', async () => {
    const ana = await account('Ana')
    const results = await Promise.allSettled([claimDaily(ana.userId), claimDaily(ana.userId), claimDaily(ana.userId)])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal((await prisma.dailyReward.findUniqueOrThrow({ where: { userId: ana.userId } })).totalClaims, 1)
  })

  it('les jours d’affilée avancent la série ; un jour manqué repart du jour 1 avec un autre calendrier', async () => {
    const zoe = await account('Zoe')
    const start = '2026-03-10'
    let status = await dailyStatus(zoe.userId, noon(start))
    const firstCalendar = status.calendar.map((day) => day.reward)
    for (let index = 0; index < 3; index += 1) {
      const result = await claimDaily(zoe.userId, { now: noon(shiftDay(start, index)) })
      assert.equal(result.day, index + 1)
    }
    // Même jour : déjà pris.
    status = await dailyStatus(zoe.userId, noon(shiftDay(start, 2)))
    assert.deepEqual([status.claimable, status.streak], [false, 3])
    // Lendemain : la case 4 est à prendre.
    status = await dailyStatus(zoe.userId, noon(shiftDay(start, 3)))
    assert.deepEqual([status.claimable, status.day, status.streak, status.broken], [true, 4, 3, false])
    // Deux jours plus tard : série perdue.
    status = await dailyStatus(zoe.userId, noon(shiftDay(start, 4)))
    assert.deepEqual([status.claimable, status.day, status.streak, status.broken, status.bestStreak], [true, 1, 0, true, 3])
    assert.notDeepEqual(status.calendar.map((day) => day.reward), firstCalendar)
    const restart = await claimDaily(zoe.userId, { now: noon(shiftDay(start, 4)) })
    assert.equal(restart.day, 1)
    assert.equal(restart.status.streak, 1)
    assert.equal(restart.status.bestStreak, 3)
  })

  it('minuit à Paris : 23 h 59 et 0 h 01 sont deux jours différents', async () => {
    const eva = await account('Eva')
    await claimDaily(eva.userId, { now: new Date('2026-06-10T21:59:00Z') }) // 23 h 59 à Paris (été)
    assert.equal((await dailyStatus(eva.userId, new Date('2026-06-10T21:59:30Z'))).claimable, false)
    const next = await dailyStatus(eva.userId, new Date('2026-06-10T22:01:00Z')) // 0 h 01 le lendemain
    assert.deepEqual([next.claimable, next.day, next.streak], [true, 2, 1])
  })

  it('30 jours d’affilée : le 30e jour offre un pack dont une Légendaire (ou Mythique) au moins, puis un nouveau calendrier', async () => {
    const kai = await account('Kai')
    const start = '2026-04-01'
    for (let index = 0; index < 29; index += 1) {
      const result = await claimDaily(kai.userId, { now: noon(shiftDay(start, index)) })
      assert.equal(result.cards.length, 0, 'pas de cartes avant le 30e jour')
    }
    const owned = async () => (await prisma.userCard.aggregate({ where: { userId: kai.userId }, _sum: { count: true } }))._sum.count ?? 0
    const cardsBefore = await owned()
    const grand = await claimDaily(kai.userId, { now: noon(shiftDay(start, 29)) })
    assert.equal(grand.day, 30)
    assert.equal(grand.reward.pack, true)
    assert.equal(grand.cards.length, 4)
    assert.ok(grand.cards.some((entry) => entry.card.rarity === 'LEGENDARY' || entry.card.rarity === 'MYTHIC'), 'une Légendaire au moins')
    assert.equal((await owned()) - cardsBefore, 4)
    assert.deepEqual([grand.status.claimable, grand.status.streak], [false, 30])
    assert.ok(grand.status.calendar.every((day) => day.state === 'claimed'))

    const tomorrow = await dailyStatus(kai.userId, noon(shiftDay(start, 30)))
    assert.deepEqual([tomorrow.claimable, tomorrow.day, tomorrow.streak, tomorrow.broken, tomorrow.cycle], [true, 1, 0, false, grand.status.cycle + 1])
  })
})
