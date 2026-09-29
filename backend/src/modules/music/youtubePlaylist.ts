import { config } from '../../config.js'
import { TtlCache } from '../../lib/cache.js'
import { HttpError, notFound, upstreamError } from '../../lib/errors.js'
import type { Language } from '../../lib/language.js'
import {
  BROWSER_UA,
  REGION,
  TIMEOUT_MS,
  at,
  collect,
  decodeEntities,
  extractInitialData,
  fromLockup,
  fromVideoRenderer,
  isObject,
  text,
  type MusicSearchResult,
} from './youtubeSearch.js'

/**
 * Import d'une playlist YouTube : son titre et ses vidéos, pour en faire une
 * playlist d'ambiance de l'utilisateur (une vidéo = un morceau).
 *
 *  - avec `YOUTUBE_API_KEY` : Data API v3 (`playlists`, `playlistItems`, 50 par page) ;
 *  - sinon : la page publique de la playlist, puis ses pages suivantes
 *    (« continuations » de youtube.com).
 *
 * Bornée à `MAX_VIDEOS` (la taille maximale d'une playlist d'ambiance).
 */

export const MAX_VIDEOS = 200
/** Pages suivantes lues au plus (≈ 100 vidéos chacune côté youtube.com, 50 côté API). */
const MAX_PAGES = 5

export interface PlaylistVideo {
  id: string
  title: string
  channel: string | null
  duration: string | null
}

export interface ImportedPlaylist {
  id: string
  title: string
  channel: string | null
  videos: PlaylistVideo[]
  /** La playlist comptait plus de vidéos que la limite : seules les premières sont là. */
  truncated: boolean
}

/** Playlists importables : pas les mix automatiques (`RD…`), propres à chaque visiteur. */
export const IMPORTABLE_PLAYLIST = /^(PL|OL|UU|LL|FL)[\w-]{10,64}$/

const cache = new TtlCache<ImportedPlaylist>({ maxEntries: 100, ttlMs: 30 * 60 * 1000 })

const toVideo = (result: MusicSearchResult | null): PlaylistVideo | null =>
  result && result.kind === 'video' && !result.live
    ? { id: result.id, title: result.title, channel: result.channel, duration: result.duration }
    : null

/** Vidéos d'un fragment de page (ancien et nouveau format), dans l'ordre du document. */
export function videosIn(node: unknown): PlaylistVideo[] {
  const videos: PlaylistVideo[] = []
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!isObject(value)) return
    for (const [name, child] of Object.entries(value)) {
      if (name === 'lockupViewModel') {
        const video = toVideo(fromLockup(child))
        if (video) videos.push(video)
      } else if (name === 'playlistVideoRenderer' || name === 'videoRenderer') {
        const video = toVideo(fromVideoRenderer(child))
        if (video) videos.push(video)
      } else walk(child)
    }
  }
  walk(node)
  return videos
}

/** Jeton de la page suivante, s'il y en a une. */
const continuationOf = (node: unknown): string | null => {
  const commands = collect(node, 'continuationCommand')
  for (const command of commands) {
    const token = text(at(command, 'token'))
    if (token) return token
  }
  return null
}

