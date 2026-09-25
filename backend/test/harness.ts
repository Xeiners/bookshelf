/**
 * Banc d'essai d'intégration : une vraie API Express, une vraie base SQLite
 * (fichier temporaire, migrations appliquées), et MangaDex simulé.
 *
 * `fetch` est remplacé pour les seuls hôtes MangaDex : les tests sont
 * déterministes, hors-ligne, et peuvent compter les appels sortants.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_MANGAS, TAGS } from './fixtures.js'

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Prépare l'environnement AVANT tout import de l'app (la config est lue au chargement). */
export function prepareEnvironment(name: string): void {
  const dir = path.join(BACKEND_ROOT, 'test', '.tmp')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.db`)
  rmSync(file, { force: true })

  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = `file:${file}`
  process.env.JWT_SECRET = 'test-secret-with-enough-length-for-hs256-signing'

  execSync('npx prisma migrate deploy', {
    cwd: BACKEND_ROOT,
    env: process.env,
    stdio: 'ignore',
  })
}

/* ---- MangaDex simulé --------------------------------------------------- */

export const upstreamCalls: string[] = []

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

function mangadexResponse(url: URL): Response {
  const params = url.searchParams
  if (url.pathname === '/manga/tag') return json({ result: 'ok', data: TAGS, total: TAGS.length })

  if (url.pathname === '/statistics/manga') {
    const statistics = Object.fromEntries(params.getAll('manga[]').map((id) => [id, { rating: { bayesian: 8.4 } }]))
    return json({ result: 'ok', statistics })
  }

  if (url.pathname === '/manga') {
    const ids = params.getAll('ids[]')
    const source = ids.length > 0 ? ALL_MANGAS.filter((manga) => ids.includes(manga.id)) : ALL_MANGAS
    const offset = Number(params.get('offset') ?? 0)
    const limit = Number(params.get('limit') ?? 10)
    return json({ result: 'ok', data: source.slice(offset, offset + limit), total: source.length })
  }

  const single = url.pathname.match(/^\/manga\/([\w-]+)$/)
  if (single) {
    const found = ALL_MANGAS.find((manga) => manga.id === single[1])
    return found ? json({ result: 'ok', data: found }) : new Response('{}', { status: 404 })
  }

  return new Response('{}', { status: 404 })
}

export function installMangadexMock(): void {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.hostname === 'api.mangadex.org') {
      upstreamCalls.push(`${url.pathname}?${url.searchParams.toString()}`)
      return mangadexResponse(url)
    }
    return realFetch(input, init)
  }
}

/* ---- Client HTTP avec cookie ------------------------------------------- */

export interface TestClient {
  request: (method: string, route: string, body?: unknown) => Promise<{ status: number; body: any }>
  /**
   * Inscription complète, comme un utilisateur : formulaire, code lu dans
   * l'e-mail (boîte en mémoire), puis vérification. Renvoie la réponse de la
   * vérification (201 + session), ou celle de la 1ʳᵉ étape si elle échoue.
   */
  signUp: (body: { email: string; password: string; initialData?: unknown; [key: string]: unknown }) => Promise<{ status: number; body: any }>
}

/** Dernier code envoyé à une adresse (e-mails de la boîte en mémoire). */
export async function lastCodeFor(email: string): Promise<string> {
  const { outbox } = await import('../src/lib/mailer.js')
  const mail = [...outbox].reverse().find((message) => message.to === email.trim().toLowerCase())
  const match = mail?.text.match(/\b(\d{3}) (\d{3})\b/)
  if (!match) throw new Error(`Aucun code envoyé à ${email}`)
  return match[1]! + match[2]!
}

export async function startServer() {
  const { createApp } = await import('../src/app.js')
  const server = createApp().listen(0)
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`

  /** Chaque client a son propre cookie : un « appareil ». */
  const client = (): TestClient => {
    let cookie = ''
    const request: TestClient['request'] = async (method, route, body) => {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: {
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(cookie && { Cookie: cookie }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0] ?? ''
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : null }
    }
    return {
      request,
      async signUp({ initialData, ...form }) {
        const started = await request('POST', '/auth/register', form)
        if (started.status !== 202) return started
        const code = await lastCodeFor(form.email)
        return request('POST', '/auth/register/verify', { email: form.email, code, initialData })
      },
    }
  }

  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const { prisma } = await import('../src/db.js')
    await prisma.$disconnect()
  }

  return { client, close }
}
