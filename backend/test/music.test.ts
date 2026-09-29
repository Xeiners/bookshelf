/**
 * Recherche YouTube de la musique d'ambiance : lecture de la page de
 * résultats (deux formats mêlés), réponse de la Data API, et route
 * `/api/music/search` (validation, repli quand l'API officielle échoue, cache).
 */
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { extraMocks, installMangadexMock, mockedHosts, prepareEnvironment, startServer, upstreamCalls } from './harness.js'

prepareEnvironment('music')
// Clé factice : la route passe d'abord par la Data API simulée, puis se replie sur la page.
process.env.YOUTUBE_API_KEY = 'test-key'
process.env.MUSIC_SEARCH = 'on'
installMangadexMock()

const { decodeEntities, extractInitialData, parseDataApiResponse, parseResultsPage, clearMusicSearchCache } = await import(
  '../src/modules/music/youtubeSearch.js'
)
const { parsePlaylistPage, videosIn, clearPlaylistCache } = await import('../src/modules/music/youtubePlaylist.js')

/* ---- Page de résultats simulée ------------------------------------------------------ */

const videoRenderer = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: 'The Cure' }] },
    lengthText: { simpleText: '3:27' },
    thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: 'DEFAULT' } }],
    ...extra,
  },
})

const lockup = (id: string, type: 'PLAYLIST' | 'VIDEO', title: string, badge: string, badgeStyle = 'DEFAULT') => ({
  lockupViewModel: {
    contentId: id,
    contentType: `LOCKUP_CONTENT_TYPE_${type}`,
    contentImage: {
      collectionThumbnailViewModel: {
        primaryThumbnail: {
          thumbnailViewModel: {
            image: { sources: [{ url: `https://i.ytimg.com/vi/${id}/hq720.jpg`, width: 360 }] },
            overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: badge, badgeStyle } }] } }],
          },
        },
      },
    },
    metadata: {
      lockupMetadataViewModel: {
        title: { content: title },
        metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: 'Revive Music' } }] }] } },
      },
    },
  },
})

const page = (contents: unknown[]) =>
  `<html><script>var ytInitialData = ${JSON.stringify({ contents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents } }] } } })};</script></html>`

const RESULTS = page([
  lockup('RDEMLUGe1lzhB7MnQLLEheFTww', 'PLAYLIST', 'Mix : The Cure', 'Mix'),
  videoRenderer('mGgMZpGYiy8', "The Cure - Friday I'm In Love"),
  lockup('n3nPiBai66M', 'VIDEO', 'The Cure - Just Like Heaven', '3:27'),
  videoRenderer('jfKfPfyJRdk', 'lofi hip hop radio', {
    lengthText: undefined,
    badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }],
  }),
  // Doublon (même vidéo dans une étagère « Pour vous ») : gardé une fois.
  videoRenderer('mGgMZpGYiy8', "The Cure - Friday I'm In Love"),
  lockup('PLxA687tYuMWjwLHZv1RP_4uw7OFRk443S', 'PLAYLIST', 'The Best of The Cure', '40 vidéos'),
])

describe('page de résultats youtube.com', () => {
  it('lit les deux formats de vidéo, dans l’ordre, sans doublon ni mix', () => {
    const videos = parseResultsPage(RESULTS, 'video')
    assert.deepEqual(
      videos.map((video) => [video.id, video.title, video.duration, video.live]),
      [
        ['mGgMZpGYiy8', "The Cure - Friday I'm In Love", '3:27', false],
        ['n3nPiBai66M', 'The Cure - Just Like Heaven', '3:27', false],
        ['jfKfPfyJRdk', 'lofi hip hop radio', null, true],
      ],
    )
    assert.equal(videos[0]?.channel, 'The Cure')
    assert.equal(videos[1]?.channel, 'Revive Music')
    assert.equal(videos[0]?.thumbnail, 'https://i.ytimg.com/vi/mGgMZpGYiy8/mqdefault.jpg')
  })

  it('lit les playlists avec leur nombre de vidéos, mix automatiques exclus', () => {
    const playlists = parseResultsPage(RESULTS, 'playlist')
    assert.deepEqual(
      playlists.map((playlist) => [playlist.id, playlist.title, playlist.videoCount, playlist.duration]),
      [['PLxA687tYuMWjwLHZv1RP_4uw7OFRk443S', 'The Best of The Cure', '40 vidéos', null]],
    )
    assert.equal(playlists[0]?.thumbnail, 'https://i.ytimg.com/vi/PLxA687tYuMWjwLHZv1RP_4uw7OFRk443S/hq720.jpg')
  })

  it('page méconnaissable : aucun résultat, jamais d’exception', () => {
    assert.equal(extractInitialData('<html>consent</html>'), null)
    assert.equal(extractInitialData('<script>var ytInitialData = {cassé};</script>'), null)
    assert.deepEqual(parseResultsPage('<html></html>', 'video'), [])
  })
})