/** Page publique d'une playlist → titre, vidéos, jeton de la suite et réglages pour la demander. */
export function parsePlaylistPage(html: string): {
  title: string | null
  channel: string | null
  videos: PlaylistVideo[]
  continuation: string | null
  apiKey: string | null
  clientVersion: string | null
} {
  const data = extractInitialData(html)
  const contents = at(data, 'contents')
  return {
    title: text(at(data, 'metadata', 'playlistMetadataRenderer', 'title')) ?? text(at(data, 'header', 'pageHeaderRenderer', 'pageTitle')),
    channel:
      text(at(data, 'header', 'pageHeaderRenderer', 'content', 'pageHeaderViewModel', 'metadata', 'contentMetadataViewModel', 'metadataRows', 0, 'metadataParts', 0, 'avatarStack', 'avatarStackViewModel', 'text', 'content'))
        ?.replace(/^(par|de|by)\s+/i, '') ?? null,
    videos: videosIn(contents),
    continuation: continuationOf(contents),
    apiKey: html.match(/"INNERTUBE_API_KEY":"([\w-]+)"/)?.[1] ?? null,
    clientVersion: html.match(/"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/)?.[1] ?? null,
  }
}

/** Sans doublon (une vidéo présente deux fois n'est qu'un morceau), bornée. */
function finish(id: string, title: string, channel: string | null, all: PlaylistVideo[]): ImportedPlaylist {
  const seen = new Set<string>()
  const videos = all.filter((video) => !seen.has(video.id) && seen.add(video.id))
  return { id, title, channel, videos: videos.slice(0, MAX_VIDEOS), truncated: videos.length > MAX_VIDEOS }
}

async function fromPublicPage(id: string, lang: Language): Promise<ImportedPlaylist> {
  const url = new URL('https://www.youtube.com/playlist')
  url.searchParams.set('list', id)
  url.searchParams.set('hl', lang)
  url.searchParams.set('gl', REGION[lang])
  const headers = { 'User-Agent': BROWSER_UA, 'Accept-Language': `${lang};q=0.9`, Cookie: 'SOCS=CAI' }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw upstreamError('YouTube ne répond pas.')
  const page = parsePlaylistPage(await response.text())
  if (!page.title && page.videos.length === 0) throw notFound('Playlist introuvable ou privée.')

  const videos = [...page.videos]
  let token = page.continuation
  for (let round = 0; token && page.apiKey && round < MAX_PAGES && videos.length < MAX_VIDEOS; round += 1) {
    const next = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${page.apiKey}&prettyPrint=false`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: page.clientVersion ?? '2.20250101.00.00', hl: lang, gl: REGION[lang] } },
        continuation: token,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // Suite indisponible : on garde ce qui est déjà lu.
    if (!next.ok) break
    const body: unknown = await next.json()
    const items = collect(body, 'continuationItems')
    const more = videosIn(items)
    // Au-delà des vidéos, la suite ne propose que d'autres playlists : c'est fini.
    if (more.length === 0) break
    videos.push(...more)
    token = continuationOf(items)
  }
  return finish(id, page.title ?? id, page.channel, videos)
}

async function fromDataApi(id: string, key: string): Promise<ImportedPlaylist> {
  const get = async (path: string, params: Record<string, string>) => {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)
    for (const [name, value] of Object.entries({ ...params, key })) url.searchParams.set(name, value)
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw upstreamError('YouTube Data API indisponible.')
    return (await response.json()) as unknown
  }
  const meta = await get('playlists', { part: 'snippet', id })
  const snippet = at(meta, 'items', 0, 'snippet')
  if (!snippet) throw notFound('Playlist introuvable ou privée.')

  const videos: PlaylistVideo[] = []
  let pageToken: string | null = null
  for (let round = 0; round <= MAX_PAGES && videos.length < MAX_VIDEOS; round += 1) {
    const page = await get('playlistItems', { part: 'snippet', playlistId: id, maxResults: '50', ...(pageToken && { pageToken }) })
    const items = at(page, 'items')
    for (const item of Array.isArray(items) ? items : []) {
      const videoId = text(at(item, 'snippet', 'resourceId', 'videoId'))
      const title = text(at(item, 'snippet', 'title'))
      // Vidéos supprimées ou privées : restent dans la playlist, sans titre ni chaîne.
      if (!videoId || !title || !text(at(item, 'snippet', 'videoOwnerChannelTitle'))) continue
      videos.push({ id: videoId, title: decodeEntities(title), channel: text(at(item, 'snippet', 'videoOwnerChannelTitle')), duration: null })
    }
    pageToken = text(at(page, 'nextPageToken'))
    if (!pageToken) break
  }
  const title = text(at(snippet, 'title'))
  return finish(id, title ? decodeEntities(title) : id, text(at(snippet, 'channelTitle')), videos)
}

export async function importYouTubePlaylist(id: string, lang: Language): Promise<ImportedPlaylist> {
  if (!config.music.search) throw new HttpError(503, 'music_search_disabled', 'Recherche YouTube désactivée.')
  return cache.getOrLoad(`${lang}:${id}`, async () => {
    const key = config.music.youtubeApiKey
    if (key) {
      try {
        return await fromDataApi(id, key)
      } catch (reason) {
        if (reason instanceof HttpError && reason.status === 404) throw reason
        console.warn('[music] YouTube Data API en échec pour une playlist, repli sur youtube.com :', reason instanceof Error ? reason.message : reason)
      }
    }
    try {
      return await fromPublicPage(id, lang)
    } catch (reason) {
      if (reason instanceof HttpError) throw reason
      throw upstreamError('YouTube ne répond pas.')
    }
  })
}

/** Tests : oublie les playlists gardées. */
export const clearPlaylistCache = () => cache.clear()
