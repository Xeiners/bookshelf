/**
 * Sources multiples, de bout en bout : vraie API, MangaDex + OpenComicStream +
 * Consumet simulés. Fusion des chapitres, relais d'images avec en-têtes de
 * provenance, repli d'une source à l'autre, garde-fous du relais, pannes isolées.
 */
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import type { MdChapter } from '../src/modules/chapters/chapters.client.js'
import { encodeChapterKey } from '../src/extensions/chapterKey.js'
import { network } from '../src/modules/proxy/proxy.fetch.js'
import { BILINGUAL, ENGLISH_ONLY, NO_TRANSLATION } from './fixtures.js'
import { extraMocks, installMangadexMock, mockedHosts, prepareEnvironment, startServer } from './harness.js'

prepareEnvironment('sources')
process.env.OPEN_COMIC_API_URL = 'https://comics.example.test'
process.env.OPEN_COMIC_NAME = 'Source FR'
process.env.CONSUMET_API_URL = 'https://consumet.example.test'
process.env.CONSUMET_PROVIDER = 'mangapill'
process.env.CONSUMET_LANGUAGE = 'fr'
installMangadexMock()
for (const host of ['comics.example.test', 'consumet.example.test', 'img.example.test', 'internal.example.test']) mockedHosts.add(host)
// Pas de vrai DNS en test : les hôtes fictifs sont « publics », sauf celui qui simule un rebond interne.
network.lookup = async (host) => (host === 'internal.example.test' ? ['10.0.0.9'] : ['93.184.216.34'])

const { client, close, base } = await startServer()
after(close)

/* ---- Amonts simulés ---------------------------------------------------------------------- */

const CH = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const mdChapter = (id: string, number: string, language: string): MdChapter => ({
  id,
  attributes: { volume: null, chapter: number, title: null, translatedLanguage: language, externalUrl: null, pages: 2, publishAt: '2024-01-01T00:00:00+00:00' },
  relationships: [],
})
const FEEDS: Record<string, MdChapter[]> = {
  [BILINGUAL.id]: [mdChapter(CH(1), '1', 'fr'), mdChapter(CH(2), '2', 'fr'), mdChapter(CH(20), '1', 'en')],
  [ENGLISH_ONLY.id]: [mdChapter(CH(30), '1', 'en')],
  [NO_TRANSLATION.id]: [mdChapter(CH(40), '1', 'fr')],
}

const OC1 = encodeChapterKey('opencomic', 'oc-1')
const OC11 = encodeChapterKey('opencomic', 'oc-11')
const CS1 = encodeChapterKey('consumet', 'blade-road/chapter-1')

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let atHomeDown = false
let openComicTitles: string[] = []
const brokenImages = new Set<string>()
const imageRequests: { path: string; headers: Record<string, string> }[] = []
const internalCalls: string[] = []