/* ---- Playlist YouTube (import) ---------------------------------------------------- */

const PLAYLIST_PAGE = `<html><script>var ytcfg = {"INNERTUBE_API_KEY":"clé-test","INNERTUBE_CLIENT_VERSION":"2.20260925.08.00"};</script><script>var ytInitialData = ${JSON.stringify({
  metadata: { playlistMetadataRenderer: { title: 'The Best of The Cure' } },
  contents: {
    items: [
      lockup('scif2vfg1ug', 'VIDEO', 'The Cure - In Between Days', '3:09'),
      lockup('n3nPiBai66M', 'VIDEO', 'The Cure - Just Like Heaven', '3:27'),
      // Même vidéo deux fois dans la playlist : un seul morceau.
      lockup('n3nPiBai66M', 'VIDEO', 'The Cure - Just Like Heaven', '3:27'),
      videoRenderer('mGgMZpGYiy8', "The Cure - Friday I'm In Love"),
      { continuationItemViewModel: { continuationCommand: {} } },
      { continuationItemViewModel: { continuationCommand: { token: 'suite-1' } } },
    ],
  },
})};</script></html>`

describe('playlist YouTube : import', () => {
  it('lit le titre, les vidéos (deux formats), le jeton de la suite et les réglages pour la demander', () => {
    const page = parsePlaylistPage(PLAYLIST_PAGE)
    assert.equal(page.title, 'The Best of The Cure')
    assert.deepEqual(page.videos.map((video) => video.id), ['scif2vfg1ug', 'n3nPiBai66M', 'n3nPiBai66M', 'mGgMZpGYiy8'])
    assert.equal(page.videos[0]?.duration, '3:09')
    assert.equal(page.continuation, 'suite-1', 'le premier jeton vide est ignoré')
    assert.equal(page.apiKey, null, 'clé hors du format attendu : ignorée')
    assert.equal(page.clientVersion, '2.20260925.08.00')
  })

  it('vidéos seulement : ni playlists suggérées, ni directs', () => {
    const videos = videosIn([
      lockup('PLxA687tYuMWjwLHZv1RP_4uw7OFRk443S', 'PLAYLIST', 'Autre playlist', '40 vidéos'),
      videoRenderer('jfKfPfyJRdk', 'lofi hip hop radio', { lengthText: undefined, badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }] }),
      videoRenderer('mGgMZpGYiy8', "The Cure - Friday I'm In Love"),
    ])
    assert.deepEqual(videos.map((video) => video.id), ['mGgMZpGYiy8'])
  })
})

describe('YouTube Data API', () => {
  it('décode les titres échappés et ignore les entrées incomplètes', () => {
    assert.equal(decodeEntities('Rock &amp; Roll &#39;n&#x27; &quot;Soul&quot;'), `Rock & Roll 'n' "Soul"`)
    const results = parseDataApiResponse(
      {
        items: [
          {
            id: { videoId: 'mGgMZpGYiy8' },
            snippet: {
              title: 'Friday I&#39;m In Love',
              channelTitle: 'The Cure',
              liveBroadcastContent: 'none',
              thumbnails: { medium: { url: 'https://i.ytimg.com/vi/mGgMZpGYiy8/mqdefault.jpg' } },
            },
          },
          { id: { videoId: 'sans-titre' }, snippet: {} },
          { id: { channelId: 'UC123' }, snippet: { title: 'Chaîne' } },
        ],
      },
      'video',
    )
    assert.deepEqual(results.map((result) => [result.id, result.title, result.live]), [['mGgMZpGYiy8', "Friday I'm In Love", false]])
  })
})

