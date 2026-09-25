import { config } from '../../config.js'
import { notFound, upstreamError } from '../../lib/errors.js'

export const MANGADEX_API = 'https://api.mangadex.org'
export const MANGADEX_UPLOADS = 'https://uploads.mangadex.org'

/**
 * MangaDex tolère environ 5 requêtes/s par IP. Les appels sortants sont
 * espacés d'au moins `MIN_SPACING_MS` : un burst de préchargement côté front ne
 * peut pas nous faire bannir. Le cache en amont absorbe l'essentiel du trafic.
 */
const MIN_SPACING_MS = 220
const TIMEOUT_MS = 10_000

let nextSlot = 0

async function throttle(): Promise<void> {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + MIN_SPACING_MS
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now))
}

type QueryValue = string | number | boolean | undefined | readonly (string | number)[]

/** Sérialise au format attendu par MangaDex : `key[]=a&key[]=b`, `order[x]=desc`. */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) search.append(`${key}[]`, String(item))
    } else {
      search.append(key, String(value))
    }
  }
  return search.toString()
}

/** GET JSON sur l'API MangaDex, limité en débit et borné dans le temps. */
export async function mangadexGet<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  await throttle()

  const query = buildQuery(params)
  const url = `${MANGADEX_API}${path}${query ? `?${query}` : ''}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': config.mangadexUserAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw upstreamError('MangaDex est injoignable.')
  }

  if (response.status === 404) {
    throw notFound('Titre introuvable sur MangaDex.')
  }
  if (!response.ok) throw upstreamError(`MangaDex a répondu ${response.status}.`)

  return (await response.json()) as T
}

/** Téléchargement brut d'une couverture (pas de throttle : CDN distinct). */
export async function fetchCoverImage(mangaId: string, fileName: string, size: 256 | 512) {
  const url = `${MANGADEX_UPLOADS}/covers/${mangaId}/${fileName}.${size}.jpg`
  return fetch(url, {
    headers: { 'User-Agent': config.mangadexUserAgent },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

/* ---- Types de réponse (sous-ensemble utilisé) --------------------------- */

export type LocalizedString = Record<string, string | undefined>

export interface MdRelationship {
  id: string
  type: string
  attributes?: {
    name?: string
    fileName?: string
  }
}

export interface MdTag {
  id: string
  attributes: {
    name: LocalizedString
    group: 'genre' | 'theme' | 'format' | 'content'
  }
}

export interface MdManga {
  id: string
  attributes: {
    title: LocalizedString
    altTitles: LocalizedString[]
    description: LocalizedString
    originalLanguage: string
    lastChapter: string | null
    status: 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | null
    year: number | null
    contentRating: string
    tags: MdTag[]
    availableTranslatedLanguages: (string | null)[]
    /** Liens externes ; 'al' = id AniList (clé de jointure du catalogue agrégé). */
    links?: Record<string, string | undefined> | null
  }
  relationships: MdRelationship[]
}

export interface MdCollection<T> {
  result: 'ok' | 'error'
  data: T[]
  total: number
}

export interface MdEntity<T> {
  result: 'ok' | 'error'
  data: T
}

export interface MdStatistics {
  statistics: Record<string, { follows?: number; rating?: { bayesian?: number | null } } | undefined>
}
