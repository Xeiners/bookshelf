import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
// Module pur (sans `config`) : importable avant `prepareEnvironment`.
import { compareChapters, normalizeChapter, type ReaderChapter } from '../src/modules/chapters/chapters.normalize.js'
import type { MdChapter } from '../src/modules/chapters/chapters.client.js'
import { BILINGUAL } from './fixtures.js'
import { extraMocks, installMangadexMock, prepareEnvironment, startServer, upstreamCalls, type TestClient } from './harness.js'

prepareEnvironment('reader')
installMangadexMock()
const { client, close, base } = await startServer()
after(close)

/* ---- MangaDex simulé : flux de chapitres et nœuds MD@Home ----------------- */

const chapter = (id: string, number: string | null, language: string, extra: Partial<MdChapter['attributes']> = {}): MdChapter => ({
  id,
  attributes: {
    volume: null,
    chapter: number,
    title: null,
    translatedLanguage: language,
    externalUrl: null,
    pages: 3,
    publishAt: '2024-01-01T00:00:00+00:00',
    ...extra,
  },
  relationships: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'scanlation_group', attributes: { name: 'Team Scan' } }],
})

const CH = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const FEED: MdChapter[] = [
  chapter(CH(10), '10', 'fr'),
  chapter(CH(9), '9', 'fr'),
  chapter(CH(1), '1', 'fr'),
  chapter(CH(2), '1.5', 'fr', { title: 'Bonus' }),
  chapter(CH(20), '1', 'en'),
]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Nœuds en panne : leurs images répondent 502. */
const brokenNodes = new Set<string>()
let atHomeCalls = 0
let nodeIndex = 0
const reports: { url: string; success: boolean }[] = []

extraMocks.push((url, init) => {
  const feed = url.pathname.match(/^\/manga\/([\w-]+)\/feed$/)
  if (url.hostname === 'api.mangadex.org' && feed) {
    const languages = url.searchParams.getAll('translatedLanguage[]')
    const data = feed[1] === BILINGUAL.id ? FEED.filter((item) => languages.includes(item.attributes.translatedLanguage)) : []
    return json({ result: 'ok', data, total: data.length })
  }

  const atHome = url.pathname.match(/^\/at-home\/server\/([\w-]+)$/)
  if (url.hostname === 'api.mangadex.org' && atHome) {
    atHomeCalls += 1
    nodeIndex += 1
    return json({
      result: 'ok',
      baseUrl: `https://node${nodeIndex}.mangadex.network/token`,
      chapter: { hash: 'hash1', data: ['x1-aaa.png', 'x2-bbb.png'], dataSaver: ['x1-aaa.jpg', 'x2-bbb.jpg'] },
    })
  }

  if (url.hostname === 'api.mangadex.network' && url.pathname === '/report') {
    reports.push(JSON.parse(String(init?.body)))
    return json({ result: 'ok' })
  }

  if (url.hostname.endsWith('.mangadex.network')) {
    if (brokenNodes.has(url.hostname) || (brokenNodes.has('*data') && url.pathname.includes('/data/'))) {
      return new Response('down', { status: 502 })
    }
    const kind = url.pathname.endsWith('.png') ? 'image/png' : 'image/jpeg'
    return new Response(new Uint8Array([1, 2, 3, url.pathname.length]), { status: 200, headers: { 'Content-Type': kind } })
  }
  return undefined
})

beforeEach(() => {
  brokenNodes.clear()
  reports.length = 0
})

/* ---- Tri et normalisation --------------------------------------------------- */

