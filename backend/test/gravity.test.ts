/**
 * Gravity Ninja : réservé aux administrateurs (404 pour les autres), niveaux intégrés semés,
 * progression qui ne baisse jamais, atelier (enregistrer, remplacer, supprimer ; les intégrés
 * sont protégés), plan par IA indisponible sans clé, et la demande à copier pour un autre assistant.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('gravity')
process.env.ADMIN_EMAILS = 'chef@example.com'
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

before(async () => {
  admin = await account('chef@example.com', 'Chef')
  alice = await account('alice@example.com', 'Alice')
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
    { type: 'checkpoint', x: 40, y: 4, g: -1 },
    { type: 'scroll', x: 60, y: 7 },
    { type: 'moon', x: 70, y: 5 },
  ],
})

describe('gravity — accès', () => {
  it('invité : 401 ; compte ordinaire : 404 (le mode n’existe pas encore pour lui)', async () => {
    assert.equal((await client().request('GET', '/gravity')).status, 401)
    for (const [method, route] of [['GET', '/gravity'], ['GET', '/gravity/levels/premiers-pas'], ['POST', '/gravity/levels']] as const) {
      assert.equal((await alice.request(method, route, method === 'POST' ? { level: sample('x') } : undefined)).status, 404, route)
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
    assert.equal(saved.body.level.checkpoints, 1)
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