/* ---- Route --------------------------------------------------------------------- */

mockedHosts.add('www.youtube.com')
mockedHosts.add('www.googleapis.com')
extraMocks.push((url) => {
  if (url.hostname === 'www.googleapis.com' && !url.pathname.endsWith('/search')) {
    // Playlists : quota épuisé, l'import se replie sur la page publique.
    return new Response('{"error":{"code":403}}', { status: 403 })
  }
  if (url.hostname === 'www.googleapis.com') {
    // Quota épuisé pour « the cure » : repli sur la page ; réponse normale sinon.
    if (url.searchParams.get('q')?.toLowerCase() === 'the cure') return new Response('{"error":{"code":403}}', { status: 403 })
    return Response.json({
      items: [{ id: { videoId: 'kmNdoEjqiHs' }, snippet: { title: 'Boys Don&#39;t Cry', channelTitle: 'The Cure' } }],
    })
  }
  if (url.hostname === 'www.youtube.com' && url.pathname === '/results') return new Response(RESULTS)
  if (url.hostname === 'www.youtube.com' && url.pathname === '/playlist') return new Response(PLAYLIST_PAGE)
  if (url.hostname === 'www.youtube.com' && url.pathname === '/youtubei/v1/browse') {
    // La suite : une vidéo de plus, puis des playlists suggérées (fin de l'import).
    return Response.json({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [lockup('ks_qOI0lzho', 'VIDEO', 'The Cure - Lovesong', '3:29'), { continuationItemViewModel: { continuationCommand: { token: 'suite-2' } } }] } }] })
  }
  return undefined
})

const { client, close } = await startServer()
after(close)

describe('GET /api/music/search', () => {
  beforeEach(() => {
    clearMusicSearchCache()
    upstreamCalls.length = 0
  })

  it('recherche trop courte : 400', async () => {
    const response = await client().request('GET', '/music/search?q=a')
    assert.equal(response.status, 400)
  })

  it('Data API d’abord, avec vidéos intégrables seulement', async () => {
    const response = await client().request('GET', '/music/search?q=boys%20dont%20cry&lang=fr')
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.results.map((result: { title: string }) => result.title), ["Boys Don't Cry"])
    const call = upstreamCalls.find((entry) => entry.startsWith('www.googleapis.com'))
    assert.ok(call?.includes('videoEmbeddable=true'), call)
  })

  it('quota épuisé : repli sur youtube.com, puis réponse gardée en cache', async () => {
    const first = await client().request('GET', '/music/search?q=The%20%20Cure&type=playlist&lang=fr')
    assert.equal(first.status, 200)
    assert.deepEqual(first.body.results.map((result: { id: string }) => result.id), ['PLxA687tYuMWjwLHZv1RP_4uw7OFRk443S'])
    const page = upstreamCalls.find((entry) => entry.startsWith('www.youtube.com'))
    assert.ok(page?.includes('sp=EgIQAw'), page)

    const calls = upstreamCalls.length
    const again = await client().request('GET', '/music/search?q=the%20cure&type=playlist&lang=fr')
    assert.equal(again.status, 200)
    assert.equal(upstreamCalls.length, calls)
  })
})

describe('GET /api/music/playlist/:id', () => {
  beforeEach(() => clearPlaylistCache())

  it('API en échec → page publique : titre et vidéos, sans doublon ; mix automatique refusé (400)', async () => {
    const response = await client().request('GET', '/music/playlist/PLxA687tYuMWjwLHZv1RP_4uw7OFRk443S?lang=fr')
    assert.equal(response.status, 200)
    assert.equal(response.body.title, 'The Best of The Cure')
    assert.deepEqual(response.body.videos.map((video: { id: string }) => video.id), ['scif2vfg1ug', 'n3nPiBai66M', 'mGgMZpGYiy8'])
    assert.equal(response.body.truncated, false)
    assert.equal((await client().request('GET', '/music/playlist/RDEMLUGe1lzhB7MnQLLEheFTww')).status, 400)
  })
})
