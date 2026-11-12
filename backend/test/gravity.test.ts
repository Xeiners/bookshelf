/**
 * Gravity Ninja : ouvert à tous les comptes, l'atelier aux administrateurs (404 pour les autres), niveaux intégrés semés,
 * progression qui ne baisse jamais, atelier (enregistrer, remplacer, supprimer ; les intégrés
 * sont protégés), plan par IA indisponible sans clé, la demande à copier pour un autre assistant, et
 * les récompenses (une fois chacune, jamais pour l'atelier, réussite invraisemblable refusée).
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('gravity')
process.env.ADMIN_EMAILS = 'chef@example.com,maitre@example.com'
delete process.env.ANTHROPIC_API_KEY
delete process.env.GEMINI_API_KEY
const { client, close } = await startServer()
after(close)

const { BUILTIN_LEVELS } = await import('../src/modules/gravity/gravity.levels.js')

const PASSWORD = 'motdepasse-test'

async function account(email: string, displayName: string): Promise<TestClient> {
  const device = client()
  const signed = await device.signUp({ email, password: PASSWORD, displayName })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return device
}

let admin: TestClient
let alice: TestClient
let maitre: TestClient

before(async () => {
  admin = await account('chef@example.com', 'Chef')
  alice = await account('alice@example.com', 'Alice')
  maitre = await account('maitre@example.com', 'Maître')
})

/** Un petit niveau valide (le serveur ne rejoue pas la physique : il vérifie la forme et les bornes). */
const sample = (id: string, name = 'Atelier test') => ({
  format: 1,
  id,
  name,
  theme: 'night',
  difficulty: 4,
  speed: 9.5,
  length: 120,
  start: { y: 11, g: 1 },
  elements: [
    { type: 'block', x: -4, y: 11, w: 30, h: 6 },
    { type: 'block', x: 24, y: -3, w: 120, h: 7 },
    { type: 'spikes', x: 26, y: 11, w: 4, dir: 'up' },
    // Ancien format : un point de reprise, lu puis écarté.
    { type: 'checkpoint', x: 40, y: 4, g: -1 },
    { type: 'scroll', x: 60, y: 7 },
    { type: 'moon', x: 70, y: 5 },
  ],
})

describe('gravity — accès', () => {
  it('invité : 401 ; compte ordinaire : joue, mais l’atelier lui répond 404', async () => {
    assert.equal((await client().request('GET', '/gravity')).status, 401)
    assert.equal((await alice.request('GET', '/gravity')).status, 200)
    assert.equal((await alice.request('GET', '/gravity/levels/premiers-pas')).status, 200)
    const run = await alice.request('POST', '/gravity/levels/premiers-pas/runs', { percent: 40, completed: false, timeMs: 5000, deaths: 1, scrolls: 0 })
    assert.equal(run.status, 200, JSON.stringify(run.body))
    for (const [method, route, body] of [
      ['POST', '/gravity/levels', { level: sample('x') }],
      ['DELETE', '/gravity/levels/x', undefined],
      ['POST', '/gravity/ai/plan', { prompt: 'x' }],
      ['POST', '/gravity/ai/prompt', { prompt: 'x' }],
    ] as const) {
      assert.equal((await alice.request(method, route, body)).status, 404, route)
    }
  })
})

