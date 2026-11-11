/**
 * Gravity Ninja — plans de niveaux écrits par une IA, Gemini ou Claude. Un faux serveur imite
 * l'API de chacune (même chemin, mêmes en-têtes, mêmes réponses) : on vérifie ce qui part (modèle,
 * consignes, schéma de sortie, clé) et ce que la route en fait (plan validé, refus, quota, clé
 * refusée, modèle inconnu, réponse illisible).
 */
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'
import { prepareEnvironment, startServer, type TestClient } from './harness.js'

interface Seen {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: Record<string, unknown>
}

const PLAN = {
  name: 'Neige éternelle',
  theme: 'christmas',
  difficulty: 6,
  sections: [
    { kind: 'switch', intensity: 5 },
    { kind: 'crumble', intensity: 6 },
    { kind: 'moon', intensity: 5 },
    { kind: 'zigzag', intensity: 7 },
  ],
}

/** Ce que le faux serveur répond au prochain appel. */
let mode: 'ok' | 'bad-json' | 'off-schema' | 'safety' | 'quota' | 'no-model' | 'bad-key' = 'ok'
const seen: Seen[] = []

const geminiReply = (text: string, finishReason = 'STOP') => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason, index: 0 }],
  usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 120, totalTokenCount: 1020 },
  modelVersion: 'gemini-3.8-flash',
})
const geminiError = (code: number, status: string, message: string) => ({ error: { code, message, status } })

const fake = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : {} })
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    if (req.url?.includes(':generateContent')) {
      if (mode === 'quota') return send(429, geminiError(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted (e.g. check quota).'))
      if (mode === 'no-model') return send(404, geminiError(404, 'NOT_FOUND', 'models/gemini-3.8-flash is not found for API version v1.'))
      if (mode === 'bad-key') return send(400, geminiError(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.'))
      if (mode === 'safety') return send(200, geminiReply('', 'SAFETY'))
      if (mode === 'bad-json') return send(200, geminiReply('Voici un super niveau !'))
      if (mode === 'off-schema') return send(200, geminiReply(JSON.stringify({ ...PLAN, sections: [{ kind: 'teleport', intensity: 99 }] })))
      return send(200, geminiReply(JSON.stringify(PLAN)))
    }
    if (req.url?.endsWith('/v1/messages')) {
      return send(200, {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify({ ...PLAN, name: 'Plan de Claude' }) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 120 },
      })
    }
    send(404, { error: 'inconnu' })
  })
})
await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`

prepareEnvironment('gravity-ai')
process.env.ADMIN_EMAILS = 'chef@example.com'
process.env.GEMINI_API_KEY = 'cle-gemini-test'
process.env.GEMINI_BASE_URL = base
process.env.ANTHROPIC_API_KEY = 'cle-claude-test'
process.env.ANTHROPIC_BASE_URL = base
delete process.env.GEMINI_MODEL
const { client, close } = await startServer()
after(async () => {
  await close()
  fake.close()
})

let admin: TestClient

before(async () => {
  admin = client()
  const signed = await admin.signUp({ email: 'chef@example.com', password: 'motdepasse-test', displayName: 'Chef' })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
})

beforeEach(() => {
  mode = 'ok'
  seen.length = 0
})

const ask = (body: object) => admin.request('POST', '/gravity/ai/plan', { prompt: 'un niveau de Noël assez dur', difficulty: 6, theme: 'christmas', length: 'short', ...body })

describe('gravity — plans par IA', () => {
  it('les deux IA branchées sont annoncées, Gemini d’abord', async () => {
    const { body } = await admin.request('GET', '/gravity')
    assert.deepEqual(body.ai, ['gemini', 'claude'])
  })

  it('Gemini : la demande part avec la clé, le modèle, les consignes et le schéma du plan ; le plan revient validé', async () => {
    const { status, body } = await ask({ provider: 'gemini' })
    assert.equal(status, 200, JSON.stringify(body))
    assert.deepEqual(body.plan, PLAN)
    assert.equal(seen.length, 1)
    const [call] = seen
    assert.equal(call!.method, 'POST')
    assert.match(call!.url, /\/models\/gemini-3\.8-flash:generateContent$/)
    assert.equal(call!.headers['x-goog-api-key'], 'cle-gemini-test')
    const generation = call!.body.generationConfig as Record<string, unknown>
    assert.equal(generation.responseMimeType, 'application/json')
    const schema = generation.responseJsonSchema as { properties: { sections: { items: { properties: { kind: { enum: string[] } } } } } }
    assert.ok(schema.properties.sections.items.properties.kind.enum.includes('moon'))
    const system = JSON.stringify(call!.body.systemInstruction)
    assert.match(system, /Gravity Ninja/)
    assert.match(JSON.stringify(call!.body.contents), /Difficulté voulue : 6\/10/)
  })

  it('sans IA précisée : la première branchée (Gemini)', async () => {
    const { status } = await ask({})
    assert.equal(status, 200)
    assert.match(seen[0]!.url, /:generateContent$/)
  })

  it('Claude reste possible quand les deux sont branchées', async () => {
    const { status, body } = await ask({ provider: 'claude' })
    assert.equal(status, 200, JSON.stringify(body))
    assert.equal(body.plan.name, 'Plan de Claude')
    assert.match(seen[0]!.url, /\/v1\/messages$/)
    assert.equal(seen[0]!.body.model, 'claude-opus-5-5')
  })

  it('Gemini : réponse illisible ou hors du format → 502, refus de sécurité → 422', async () => {
    mode = 'bad-json'
    let res = await ask({ provider: 'gemini' })
    assert.equal(res.status, 502)
    assert.equal(res.body.error.code, 'gravity_ai_invalid')
    mode = 'off-schema'
    res = await ask({ provider: 'gemini' })
    assert.equal(res.status, 502)
    assert.equal(res.body.error.code, 'gravity_ai_invalid')
    mode = 'safety'
    res = await ask({ provider: 'gemini' })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'gravity_ai_refused')
  })

  it('Gemini : quota gratuit atteint → 429, modèle inconnu → 502 explicite, clé refusée → 503', async () => {
    mode = 'quota'
    let res = await ask({ provider: 'gemini' })
    assert.equal(res.status, 429)
    assert.equal(res.body.error.code, 'gravity_ai_busy')
    mode = 'no-model'
    res = await ask({ provider: 'gemini' })
    assert.equal(res.status, 502)
    assert.equal(res.body.error.code, 'gravity_ai_model')
    mode = 'bad-key'
    res = await ask({ provider: 'gemini' })
    assert.equal(res.status, 503)
    assert.equal(res.body.error.code, 'gravity_ai_unavailable')
  })

  it('une IA inconnue est refusée (400)', async () => {
    assert.equal((await ask({ provider: 'chatgpt' })).status, 400)
  })
})
