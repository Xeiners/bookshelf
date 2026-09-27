/**
 * Bibliothèques personnelles : Komga de bout en bout (vraie API, instance
 * simulée sur une adresse PRIVÉE, comme sur un réseau Docker), et
 * l'adaptateur Kavita directement. Formes de réponse relevées dans le code
 * source des deux projets (DTO Komga `/api/v1`, DTO Kavita).
 */
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { encodeChapterKey } from '../src/extensions/chapterKey.js'
import { createKavitaProvider } from '../src/extensions/providers/kavita.provider.js'
import { originImageFetcher } from '../src/extensions/providers/library.js'
import { BILINGUAL } from './fixtures.js'
import { extraMocks, installMangadexMock, mockedHosts, prepareEnvironment, startServer } from './harness.js'

prepareEnvironment('library')
process.env.OPEN_COMIC_API_URL = 'http://komga:25600'
process.env.OPEN_COMIC_KIND = 'komga'
process.env.OPEN_COMIC_API_KEY = 'komga-secret-key'
process.env.OPEN_COMIC_NAME = 'Ma bibliothèque'
installMangadexMock()
for (const host of ['komga', 'kavita', 'evil.example.test']) mockedHosts.add(host)
const { client, close, base } = await startServer()
after(close)

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const image = () => new Response(new Uint8Array([255, 216, 255, 1]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
const headerOf = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string> | undefined)?.[name]

/* ---- Instances simulées --------------------------------------------------------------------- */

const CH = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const komgaCalls: { path: string; apiKey: string | undefined }[] = []
const evilCalls: string[] = []

let kavitaAuths = 0
let kavitaExpireOnce = false
const kavitaBearers: (string | undefined)[] = []

extraMocks.push((url, init) => {
  if (url.hostname === 'api.mangadex.org' && /^\/manga\/[\w-]+\/feed$/.test(url.pathname)) {
    const data =
      url.pathname.includes(BILINGUAL.id)
        ? [{ id: CH(1), attributes: { volume: null, chapter: '1', title: null, translatedLanguage: 'fr', externalUrl: null, pages: 5, publishAt: '2024-01-01T00:00:00+00:00' }, relationships: [] }]
        : []
    return json({ result: 'ok', data, total: data.length })
  }

  if (url.hostname === 'komga') {
    komgaCalls.push({ path: url.pathname + url.search, apiKey: headerOf(init, 'X-API-Key') })
    if (headerOf(init, 'X-API-Key') !== 'komga-secret-key') return new Response('', { status: 401 })
    if (url.pathname === '/api/v1/series') {
      return json({
        content: [
          { id: 'suite', name: 'The Blade Road 2', metadata: { title: 'The Blade Road 2', language: 'fr', alternateTitles: [] } },
          { id: 'serie-1', name: 'Blade Road', metadata: { title: 'The Blade Road', language: 'fr', alternateTitles: [{ label: 'fr', title: 'La Voie du sabre' }] } },
        ],
      })
    }
    if (url.pathname === '/api/v1/series/serie-1/books') {
      return json({
        content: [
          { id: 'b1', name: 'Blade Road - Chapitre 1', number: 1, created: '2024-02-01T10:00:00', metadata: { title: 'Chapitre 1', number: '1', releaseDate: null }, media: { pagesCount: 5 } },
          { id: 'b-t2', name: 'Blade Road T02', number: 2, created: '2024-02-01T10:00:00', metadata: { title: 'Tome 2', number: '2', releaseDate: '2023-05-10' }, media: { pagesCount: 3 } },
          { id: 'b11', name: 'Blade Road - Chapitre 11', number: 11, created: '2024-02-01T10:00:00', metadata: { title: 'Le duel', number: '11', releaseDate: null }, media: { pagesCount: 2 } },
        ],
      })
    }
    if (url.pathname === '/api/v1/books/b11/pages') return json([{ number: 1, fileName: '001.jpg', mediaType: 'image/jpeg' }, { number: 2, fileName: '002.jpg', mediaType: 'image/jpeg' }])
    if (/^\/api\/v1\/books\/b11\/pages\/\d$/.test(url.pathname)) return image()
    return new Response('{}', { status: 404 })
  }

  if (url.hostname === 'kavita') {
    if (url.pathname === '/api/Plugin/authenticate') {
      kavitaAuths += 1
      return url.searchParams.get('apiKey') === 'kavita-key' && url.searchParams.get('pluginName') === 'Bookshelf' && init?.method === 'POST'
        ? json({ username: 'moi', token: `jwt-${kavitaAuths}`, apiKey: 'kavita-key' })
        : new Response('', { status: 401 })
    }
    const bearer = headerOf(init, 'Authorization')
    kavitaBearers.push(bearer)
    if (url.pathname === '/api/Reader/image') return url.searchParams.get('apiKey') === 'kavita-key' ? image() : new Response('', { status: 401 })
    if (!bearer?.startsWith('Bearer jwt-')) return new Response('', { status: 401 })
    if (url.pathname === '/api/Search/search') {
      return json({ series: [{ seriesId: 7, name: 'La Voie du Sabre', originalName: 'Katana no Michi', localizedName: 'The Blade Road', libraryName: 'Manga' }], chapters: [] })
    }
    if (url.pathname === '/api/Series/volumes') {
      if (kavitaExpireOnce) {
        kavitaExpireOnce = false
        return new Response('', { status: 401 })
      }
      return json([
        // Chapitres « en vrac », hors volume.
        { id: 1, name: '-100000', minNumber: -100000, number: -100000, chapters: [{ id: 50, range: '5', number: '5', minNumber: 5, title: '5', titleName: '', pages: 20, isSpecial: false, releaseDate: '0001-01-01T00:00:00', created: '2024-03-01T00:00:00' }] },
        // Un fichier = un tome entier.
        { id: 2, name: 'Volume 1', minNumber: 1, number: 1, chapters: [{ id: 60, range: '-100000', number: '-100000', minNumber: -100000, title: '', titleName: '', pages: 180, isSpecial: false, releaseDate: '0001-01-01T00:00:00', created: '2024-03-01T00:00:00' }] },
        // Chapitre dans un volume.
        { id: 3, name: '2', minNumber: 2, number: 2, chapters: [{ id: 70, range: '12.5', number: '12.5', minNumber: 12.5, title: '12.5', titleName: 'Interlude', pages: 18, isSpecial: false, releaseDate: '2024-01-15T00:00:00', created: '2024-03-01T00:00:00' }] },
        // Hors-série.
        { id: 4, name: '100000', minNumber: 100000, number: 100000, chapters: [{ id: 80, range: 'Artbook', number: '100000', minNumber: 100000, title: 'Artbook', titleName: 'Artbook', pages: 40, isSpecial: true, releaseDate: '0001-01-01T00:00:00', created: '2024-03-01T00:00:00' }] },
      ])
    }
    if (url.pathname === '/api/Reader/chapter-info') return json({ chapterNumber: '5', pages: 3, seriesId: 7 })
    return new Response('{}', { status: 404 })
  }

  if (url.hostname === 'evil.example.test') {
    evilCalls.push(url.pathname)
    return image()
  }
  return undefined
})

beforeEach(() => {
  komgaCalls.length = 0
})

/* ---- Komga, de bout en bout ------------------------------------------------------------------ */

describe('Komga (bibliothèque personnelle, adresse privée)', () => {
  it('retrouve la série par titre (pas la suite), liste ses livres, avec la clé d’API partout', async () => {
    const res = await client().request('GET', `/manga/${BILINGUAL.id}/chapters?lang=fr`)
    assert.equal(res.status, 200)
    const komga = res.body.sources.find((source: { id: string }) => source.id === 'komga')
    assert.deepEqual([komga.name, komga.status, komga.chapters], ['Ma bibliothèque', 'ok', 3])
    assert.ok(komgaCalls.length >= 2)
    assert.ok(komgaCalls.every((call) => call.apiKey === 'komga-secret-key'))
    assert.ok(komgaCalls.some((call) => call.path.startsWith('/api/v1/series/serie-1/books')), 'la bonne série, pas « The Blade Road 2 »')

    const chapters = res.body.chapters as { id: string; number: string | null; volume: string | null; title: string | null; source: { id: string }; alternates: { id: string }[] }[]
    // Chapitre 1 : MangaDex principal (priorité), le fichier Komga en alternative.
    const first = chapters.find((chapter) => chapter.number === '1')
    assert.equal(first?.source.id, 'mangadex')
    assert.deepEqual(first?.alternates.map((alt) => alt.id), [encodeChapterKey('komga', 'b1')])
    // Tome entier : un volume, pas un « chapitre 2 ».
    const tome = chapters.find((chapter) => chapter.id === encodeChapterKey('komga', 'b-t2'))
    assert.deepEqual([tome?.number, tome?.volume, tome?.title], [null, '2', 'Tome 2'])
    // Chapitre propre à la bibliothèque, avec son titre.
    const eleventh = chapters.find((chapter) => chapter.number === '11')
    assert.deepEqual([eleventh?.source.id, eleventh?.title], ['komga', 'Le duel'])
  })

  it('images servies par Komga malgré son adresse privée, clé d’API jamais exposée au navigateur', async () => {
    const key = encodeChapterKey('komga', 'b11')
    const pages = await client().request('GET', `/chapters/${key}/pages`)
    assert.equal(pages.status, 200)
    assert.equal(pages.body.pages.length, 2)
    assert.equal(JSON.stringify(pages.body).includes('komga:25600'), false)
    assert.equal(JSON.stringify(pages.body).includes('komga-secret-key'), false)

    const response = await fetch(`${base}${pages.body.pages[1].url.replace('/api', '')}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/jpeg')
    const imageCall = komgaCalls.find((call) => call.path === '/api/v1/books/b11/pages/2')
    assert.equal(imageCall?.apiKey, 'komga-secret-key')
  })
})

/* ---- Téléchargement restreint à l'origine configurée ----------------------------------------- */

describe('images des bibliothèques : origine configurée seulement', () => {
  it('refuse toute autre origine, sans la joindre', async () => {
    const fetchImage = originImageFetcher({ baseUrl: 'http://komga:25600', headers: () => ({ 'X-API-Key': 'k' }), userAgent: 'test' })
    for (const url of ['http://evil.example.test/steal.jpg', 'http://komga:9999/api/v1/books/b11/pages/1', 'https://komga:25600/x.jpg']) {
      const { image: received, reason } = await fetchImage({ index: 0, url })
      assert.equal(received, null, url)
      assert.match(reason ?? '', /origine/)
    }
    assert.deepEqual(evilCalls, [])
  })
})

/* ---- Kavita ------------------------------------------------------------------------------------- */

describe('Kavita (adaptateur)', () => {
  const kavita = (apiKey = 'kavita-key') =>
    createKavitaProvider({ baseUrl: 'http://kavita:5000', name: 'Kavita', language: 'fr', userAgent: 'test', apiKey, log: () => {} })

  it('clé d’API → jeton, réutilisé ; retrouve la série par son titre localisé', async () => {
    const provider = kavita()
    kavitaAuths = 0
    const chapters = await provider.fetchChapterList('manga-1', ['The Blade Road', 'La Voie du sabre'])
    assert.equal(kavitaAuths, 1, 'une seule authentification pour la recherche et les volumes')
    assert.ok(kavitaBearers.slice(-2).every((bearer) => bearer === 'Bearer jwt-1'))
    assert.equal(chapters.length, 4)
  })

  it('volumes Kavita : chapitres en vrac, tome entier, chapitre dans un volume, hors-série', async () => {
    const chapters = await kavita().fetchChapterList('manga-2', ['The Blade Road'])
    const byId = Object.fromEntries(chapters.map((chapter) => [chapter.id, chapter]))
    assert.deepEqual([byId['50']?.number, byId['50']?.volume, byId['50']?.title], ['5', null, null])
    assert.equal(byId['50']?.publishedAt, '2024-03-01T00:00:00.000Z', 'date « 0001-01-01 » ignorée')
    assert.deepEqual([byId['60']?.number, byId['60']?.volume, byId['60']?.title, byId['60']?.pages], [null, '1', 'Volume 1', 180])
    assert.deepEqual([byId['70']?.number, byId['70']?.volume, byId['70']?.title], ['12.5', '2', 'Interlude'])
    assert.deepEqual([byId['80']?.number, byId['80']?.volume, byId['80']?.title], [null, null, 'Artbook'])
  })

  it('jeton expiré (401) : nouvelle authentification et nouvel essai, sans erreur', async () => {
    const provider = kavita()
    await provider.fetchChapterList('manga-3', ['The Blade Road'])
    kavitaAuths = 0
    kavitaExpireOnce = true
    const chapters = await provider.fetchChapterList('manga-4', ['The Blade Road'])
    assert.equal(chapters.length, 4)
    assert.equal(kavitaAuths, 1)
  })

  it('pages : nombre lu dans chapter-info, images téléchargées depuis Kavita avec la clé', async () => {
    const provider = kavita()
    const pages = await provider.fetchPageUrls('50', { quality: 'data' })
    assert.equal(pages.length, 3)
    assert.match(pages[2]?.url ?? '', /^http:\/\/kavita:5000\/api\/Reader\/image\?chapterId=50&page=2&apiKey=kavita-key/)
    const { image: received } = await provider.fetchImage!(pages[0]!)
    assert.equal(received?.contentType, 'image/jpeg')
  })

  it('mauvaise clé : échec explicite, et la clé suivante réessaie l’authentification', async () => {
    const provider = kavita('mauvaise-cle')
    kavitaAuths = 0
    await assert.rejects(provider.fetchChapterList('manga-5', ['The Blade Road']), { status: 502 })
    await assert.rejects(provider.fetchChapterList('manga-6', ['The Blade Road']), { status: 502 })
    assert.equal(kavitaAuths, 2, 'une authentification ratée n’est pas gardée en cache')
  })
})