describe('gravity — niveaux et progression', () => {
  it('les niveaux intégrés sont semés, dans l’ordre, et se chargent en entier', async () => {
    const { status, body } = await admin.request('GET', '/gravity')
    assert.equal(status, 200)
    assert.ok(BUILTIN_LEVELS.length >= 5)
    assert.deepEqual(
      body.levels.slice(0, BUILTIN_LEVELS.length).map((level: { id: string }) => level.id),
      BUILTIN_LEVELS.map((level) => (level as { id: string }).id),
    )
    assert.equal(body.levels[0].builtin, true)
    assert.equal(body.levels[0].scrolls, 3)
    assert.deepEqual(body.ai, [])
    const level = await admin.request('GET', `/gravity/levels/${body.levels[0].id}`)
    assert.equal(level.status, 200)
    assert.ok(level.body.level.elements.length > 10)
    assert.equal((await admin.request('GET', '/gravity/levels/inconnu')).status, 404)
  })

  it('la progression ne garde que le meilleur : avancement, fin, temps, chutes, rouleaux', async () => {
    const id = (BUILTIN_LEVELS[0] as { id: string }).id
    const post = (run: object) => admin.request('POST', `/gravity/levels/${id}/runs`, run)
    let res = await post({ percent: 40, completed: false, timeMs: 9000, deaths: 3, scrolls: 1 })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.progress, { bestPercent: 40, completed: false, bestTimeMs: null, fewestDeaths: null, scrolls: 0, attempts: 1 })
    res = await post({ percent: 20, completed: false, timeMs: 4000, deaths: 1, scrolls: 0 })
    assert.equal(res.body.progress.bestPercent, 40, 'jamais en baisse')
    res = await post({ percent: 100, completed: true, timeMs: 41000, deaths: 5, scrolls: 2 })
    assert.deepEqual(res.body.progress, { bestPercent: 100, completed: true, bestTimeMs: 41000, fewestDeaths: 5, scrolls: 2, attempts: 3 })
    res = await post({ percent: 100, completed: true, timeMs: 38000, deaths: 7, scrolls: 1 })
    assert.deepEqual(res.body.progress, { bestPercent: 100, completed: true, bestTimeMs: 38000, fewestDeaths: 5, scrolls: 2, attempts: 4 })
    res = await post({ percent: 12, completed: false, timeMs: 2000, deaths: 1, scrolls: 0 })
    assert.equal(res.body.progress.completed, true, 'un niveau fini le reste')
    assert.equal((await post({ percent: 140, completed: false, timeMs: 1, deaths: 0, scrolls: 0 })).status, 400)
    const overview = await admin.request('GET', '/gravity')
    assert.equal(overview.body.progress[id].bestPercent, 100)
  })
})

describe('gravity — atelier', () => {
  it('enregistrer, remplacer, supprimer un niveau ; les intégrés sont protégés', async () => {
    const saved = await admin.request('POST', '/gravity/levels', { level: sample('atelier-1') })
    assert.equal(saved.status, 201)
    assert.equal(saved.body.level.builtin, false)
    const stored = await admin.request('GET', '/gravity/levels/atelier-1')
    assert.equal(stored.body.level.elements.length, 5)
    assert.ok(stored.body.level.elements.every((element: { type: string }) => element.type !== 'checkpoint'), 'plus de point de reprise')
    let list = (await admin.request('GET', '/gravity')).body.levels
    assert.equal(list[list.length - 1].id, 'atelier-1', 'ajouté à la fin')
    assert.equal((await admin.request('POST', '/gravity/levels', { level: sample('atelier-1', 'Renommé') })).status, 201)
    list = (await admin.request('GET', '/gravity')).body.levels
    assert.equal(list.find((level: { id: string }) => level.id === 'atelier-1').name, 'Renommé')
    const builtinId = (BUILTIN_LEVELS[0] as { id: string }).id
    assert.equal((await admin.request('POST', '/gravity/levels', { level: sample(builtinId) })).status, 409)
    assert.equal((await admin.request('DELETE', `/gravity/levels/${builtinId}`)).status, 409)
    assert.equal((await admin.request('DELETE', '/gravity/levels/atelier-1')).status, 204)
    assert.equal((await admin.request('GET', '/gravity/levels/atelier-1')).status, 404)
  })

  it('un niveau mal formé est refusé (thème inconnu, élément inconnu, bornes)', async () => {
    const broken = [
      { ...sample('casse-1'), theme: 'mars' },
      { ...sample('casse-2'), elements: [{ type: 'laser', x: 1, y: 1 }] },
      { ...sample('casse-3'), speed: 99 },
      { ...sample('Casse Majuscules') },
    ]
    for (const level of broken) assert.equal((await admin.request('POST', '/gravity/levels', { level })).status, 400, JSON.stringify(level).slice(0, 60))
  })

  it('plan par IA : indisponible sans clé (503) ; la demande à copier reste disponible', async () => {
    const plan = await admin.request('POST', '/gravity/ai/plan', { prompt: 'un niveau de Noël', difficulty: 6 })
    assert.equal(plan.status, 503)
    assert.equal(plan.body.error.code, 'gravity_ai_unavailable')
    const prompt = await admin.request('POST', '/gravity/ai/prompt', { prompt: 'un niveau de Noël', difficulty: 6, theme: 'christmas', length: 'short' })
    assert.equal(prompt.status, 200)
    assert.match(prompt.body.prompt, /Gravity Ninja/)
    assert.match(prompt.body.prompt, /Difficulté voulue : 6\/10/)
    assert.match(prompt.body.prompt, /christmas/)
  })
})

