import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { applyDraw, previousDay } from '../src/modules/oracle/streak.js'
import { matchesPace, PACES } from '../src/modules/oracle/decks.js'
import { hashString, seededRandom, shuffle } from '../src/lib/seeded.js'
import { installMangadexMock, prepareEnvironment, startServer } from './harness.js'

prepareEnvironment('oracle')
installMangadexMock()
const { client, close } = await startServer()
after(close)

describe('Oracle — série (logique pure)', () => {
  const fresh = { lastDay: null, streak: 0, best: 0 }

  it('previousDay traverse mois et années', () => {
    assert.equal(previousDay('2026-03-01'), '2026-02-28')
    assert.equal(previousDay('2028-03-01'), '2028-02-29')
    assert.equal(previousDay('2026-01-01'), '2025-12-31')
  })

  it('premier tirage → 1, lendemain → +1, même jour → inchangé', () => {
    const one = applyDraw(fresh, '2026-09-20')
    assert.deepEqual(one, { lastDay: '2026-09-20', streak: 1, best: 1 })
    const two = applyDraw(one, '2026-09-21')
    assert.equal(two.streak, 2)
    assert.deepEqual(applyDraw(two, '2026-09-21'), two)
  })

  it('un jour sauté remet la série à 1 mais garde le record', () => {
    const state = { lastDay: '2026-09-21', streak: 5, best: 5 }
    assert.deepEqual(applyDraw(state, '2026-09-23'), { lastDay: '2026-09-23', streak: 1, best: 5 })
  })

  it('un jour antérieur (horloge d’un autre appareil) est ignoré', () => {
    const state = { lastDay: '2026-09-21', streak: 3, best: 4 }
    assert.deepEqual(applyDraw(state, '2026-09-19'), state)
  })

  it('une série revendiquée ne peut que relever, jamais baisser', () => {
    assert.equal(applyDraw(fresh, '2026-09-20', 6).streak, 6)
    const state = { lastDay: '2026-09-19', streak: 9, best: 9 }
    assert.equal(applyDraw(state, '2026-09-20', 2).streak, 10)
  })
})

describe('Oracle — paquets et hasard', () => {
  it('rythme : longueur inconnue exclue des formats « court » et « épique »', () => {
    const short = PACES.find((pace) => pace.id === 'short')!
    const epic = PACES.find((pace) => pace.id === 'epic')!
    assert.equal(matchesPace(short, '42'), true)
    assert.equal(matchesPace(short, '120'), false)
    assert.equal(matchesPace(epic, '200'), true)
    assert.equal(matchesPace(epic, null), false)
    assert.equal(matchesPace(PACES.find((pace) => pace.id === 'ongoing')!, null), true)
  })

  it('même graine, même suite ; graines différentes, suites différentes', () => {
    const a = seededRandom('device:2026-09-25')
    const b = seededRandom('device:2026-09-25')
    const c = seededRandom('device:2026-09-26')
    const seqA = [a(), a(), a()]
    assert.deepEqual(seqA, [b(), b(), b()])
    assert.notDeepEqual(seqA, [c(), c(), c()])
    assert.equal(hashString('x'), hashString('x'))
    assert.deepEqual(shuffle([1, 2, 3, 4], seededRandom('s')), shuffle([1, 2, 3, 4], seededRandom('s')))
  })
})

describe('Oracle — API', () => {
  it('GET /oracle/draw est déterministe pour une graine et localisé', async () => {
    const guest = client()
    const first = await guest.request('GET', '/oracle/draw?seed=device-abc:2026-09-25&lang=en')
    const again = await guest.request('GET', '/oracle/draw?seed=device-abc:2026-09-25&lang=en')
    assert.equal(first.status, 200)
    assert.ok(first.body.mood && first.body.pace)
    assert.ok(first.body.picks.length > 0, 'jamais de tirage vide')
    assert.deepEqual(first.body, again.body)
    assert.ok(first.body.picks.every((book: { lang: string }) => book.lang === 'en'))

    const french = await guest.request('GET', '/oracle/draw?seed=device-abc:2026-09-25&lang=fr')
    assert.deepEqual(
      french.body.picks.map((book: { id: string }) => book.id),
      first.body.picks.map((book: { id: string }) => book.id),
      'la langue ne change pas le tirage, seulement ses textes',
    )
  })

  it('refuse une graine absente', async () => {
    const response = await client().request('GET', '/oracle/draw?lang=fr')
    assert.equal(response.status, 400)
  })

  it('checkin : série serveur, exposée par /auth/me', async () => {
    const device = client()
    await device.request('POST', '/auth/register', {
      email: `oracle-${Date.now()}@example.com`,
      password: 'motdepasse-oracle',
    })
    const me = await device.request('GET', '/auth/me')
    assert.deepEqual(me.body.user.oracle, { lastDay: null, streak: 0, best: 0 })

    const today = new Date().toISOString().slice(0, 10)
    const yesterday = previousDay(today)
    await device.request('POST', '/oracle/checkin', { day: yesterday })
    const second = await device.request('POST', '/oracle/checkin', { day: today })
    assert.equal(second.status, 200)
    assert.deepEqual(second.body.oracle, { lastDay: today, streak: 2, best: 2 })

    const repeat = await device.request('POST', '/oracle/checkin', { day: today })
    assert.equal(repeat.body.oracle.streak, 2, 'un seul tirage compté par jour')
    assert.deepEqual((await device.request('GET', '/auth/me')).body.user.oracle, second.body.oracle)
  })

  it('checkin : jour invalide, jour trop lointain, invité', async () => {
    const device = client()
    await device.request('POST', '/auth/register', {
      email: `oracle-bad-${Date.now()}@example.com`,
      password: 'motdepasse-oracle',
    })
    assert.equal((await device.request('POST', '/oracle/checkin', { day: '25/09/2026' })).status, 400)
    const future = await device.request('POST', '/oracle/checkin', { day: '2999-01-01' })
    assert.equal(future.status, 400)
    assert.equal(future.body.error.code, 'invalid_day')
    assert.equal((await client().request('POST', '/oracle/checkin', { day: '2026-09-25' })).status, 401)
  })
})