extraMocks.push((url, init) => {
  if (url.hostname === 'api.mangadex.org') {
    const feed = url.pathname.match(/^\/manga\/([\w-]+)\/feed$/)
    if (feed) {
      const data = FEEDS[feed[1]!] ?? []
      return json({ result: 'ok', data, total: data.length })
    }
    if (url.pathname.startsWith('/at-home/server/')) {
      if (atHomeDown) return new Response('{}', { status: 500 })
      return json({ result: 'ok', baseUrl: 'https://node1.mangadex.network/t', chapter: { hash: 'h', data: ['a.png'], dataSaver: ['a.jpg'] } })
    }
    return undefined
  }

  if (url.hostname === 'comics.example.test') {
    if (url.pathname === '/chapters') {
      const mangaId = url.searchParams.get('mangadexId')
      if (mangaId === ENGLISH_ONLY.id) return new Response('panne', { status: 500 })
      // Format modifié côté source : plus d'identifiant.
      if (mangaId === NO_TRANSLATION.id) return json({ chapters: [{ number: 1, language: 'fr' }] })
      openComicTitles = url.searchParams.getAll('title')
      return json({
        chapters: [
          { id: 'oc-1', number: '01', language: 'fr', pages: 2, groups: ['Team FR'] },
          { id: 'oc-11', number: '11', language: 'fr', pages: 2 },
          { id: 'oc-en-2', number: 2, language: 'en', pages: 2 },
          { id: 'oc-de', number: '3', language: 'de' },
        ],
      })
    }
    if (url.pathname === '/chapters/oc-1/pages') {
      return json({
        headers: { Referer: 'https://comics.example.test/' },
        pages: [
          'https://img.example.test/oc-1/0.jpg',
          { url: 'https://img.example.test/oc-1/1.jpg', headers: { Referer: 'https://comics.example.test/oc-1', Cookie: 'secret=1' } },
        ],
      })
    }
    if (url.pathname === '/chapters/oc-11/pages') {
      return json({ pages: ['https://internal.example.test/evil.jpg', 'http://127.0.0.1:1/evil.jpg'] })
    }
    return new Response('{}', { status: 404 })
  }

  if (url.hostname === 'consumet.example.test') {
    const root = '/manga/mangapill'
    if (url.pathname === `${root}/info`) {
      return url.searchParams.get('id') === 'blade-road'
        ? json({ chapters: [{ id: 'blade-road/chapter-1', title: 'Chapter 1' }, { id: 'blade-road/chapter-11', chapterNumber: '11' }] })
        : new Response('{}', { status: 404 })
    }
    if (url.pathname === `${root}/read`) {
      return json([
        { page: 2, img: 'https://img.example.test/cs-1/1.jpg' },
        { page: 1, img: 'https://img.example.test/cs-1/0.jpg', headerForImage: { Referer: 'https://consumet.example.test/' } },
      ])
    }
    // Recherche : une suite au titre proche AVANT la bonne œuvre, pour vérifier la correspondance exacte.
    const query = decodeURIComponent(url.pathname.slice(root.length + 1))
    return json({
      results: query.includes('Blade')
        ? [{ id: 'blade-road-2', title: 'The Blade Road 2' }, { id: 'blade-road', title: 'The Blade Road' }]
        : [{ id: 'other', title: 'Something Else' }],
    })
  }

  if (url.hostname === 'internal.example.test') {
    internalCalls.push(url.pathname)
    return new Response('secret', { status: 200, headers: { 'Content-Type': 'image/png' } })
  }

  if (url.hostname === 'img.example.test') {
    imageRequests.push({ path: url.pathname, headers: { ...(init?.headers as Record<string, string>) } })
    if (brokenImages.has(url.pathname)) return new Response('gone', { status: 404 })
    return new Response(new Uint8Array([255, 216, 255, url.pathname.length]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
  }
  return undefined
})

beforeEach(() => {
  brokenImages.clear()
  imageRequests.length = 0
})

/* ---- Liste fusionnée ------------------------------------------------------------------------ */

describe('GET /api/manga/:id/chapters — sources fusionnées', () => {
  it('fusionne MangaDex, OpenComicStream et Consumet, dédoublonne par numéro et langue', async () => {
    const res = await client().request('GET', `/manga/${BILINGUAL.id}/chapters?lang=fr`)
    assert.equal(res.status, 200)
    const { chapters, sources, available } = res.body
    assert.deepEqual(chapters.map((item: { number: string }) => item.number), ['1', '2', '11'])
    assert.deepEqual(available, { fr: 3, en: 2 })
    assert.deepEqual(
      sources.map((source: { id: string; name: string; status: string }) => [source.id, source.name, source.status]),
      [['mangadex', 'MangaDex', 'ok'], ['opencomic', 'Source FR', 'ok'], ['consumet', 'Consumet', 'ok']],
    )

    // Chapitre 1 : MangaDex principal, les deux autres sources en repli (par priorité).
    const [first, second, eleventh] = chapters
    assert.equal(first.id, CH(1))
    assert.deepEqual(first.source, { id: 'mangadex', name: 'MangaDex' })
    assert.deepEqual(first.alternates.map((alt: { id: string }) => alt.id), [OC1, CS1])
    assert.equal(second.alternates.length, 0)
    // Chapitre 11 : absent de MangaDex, fourni par la source prioritaire suivante.
    assert.equal(eleventh.id, OC11)
    assert.equal(eleventh.source.name, 'Source FR')
    assert.deepEqual(eleventh.alternates.map((alt: { source: { id: string } }) => alt.source.id), ['consumet'])
  })

  it('les sources par titre reçoivent les titres de l’œuvre ; les langues hors fr / en sont écartées', async () => {
    assert.ok(openComicTitles.includes('The Blade Road'))
    const res = await client().request('GET', `/manga/${BILINGUAL.id}/chapters?lang=en`)
    assert.deepEqual(res.body.chapters.map((item: { number: string }) => item.number), ['1', '2'])
    assert.equal(res.body.chapters.some((item: { id: string }) => item.id.includes(Buffer.from('oc-de').toString('base64url'))), false)
  })
})

/* ---- Pages et relais d'images ------------------------------------------------------------------ */

describe('relais d’images des sources externes', () => {
  it('liste les pages via notre relais : jamais d’URL amont côté navigateur', async () => {
    const res = await client().request('GET', `/chapters/${OC1}/pages?alt=${CS1}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.fallback, false)
    assert.deepEqual(res.body.source, { id: 'opencomic', name: 'Source FR' })
    assert.equal(res.body.pages.length, 2)
    const first = new URL(res.body.pages[0].url, 'http://x')
    assert.equal(first.pathname, `/api/proxy/page/${OC1}/0`)
    assert.equal(first.searchParams.get('n'), '2')
    assert.equal(first.searchParams.get('alt'), CS1)
    assert.equal(JSON.stringify(res.body).includes('img.example.test'), false)
  })

  it('réinjecte les en-têtes de provenance, et eux seuls', async () => {
    const page0 = await fetch(`${base}/proxy/page/${OC1}/0?n=2`)
    assert.equal(page0.status, 200)
    assert.equal(page0.headers.get('content-type'), 'image/jpeg')
    assert.match(page0.headers.get('cache-control') ?? '', /max-age=86400/)
    assert.equal(imageRequests[0]?.headers.Referer, 'https://comics.example.test/')
    assert.match(imageRequests[0]?.headers['User-Agent'] ?? '', /Bookshelf/)

    await fetch(`${base}/proxy/page/${OC1}/1?n=2`)
    assert.equal(imageRequests[1]?.headers.Referer, 'https://comics.example.test/oc-1')
    assert.equal(Object.keys(imageRequests[1]?.headers ?? {}).some((name) => /cookie/i.test(name)), false)
  })

  it('image introuvable : bascule sur la même page d’une autre source, sans cache durable', async () => {
    brokenImages.add('/oc-1/1.jpg')
    const response = await fetch(`${base}/proxy/page/${OC1}/1?n=2&alt=${CS1}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-reader-fallback'), 'consumet')
    assert.doesNotMatch(response.headers.get('cache-control') ?? '', /86400/)
    assert.deepEqual(imageRequests.map((request) => request.path), ['/oc-1/1.jpg', '/cs-1/1.jpg'])
  })

  it('pas de repli page à page si l’autre version n’a pas le même nombre de pages', async () => {
    brokenImages.add('/oc-1/1.jpg')
    const response = await fetch(`${base}/proxy/page/${OC1}/1?n=5&alt=${CS1}`)
    assert.equal(response.status, 502)
  })

  it('refuse les URL internes fournies par une source (SSRF), sans jamais les joindre', async () => {
    assert.equal((await client().request('GET', `/chapters/${OC11}/pages`)).status, 200)
    assert.equal((await fetch(`${base}/proxy/page/${OC11}/0?n=2`)).status, 502)
    assert.equal((await fetch(`${base}/proxy/page/${OC11}/1?n=2`)).status, 502)
    assert.deepEqual(internalCalls, [])
  })

  it('pages MangaDex en panne : la version d’une autre source est servie à la place', async () => {
    atHomeDown = true
    try {
      const res = await client().request('GET', `/chapters/${CH(1)}/pages?alt=${OC1},${CS1}`)
      assert.equal(res.status, 200)
      assert.equal(res.body.chapterId, CH(1))
      assert.equal(res.body.servedBy, OC1)
      assert.equal(res.body.fallback, true)
      assert.equal(res.body.source.id, 'opencomic')
    } finally {
      atHomeDown = false
    }
  })

  it('identifiants invalides → 400 ; MangaDex n’emprunte pas le relais générique', async () => {
    assert.equal((await client().request('GET', '/chapters/nope/pages')).status, 400)
    assert.equal((await fetch(`${base}/proxy/page/${CH(1)}/0`)).status, 400)
    assert.equal((await fetch(`${base}/proxy/page/${OC1}/abc`)).status, 400)
    assert.equal((await fetch(`${base}/proxy/page/opencomic~a%2Fb/0`)).status, 400)
  })
})

/* ---- Pannes isolées ------------------------------------------------------------------------------ */

describe('isolation des pannes', () => {
  it('source en panne (500) : le catalogue MangaDex est servi, la source signalée en échec', async () => {
    const res = await client().request('GET', `/manga/${ENGLISH_ONLY.id}/chapters?lang=en`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.chapters.map((item: { id: string }) => item.id), [CH(30)])
    const status = Object.fromEntries(res.body.sources.map((source: { id: string; status: string }) => [source.id, source.status]))
    assert.deepEqual(status, { mangadex: 'ok', opencomic: 'failed', consumet: 'ok' })
  })

  it('format de réponse modifié : intercepté, jamais propagé au lecteur', async () => {
    const res = await client().request('GET', `/manga/${NO_TRANSLATION.id}/chapters?lang=fr`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.chapters.map((item: { id: string }) => item.id), [CH(40)])
    assert.equal(res.body.sources.find((source: { id: string }) => source.id === 'opencomic').status, 'failed')
  })
})