describe('chapitres — ordre de lecture', () => {
  it('tri numérique (9 avant 10), one-shot en tête, puis volume et date', () => {
    const make = (number: string | null, volume: string | null = null, publishedAt = '2024'): ReaderChapter => ({
      id: `${number}-${volume}-${publishedAt}`,
      number,
      volume,
      title: null,
      language: 'fr',
      pages: 1,
      groups: [],
      publishedAt,
    })
    const sorted = [make('10'), make('9'), make(null), make('1.5'), make('1', '2'), make('1', '1')].sort(compareChapters)
    assert.deepEqual(
      sorted.map((item) => [item.number, item.volume]),
      [[null, null], ['1', '1'], ['1', '2'], ['1.5', null], ['9', null], ['10', null]],
    )
  })

  it('crédite les équipes de traduction', () => {
    const normalized = normalizeChapter(chapter(CH(1), ' 3 ', 'fr', { title: '  ' }))
    assert.equal(normalized.number, '3')
    assert.equal(normalized.title, null)
    assert.deepEqual(normalized.groups, [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Team Scan' }])
  })
})

describe('GET /api/manga/:id/chapters', () => {
  it('chapitres dans la langue demandée, triés, avec le décompte par langue', async () => {
    const res = await client().request('GET', `/manga/${BILINGUAL.id}/chapters?lang=fr`)
    assert.equal(res.status, 200)
    assert.equal(res.body.language, 'fr')
    assert.deepEqual(res.body.available, { fr: 4, en: 1 })
    assert.deepEqual(
      res.body.chapters.map((item: ReaderChapter) => item.number),
      ['1', '1.5', '9', '10'],
    )
  })

  it('bascule FR → EN sans nouvel appel MangaDex (flux mis en cache)', async () => {
    const before = upstreamCalls.filter((call) => call.includes('/feed')).length
    const res = await client().request('GET', `/manga/${BILINGUAL.id}/chapters?lang=en`)
    assert.equal(res.body.language, 'en')
    assert.equal(res.body.chapters.length, 1)
    assert.equal(upstreamCalls.filter((call) => call.includes('/feed')).length, before)
  })

  it('identifiant invalide → 400', async () => {
    assert.equal((await client().request('GET', '/manga/al-12/chapters')).status, 400)
  })
})

describe('pages MangaDex At-Home', () => {
  it('liste les pages via notre relais, avec repli « Data Saver »', async () => {
    const res = await client().request('GET', `/chapters/${CH(1)}/pages?quality=data`)
    assert.equal(res.status, 200)
    assert.equal(res.body.pages.length, 2)
    assert.equal(res.body.pages[0].url, `/api/chapters/${CH(1)}/image/data/x1-aaa.png`)
    assert.equal(res.body.pages[0].fallbackUrl, `/api/chapters/${CH(1)}/image/data-saver/x1-aaa.jpg`)
  })

  it('le nœud MD@Home est mis en cache : une image ne relance pas /at-home', async () => {
    const calls = atHomeCalls
    const path = (await client().request('GET', `/chapters/${CH(1)}/pages`)).body.pages[1].url.replace('/api', '')
    const response = await fetch(`${base}${path}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.match(response.headers.get('cache-control') ?? '', /immutable/)
    assert.equal(atHomeCalls, calls)
    // Le rapport MD@Home exigé par MangaDex est parti (sans bloquer la réponse).
    await waitFor(() => reports.length > 0)
    assert.equal(reports[0]?.success, true)
  })

  it('nœud en panne : on en redemande un autre et la page arrive quand même', async () => {
    const page = `${base}/chapters/${CH(1)}/image/data/x1-aaa.png`
    await fetch(page)
    brokenNodes.add(`node${nodeIndex}.mangadex.network`)
    const calls = atHomeCalls
    const response = await fetch(page)
    assert.equal(response.status, 200)
    assert.equal(atHomeCalls, calls + 1)
    await waitFor(() => reports.some((report) => !report.success))
  })

  it('originale introuvable partout : repli « Data Saver », jamais mis en cache durablement', async () => {
    brokenNodes.add('*data')
    const response = await fetch(`${base}/chapters/${CH(1)}/image/data/x2-bbb.png`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/jpeg')
    assert.equal(response.headers.get('x-reader-quality'), 'data-saver')
    assert.doesNotMatch(response.headers.get('cache-control') ?? '', /immutable/)
  })

  it('fichier absent du chapitre → 404, nom suspect → 400', async () => {
    assert.equal((await fetch(`${base}/chapters/${CH(1)}/image/data/inconnu.png`)).status, 404)
    assert.equal((await fetch(`${base}/chapters/${CH(1)}/image/data/..%2Fsecret.png`)).status, 400)
    assert.equal((await fetch(`${base}/chapters/${CH(1)}/image/raw/x1-aaa.png`)).status, 400)
  })
})

/* ---- Progression ------------------------------------------------------------- */

describe('PATCH /api/library/progress', () => {
  let account: TestClient
  const position = (page: number, at: number, chapterId = CH(9)) => ({
    chapterId,
    chapter: '9',
    page,
    pageCount: 3,
    offset: 0.25,
    ratio: (page + 1) / 3,
    at,
  })

  before(async () => {
    account = client()
    await account.signUp({ email: `reader-${Date.now()}@example.com`, password: 'motdepasse-test' })
    const book = (await account.request('GET', `/manga/${BILINGUAL.id}?lang=fr`)).body.book
    await account.request('POST', '/library/swipe', { mangaId: book.id, action: 'reading', book })
  })

  it('enregistre la position et le compteur de chapitres', async () => {
    const at = Date.now()
    const res = await account.request('PATCH', '/library/progress', {
      workId: BILINGUAL.id,
      position: position(2, at),
      chaptersRead: 9,
      progress: 0.5,
      at,
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.entry.chaptersRead, 9)
    assert.equal(res.body.entry.progress, 0.5)
    assert.deepEqual(res.body.entry.position, position(2, at))

    const library = (await account.request('GET', '/library')).body
    assert.equal(library.entries[0].position.page, 2)
    assert.equal(library.entries[0].chaptersRead, 9)
  })

  it('un envoi en retard ne recule ni la position ni le compteur', async () => {
    const stale = Date.now() - 60_000
    const res = await account.request('PATCH', '/library/progress', {
      workId: BILINGUAL.id,
      position: position(0, stale, CH(1)),
      chaptersRead: 1,
      at: stale,
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.entry.position.chapterId, CH(9))
    assert.equal(res.body.entry.chaptersRead, 9)
  })

  it('n’est pas pris pour un identifiant d’œuvre (route déclarée avant /:workId)', async () => {
    const res = await account.request('PATCH', '/library/progress', { favorite: true })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'validation_error')
  })

  it('œuvre absente de la bibliothèque → 404', async () => {
    const res = await account.request('PATCH', '/library/progress', {
      workId: 'inconnu',
      position: position(0, Date.now()),
    })
    assert.equal(res.status, 404)
  })

  it('la fusion invité → compte garde le compteur le plus haut et la position', async () => {
    const guest = client()
    const book = (await guest.request('GET', `/manga/${BILINGUAL.id}?lang=fr`)).body.book
    const at = Date.now() - 5_000
    const res = await guest.signUp({
      email: `reader-guest-${Date.now()}@example.com`,
      password: 'motdepasse-test',
      initialData: {
        entries: [
          { book, status: 'reading', progress: 0.2, chaptersRead: 4, position: position(1, at), addedAt: at, updatedAt: at },
        ],
        skipped: [],
      },
    })
    assert.equal(res.status, 201)
    const entry = res.body.library.entries[0]
    assert.equal(entry.chaptersRead, 4)
    assert.equal(entry.position.page, 1)
  })

  it('invité : authentification requise', async () => {
    const res = await client().request('PATCH', '/library/progress', { workId: BILINGUAL.id, position: position(0, Date.now()) })
    assert.equal(res.status, 401)
  })
})

/* ---- Outils ------------------------------------------------------------------ */

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('Condition jamais remplie')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
