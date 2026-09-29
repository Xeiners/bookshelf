import { config } from '../../config.js'
import { TtlCache } from '../../lib/cache.js'
import { HttpError, upstreamError } from '../../lib/errors.js'
import type { Language } from '../../lib/language.js'

/**
 * Recherche YouTube pour la musique d'ambiance : vidéos ou playlists à
 * ajouter aux playlists de l'utilisateur.
 *
 *  - avec `YOUTUBE_API_KEY` : YouTube Data API v3 (officielle, vidéos
 *    intégrables seulement) ;
 *  - sans clé, ou quota épuisé : page de résultats publique de youtube.com,
 *    dont on lit le JSON embarqué (`ytInitialData`).
 *
 * Résultats gardés 30 min : la même recherche tapée par dix personnes ne part
 * qu'une fois.
 */

export type MusicSearchType = 'video' | 'playlist'

export interface MusicSearchResult {
  kind: MusicSearchType
  /** Identifiant YouTube (vidéo ou `list=`). */
  id: string
  title: string
  channel: string | null
  /** Durée affichée (« 3:27 »), vidéos hors direct seulement. */
  duration: string | null
  live: boolean
  /** Nombre de vidéos d'une playlist, tel que YouTube l'affiche (« 30 vidéos »). */
  videoCount: string | null
  thumbnail: string | null
}

const MAX_RESULTS = 15
export const TIMEOUT_MS = 8000
const cache = new TtlCache<MusicSearchResult[]>({ maxEntries: 300, ttlMs: 30 * 60 * 1000 })

export const REGION: Record<Language, string> = { fr: 'FR', en: 'US' }
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
/** Filtre « Playlists » de la page de résultats. */
const PLAYLIST_FILTER = 'EgIQAw=='

/** Mix automatiques (`RD…`) : non chargeables comme playlists par le lecteur intégré. */
const isMix = (id: string) => id.startsWith('RD')

const videoThumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`

/* ---- Page de résultats (sans clé) ---------------------------------------------- */

type Json = Record<string, unknown>
export const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
export const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** Chemin de propriétés dans un objet JSON quelconque ; `undefined` dès qu'un maillon manque. */
export function at(node: unknown, ...path: (string | number)[]): unknown {
  let current = node
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') current = current[key]
    else if (isObject(current) && typeof key === 'string') current = current[key]
    else return undefined
  }
  return current
}

/** Toutes les valeurs d'une clé, à n'importe quelle profondeur, dans l'ordre du document. */
export function collect(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, key, out)
  } else if (isObject(node)) {
    for (const [name, value] of Object.entries(node)) {
      if (name === key) out.push(value)
      collect(value, key, out)
    }
  }
  return out
}

/** Le JSON d'état que youtube.com embarque dans sa page (`var ytInitialData = {…};`). */
export function extractInitialData(html: string): unknown {
  const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1]) as unknown
  } catch {
    return null
  }
}

/** Ancien format de résultat vidéo (`videoRenderer`). */
export function fromVideoRenderer(renderer: unknown): MusicSearchResult | null {
  const id = text(at(renderer, 'videoId'))
  const title = text(at(renderer, 'title', 'runs', 0, 'text')) ?? text(at(renderer, 'title', 'simpleText'))
  if (!id || !title) return null
  const styles = [
    ...collect(at(renderer, 'badges'), 'style'),
    ...collect(at(renderer, 'thumbnailOverlays'), 'style'),
  ].filter((style): style is string => typeof style === 'string')
  const duration = text(at(renderer, 'lengthText', 'simpleText'))
  return {
    kind: 'video',
    id,
    title,
    channel: text(at(renderer, 'ownerText', 'runs', 0, 'text')) ?? text(at(renderer, 'longBylineText', 'runs', 0, 'text')),
    duration,
    live: styles.some((style) => style.includes('LIVE')),
    videoCount: null,
    thumbnail: videoThumbnail(id),
  }
}

/** Nouveau format (`lockupViewModel`) : playlists, et certaines vidéos. */
export function fromLockup(lockup: unknown): MusicSearchResult | null {
  const id = text(at(lockup, 'contentId'))
  const type = at(lockup, 'contentType')
  const title = text(at(lockup, 'metadata', 'lockupMetadataViewModel', 'title', 'content'))
  if (!id || !title) return null
  const kind: MusicSearchType | null =
    type === 'LOCKUP_CONTENT_TYPE_PLAYLIST' ? 'playlist' : type === 'LOCKUP_CONTENT_TYPE_VIDEO' ? 'video' : null
  if (!kind) return null
  const channel = text(
    at(lockup, 'metadata', 'lockupMetadataViewModel', 'metadata', 'contentMetadataViewModel', 'metadataRows', 0, 'metadataParts', 0, 'text', 'content'),
  )
  const badges = collect(at(lockup, 'contentImage'), 'thumbnailBadgeViewModel').filter(isObject)
  const badge = badges.map((entry) => text(entry.text)).find((value) => value !== null) ?? null
  const live = badges.some((entry) => typeof entry.badgeStyle === 'string' && entry.badgeStyle.includes('LIVE'))
  const source = collect(at(lockup, 'contentImage'), 'sources').flat().find((entry) => isObject(entry) && typeof entry.url === 'string')
  return {
    kind,
    id,
    title,
    channel,
    duration: kind === 'video' && !live ? badge : null,
    live,
    videoCount: kind === 'playlist' ? badge : null,
    thumbnail: kind === 'video' ? videoThumbnail(id) : isObject(source) ? String(source.url) : null,
  }
}

/**
 * Résultats d'une page youtube.com/results, dans l'ordre d'affichage, sans
 * doublon ni mix automatique, filtrés sur le type demandé.
 */
export function parseResultsPage(html: string, type: MusicSearchType): MusicSearchResult[] {
  const data = extractInitialData(html)
  if (!data) return []
  const results: MusicSearchResult[] = []
  const seen = new Set<string>()
  const add = (result: MusicSearchResult | null) => {
    if (!result || result.kind !== type || isMix(result.id) || seen.has(result.id)) return
    seen.add(result.id)
    results.push(result)
  }
  // Parcours unique, dans l'ordre du document : les deux formats y sont mêlés.
  const walk = (node: unknown) => {
    if (results.length >= MAX_RESULTS) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!isObject(node)) return
    for (const [name, value] of Object.entries(node)) {
      if (name === 'videoRenderer') add(fromVideoRenderer(value))
      else if (name === 'lockupViewModel') add(fromLockup(value))
      else walk(value)
    }
  }
  walk(data)
  return results.slice(0, MAX_RESULTS)
}

async function searchResultsPage(query: string, type: MusicSearchType, lang: Language): Promise<MusicSearchResult[]> {
  const url = new URL('https://www.youtube.com/results')
  url.searchParams.set('search_query', query)
  url.searchParams.set('hl', lang)
  url.searchParams.set('gl', REGION[lang])
  if (type === 'playlist') url.searchParams.set('sp', PLAYLIST_FILTER)
  const response = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': `${lang};q=0.9`,
      // Consentement aux cookies déjà « refusé » : pas de redirection vers consent.youtube.com (UE).
      Cookie: 'SOCS=CAI',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw upstreamError('YouTube ne répond pas.')
  return parseResultsPage(await response.text(), type)
}

/* ---- YouTube Data API v3 (avec clé) ----------------------------------------------- */

/** Les titres de l'API arrivent échappés en HTML (`&amp;`, `&#39;`). */
export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function parseDataApiResponse(body: unknown, type: MusicSearchType): MusicSearchResult[] {
  const items = at(body, 'items')
  if (!Array.isArray(items)) return []
  const results: MusicSearchResult[] = []
  for (const item of items) {
    const id = text(type === 'video' ? at(item, 'id', 'videoId') : at(item, 'id', 'playlistId'))
    const title = text(at(item, 'snippet', 'title'))
    if (!id || !title || isMix(id)) continue
    const channel = text(at(item, 'snippet', 'channelTitle'))
    results.push({
      kind: type,
      id,
      title: decodeEntities(title),
      channel: channel ? decodeEntities(channel) : null,
      duration: null,
      live: at(item, 'snippet', 'liveBroadcastContent') === 'live',
      videoCount: null,
      thumbnail:
        text(at(item, 'snippet', 'thumbnails', 'medium', 'url')) ??
        text(at(item, 'snippet', 'thumbnails', 'default', 'url')) ??
        (type === 'video' ? videoThumbnail(id) : null),
    })
  }
  return results
}