describe('gravity — récompenses', () => {
  const won = { percent: 100, completed: true, timeMs: 600_000, deaths: 2 }
  const post = (id: string, run: object) => maitre.request('POST', `/gravity/levels/${id}/runs`, run)
  const builtin = BUILTIN_LEVELS as { id: string; difficulty: number }[]

  it('première réussite : des ✦ selon le palier ; les trois rouleaux : un bonus ; une seule fois chacun', async () => {
    const none = { tierComplete: false, boosters: 0, legendaryPacks: 0, tier: 'easy' }
    assert.equal((await post('premiers-pas', { ...won, completed: false, percent: 60, scrolls: 0 })).body.reward, null, 'une partie non finie ne rapporte rien')
    let res = await post('premiers-pas', { ...won, scrolls: 1 })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.reward, { ...none, clear: 50, scrolls: 0 })
    const balance = res.body.stardust as number
    res = await post('premiers-pas', { ...won, scrolls: 3 })
    assert.deepEqual(res.body.reward, { ...none, clear: 0, scrolls: 25 })
    assert.equal(res.body.stardust, balance + 25)
    res = await post('premiers-pas', { ...won, scrolls: 3 })
    assert.equal(res.body.reward, null, 'rejouer ne rapporte plus rien')
    assert.equal(res.body.stardust, null)
    const fast = await post('pont-des-lanternes', { ...won, timeMs: 2000, scrolls: 0 })
    assert.equal(fast.status, 400, 'plus rapide que la course pure : refusé')
    assert.equal(fast.body.error.code, 'gravity_implausible')
  })

  it('finir tout un palier : un booster offert ; le palier Extrême : un booster Légendaire', async () => {
    for (const [tier, max, gift] of [
      ['easy', 2, { boosters: 1, legendaryPacks: 0 }],
      ['extreme', 10, { boosters: 0, legendaryPacks: 1 }],
    ] as const) {
      const ids = builtin.filter((level) => level.difficulty <= max && (tier === 'easy' || level.difficulty >= 9)).map((level) => level.id)
      assert.ok(ids.length >= 3, tier)
      let last: { body: { reward: Record<string, unknown> | null; boosters: unknown } } | null = null
      for (const id of ids) last = await post(id, { ...won, scrolls: 0 })
      assert.equal(last?.body.reward?.tierComplete, true, tier)
      assert.equal(last?.body.reward?.boosters, gift.boosters)
      assert.equal(last?.body.reward?.legendaryPacks, gift.legendaryPacks)
      assert.ok(last?.body.boosters, 'la réserve de boosters revient à jour')
    }
  })

  it('un niveau de l’atelier ne rapporte rien', async () => {
    assert.equal((await maitre.request('POST', '/gravity/levels', { level: sample('atelier-recompense') })).status, 201)
    const res = await post('atelier-recompense', { ...won, timeMs: 60_000, scrolls: 1 })
    assert.equal(res.status, 200)
    assert.equal(res.body.reward, null)
    assert.equal(res.body.progress.completed, true)
  })
})
