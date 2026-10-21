/**
 * Fil « Edits » : recherches, tri de ce qui est un edit, lecture des réponses de YouTube
 * (API officielle et page de résultats), assemblage du fil, et accès ouvert à tous.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { extraMocks, installMangadexMock, mockedHosts, prepareEnvironment, startServer, upstreamCalls, type TestClient } from './harness.js'

process.env.ADMIN_EMAILS = 'edits-admin@example.com'
process.env.MUSIC_SEARCH = 'on'
delete process.env.YOUTUBE_API_KEY
prepareEnvironment('edits')
installMangadexMock()

const logic = await import('../src/modules/edits/edits.logic.js')
const { client, close } = await startServer()
after(close)

/** Une page de résultats youtube.com, avec l'état JSON qu'elle embarque. */
const resultsPage = (data: unknown) => `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`
const id = (n: number, prefix = 'v') => `${prefix}${String(n).padStart(10, '0')}`.slice(0, 11)

describe('edits — logique', () => {
  it('reconnaît un edit, écarte réactions, analyses, bandes-annonces et épisodes', () => {
    assert.equal(logic.looksLikeEdit('Gojo Satoru 4K Edit | Jujutsu Kaisen'), true)
    assert.equal(logic.looksLikeEdit('Naruto AMV - Blue Bird'), true)
    assert.equal(logic.looksLikeEdit('Luffy gear 5 #edit #onepiece'), true)
    assert.equal(logic.looksLikeEdit('Naruto Episode 12 reaction'), false)
    assert.equal(logic.looksLikeEdit('One Piece theory explained'), false)
    assert.equal(logic.looksLikeEdit('Demon Slayer Season 4 Trailer'), false)
    assert.equal(logic.looksLikeEdit('Best anime moments'), false, 'sans indice de montage')
  })

  it('lit les durées de l’API (ISO 8601) et de la page (« 0:45 »)', () => {
    assert.equal(logic.durationSeconds('PT45S'), 45)
    assert.equal(logic.durationSeconds('PT1M5S'), 65)
    assert.equal(logic.durationSeconds('0:58'), 58)
    assert.equal(logic.durationSeconds('1:02:03'), 3723)
    assert.equal(logic.durationSeconds('n’importe quoi'), null)
  })

  it('recherches : un format par univers plus les générales ; un univers : ses trois formats ; ordre propre à la graine', () => {
    const all = logic.editQueries(null, 'a')
    assert.equal(all.length, logic.UNIVERSE_IDS.length + 6)
    assert.ok(all.every((query) => query.q.endsWith('#shorts')))
    assert.notDeepEqual(all, logic.editQueries(null, 'b'))
    assert.deepEqual(all, logic.editQueries(null, 'a'))
    const naruto = logic.editQueries('naruto', 'a')
    assert.equal(naruto.length, 3)
    assert.ok(naruto.every((query) => query.universe === 'naruto' && query.q.startsWith('Naruto ')))
  })

  it('page de résultats : seulement les Shorts (étagères et liens /shorts/), pas les vidéos ordinaires', () => {
    const html = resultsPage({
      contents: [
        { reelItemRenderer: { videoId: id(1), headline: { simpleText: 'Itachi edit 4k' } } },
        { shortsLockupViewModel: { onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: id(2) } } }, overlayMetadata: { primaryText: { content: 'Zoro AMV' } } } },
        {
          videoRenderer: {
            videoId: id(3),
            title: { runs: [{ text: 'Eren edit #shorts' }] },
            lengthText: { simpleText: '0:40' },
            navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: `/shorts/${id(3)}` } } },
          },
        },
        {
          videoRenderer: {
            videoId: id(4),
            title: { runs: [{ text: 'Eren edit (horizontal)' }] },
            navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: `/watch?v=${id(4)}` } } },
          },
        },
        { reelItemRenderer: { videoId: id(5), headline: { simpleText: 'Naruto episode 1 reaction' } } },
        { reelItemRenderer: { videoId: id(1), headline: { simpleText: 'Itachi edit 4k' } } },
      ],
    })
    assert.deepEqual(
      logic.parseShortsPage(html, 'naruto').map((video) => video.id),
      [id(1), id(2), id(3)],
    )
  })

  it('API officielle : verticales, courtes, hors direct seulement ; titres décodés', () => {
    const body = {
      items: [
        { id: id(1), snippet: { title: 'Gojo edit &amp; sync', channelTitle: 'Studio' }, contentDetails: { duration: 'PT30S' }, player: { embedWidth: 360, embedHeight: 640 } },
        { id: id(2), snippet: { title: 'Gojo edit' }, contentDetails: { duration: 'PT30S' }, player: { embedWidth: 640, embedHeight: 360 } },
        { id: id(3), snippet: { title: 'Gojo edit' }, contentDetails: { duration: 'PT10M' }, player: { embedWidth: 360, embedHeight: 640 } },
        { id: id(4), snippet: { title: 'Gojo edit' }, contentDetails: { duration: 'PT30S' } },
      ],
    }
    const videos = logic.parseVideosList(body, 'jjk')
    assert.deepEqual(videos.map((video) => video.id), [id(1)])
    assert.equal(videos[0]?.title, 'Gojo edit & sync')
    assert.equal(videos[0]?.seconds, 30)
  })

  it('mêle les recherches à tour de rôle, sans doublon', () => {
    const v = (n: number) => ({ id: id(n), title: 'x edit', channel: null, seconds: null, universe: null })
    assert.deepEqual(
      logic.interleave([[v(1), v(2), v(3)], [v(4), v(1)], [v(5)]]).map((video) => video.id),
      [id(1), id(4), id(5), id(2), id(3)],
    )
  })
})

