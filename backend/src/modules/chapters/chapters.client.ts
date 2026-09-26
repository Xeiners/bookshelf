import { config } from '../../config.js'
import { mangadexGet, type MdCollection, type MdRelationship } from '../manga/mangadex.client.js'

/* ---- Types de réponse (sous-ensemble utilisé) --------------------------- */

export interface MdChapter {
  id: string
  attributes: {
    volume: string | null
    chapter: string | null
    title: string | null
    translatedLanguage: string
    /** Chapitre hébergé ailleurs (MANGA Plus…) : aucune page sur MangaDex. */
    externalUrl: string | null
    pages: number
    publishAt: string
    readableAt?: string
  }
  relationships: MdRelationship[]
}

/** Réponse de `/at-home/server/:chapterId` : un nœud MD@Home et la liste des fichiers. */
export interface MdAtHome {
  result: 'ok' | 'error'
  baseUrl: string
  chapter: {
    hash: string
    data: string[]
    dataSaver: string[]
  }
}

/** `/manga/:id/feed` plafonne `limit` à 500 et `offset + limit` à 10 000. */
const FEED_PAGE = 500
const FEED_MAX_PAGES = 10

/**
 * Tous les chapitres lisibles d'une œuvre, dans les langues demandées.
 * Les chapitres externes, vides ou pas encore publiés sont exclus par MangaDex
 * lui-même : il ne reste que ce que le lecteur peut réellement afficher.
 */
export async function fetchChapterFeed(mangaId: string, languages: readonly string[]): Promise<MdChapter[]> {
  const chapters: MdChapter[] = []
  for (let page = 0; page < FEED_MAX_PAGES; page += 1) {
    const payload = await mangadexGet<MdCollection<MdChapter>>(`/manga/${mangaId}/feed`, {
      'translatedLanguage': languages,
      'includes': ['scanlation_group'],
      'contentRating': ['safe', 'suggestive', 'erotica'],
      'includeExternalUrl': 0,
      'includeEmptyPages': 0,
      'includeFuturePublishAt': 0,
      'order[volume]': 'asc',
      'order[chapter]': 'asc',
      'limit': FEED_PAGE,
      'offset': page * FEED_PAGE,
    })
    chapters.push(...payload.data)
    if ((page + 1) * FEED_PAGE >= payload.total || payload.data.length === 0) break
  }
  return chapters
}

/** Nœud MD@Home pour un chapitre. Limité à 40 appels/min par IP côté MangaDex : à mettre en cache. */
export function fetchAtHome(chapterId: string): Promise<MdAtHome> {
  return mangadexGet<MdAtHome>(`/at-home/server/${chapterId}`)
}

const IMAGE_TIMEOUT_MS = 15_000
/** Une page de scan dépasse rarement 3 Mo ; au-delà, c'est anormal. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export interface FetchedImage {
  body: Buffer
  contentType: string
}

/**
 * Télécharge une page depuis un nœud MD@Home, et rend compte du résultat à
 * MangaDex comme l'exigent ses conditions d'utilisation (sauf pour leur propre
 * serveur `uploads.mangadex.org`, qui n'a pas besoin de rapport).
 * Renvoie `null` en cas d'échec : l'appelant choisit le repli.
 */
export async function fetchPageImage(url: string): Promise<FetchedImage | null> {
  const started = Date.now()
  let response: Response | undefined
  let body: Buffer | undefined
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': config.mangadexUserAgent },
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    })
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength > 0 && buffer.byteLength <= MAX_IMAGE_BYTES) body = buffer
    }
  } catch {
    // Réseau, délai dépassé : `body` reste vide, le rapport part en échec.
  }

  reportAtHome(url, {
    success: body !== undefined,
    bytes: body?.byteLength ?? 0,
    duration: Date.now() - started,
    cached: response?.headers.get('x-cache')?.startsWith('HIT') ?? false,
  })

  if (!body || !response) return null
  return { body, contentType: response.headers.get('content-type') ?? 'image/jpeg' }
}

const REPORT_URL = 'https://api.mangadex.network/report'

/** Rapport MD@Home, sans attendre ni échouer : il ne doit jamais retarder la page. */
function reportAtHome(url: string, result: { success: boolean; bytes: number; duration: number; cached: boolean }) {
  if (new URL(url).hostname === 'uploads.mangadex.org') return
  void fetch(REPORT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': config.mangadexUserAgent },
    body: JSON.stringify({ url, ...result }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {})
}