async function searchDataApi(query: string, type: MusicSearchType, lang: Language, key: string): Promise<MusicSearchResult[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('type', type)
  url.searchParams.set('q', query)
  url.searchParams.set('maxResults', String(MAX_RESULTS))
  url.searchParams.set('relevanceLanguage', lang)
  url.searchParams.set('regionCode', REGION[lang])
  // Seules les vidéos intégrables se lisent dans le lecteur de l'application.
  if (type === 'video') url.searchParams.set('videoEmbeddable', 'true')
  url.searchParams.set('key', key)
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw upstreamError('YouTube Data API indisponible.')
  return parseDataApiResponse(await response.json(), type)
}

/* ---- Point d'entrée ------------------------------------------------------------- */

export async function searchYouTube(query: string, type: MusicSearchType, lang: Language): Promise<MusicSearchResult[]> {
  if (!config.music.search) throw new HttpError(503, 'music_search_disabled', 'Recherche YouTube désactivée.')
  const normalized = query.trim().replace(/\s+/g, ' ')
  const key = `${type}:${lang}:${normalized.toLowerCase()}`
  return cache.getOrLoad(
    key,
    async () => {
      const apiKey = config.music.youtubeApiKey
      if (apiKey) {
        try {
          return await searchDataApi(normalized, type, lang, apiKey)
        } catch (reason) {
          // Quota épuisé ou clé refusée : la page publique prend le relais.
          console.warn('[music] YouTube Data API en échec, repli sur youtube.com :', reason instanceof Error ? reason.message : reason)
        }
      }
      try {
        return await searchResultsPage(normalized, type, lang)
      } catch (reason) {
        if (reason instanceof HttpError) throw reason
        throw upstreamError('YouTube ne répond pas.')
      }
    },
    // Aucun résultat (page changée, blocage passager) : on retente vite.
    (results) => (results.length > 0 ? 30 * 60 * 1000 : 60 * 1000),
  )
}

/** Tests : oublie les recherches gardées. */
export const clearMusicSearchCache = () => cache.clear()