describe('edits — API', () => {
  let admin: TestClient
  let member: TestClient

  before(async () => {
    mockedHosts.add('www.youtube.com')
    let counter = 100
    // Chaque recherche rend trois Shorts distincts.
    extraMocks.push((url) => {
      if (url.hostname !== 'www.youtube.com' || url.pathname !== '/results') return undefined
      const shorts = [0, 1, 2].map(() => {
        counter += 1
        return { reelItemRenderer: { videoId: id(counter, 's'), headline: { simpleText: `${url.searchParams.get('search_query')} edit` } } }
      })
      return new Response(resultsPage({ contents: shorts }), { status: 200, headers: { 'Content-Type': 'text/html' } })
    })
    admin = client()
    member = client()
    assert.equal((await admin.signUp({ email: 'edits-admin@example.com', password: 'motdepasse-test', displayName: 'Chef' })).status, 201)
    assert.equal((await member.signUp({ email: 'edits-member@example.com', password: 'motdepasse-test', displayName: 'Membre' })).status, 201)
  })

  it('ouvert à tous : membre, administrateur et invité', async () => {
    assert.equal((await member.request('GET', '/edits?universe=berserk&seed=pub')).status, 200)
    assert.equal((await client().request('GET', '/edits?universe=berserk&seed=pub')).status, 200)
  })

  it('pages successives sans doublon ; les recherches ne partent qu’au fil du défilement, puis restent en cache', async () => {
    const before = upstreamCalls.filter((call) => call.startsWith('www.youtube.com')).length
    const first = await admin.request('GET', '/edits?seed=test1')
    assert.equal(first.status, 200)
    assert.equal(first.body.items.length, 8)
    const afterFirst = upstreamCalls.filter((call) => call.startsWith('www.youtube.com')).length
    assert.equal(afterFirst - before, 4, 'un seul lot de recherches pour la première page')

    const second = await admin.request('GET', `/edits?seed=test1&offset=${first.body.next}`)
    const ids = [...first.body.items, ...second.body.items].map((item: { id: string }) => item.id)
    assert.equal(new Set(ids).size, ids.length)

    const afterSecond = upstreamCalls.filter((call) => call.startsWith('www.youtube.com')).length
    await admin.request('GET', '/edits?seed=test1')
    await admin.request('GET', `/edits?seed=test1&offset=${first.body.next}`)
    assert.equal(upstreamCalls.filter((call) => call.startsWith('www.youtube.com')).length - afterSecond, 0, 'cache : rien de relancé')
  })

  it('filtre par univers ; fin du fil signalée par `next: null`', async () => {
    const page = await admin.request('GET', '/edits?universe=naruto&seed=n1&offset=0')
    assert.equal(page.status, 200)
    assert.ok(page.body.items.every((item: { universe: string }) => item.universe === 'naruto'))
    const end = await admin.request('GET', '/edits?universe=naruto&seed=n1&offset=8')
    assert.equal(end.body.next, null)
    assert.equal((await admin.request('GET', '/edits?universe=inconnu')).status, 400)
  })
})
