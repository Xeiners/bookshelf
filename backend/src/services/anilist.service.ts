import { config } from '../config.js'
import { upstreamError } from '../lib/errors.js'

/**
 * Client GraphQL AniList : la source des métadonnées riches du catalogue
 * (genres, tags pondérés, note moyenne, popularité, pays d'origine).
 *
 * AniList limite à ~30-90 requêtes/min selon sa charge : les appels sont
 * espacés d'au moins `MIN_SPACING_MS`, et un 429 est réessayé une fois après
 * le délai indiqué par `Retry-After`. Ce client n'est jamais appelé pendant un
 * swipe : seul l'indexeur du catalogue s'en sert, en tâche de fond.
 */
export const ANILIST_API = 'https://graphql.anilist.co'

const MIN_SPACING_MS = 2100
const TIMEOUT_MS = 12_000
const MAX_RETRY_AFTER_S = 65

/** Taille de page maximale acceptée par AniList. */
export const ANILIST_PAGE_SIZE = 50

let nextSlot = 0

async function throttle(): Promise<void> {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + MIN_SPACING_MS
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now))
}

/* ---- Types (sous-ensemble utilisé) --------------------------------------- */

export type AlCountry = 'JP' | 'KR' | 'CN' | 'TW'
export type AlFormat = 'MANGA' | 'ONE_SHOT' | 'NOVEL'
export type AlStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS'
export type AlSort = 'POPULARITY_DESC' | 'SCORE_DESC' | 'TRENDING_DESC'

export interface AlTag {
  name: string
  /** Pertinence du tag pour l'œuvre, en %. */
  rank: number
  isMediaSpoiler: boolean
  isAdult: boolean
}

export interface AlMedia {
  id: number
  title: { romaji: string | null; english: string | null; native: string | null }
  countryOfOrigin: AlCountry | string
  format: AlFormat | string | null
  status: AlStatus | null
  chapters: number | null
  meanScore: number | null
  popularity: number | null
  isAdult: boolean
  genres: string[]
  tags: AlTag[]
  description: string | null
  coverImage: { extraLarge: string | null; large: string | null; color: string | null }
  startDate: { year: number | null }
  siteUrl: string
  staff: { edges: { role: string; node: { name: { full: string | null } } }[] }
}

interface GraphQlResponse<T> {
  data?: T
  errors?: { message: string; status?: number }[]
}

interface PageData {
  Page: {
    pageInfo: { hasNextPage: boolean }
    media: AlMedia[]
  }
}

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  countryOfOrigin
  format
  status
  chapters
  meanScore
  popularity
  isAdult
  genres
  tags { name rank isMediaSpoiler isAdult }
  description(asHtml: false)
  coverImage { extraLarge large color }
  startDate { year }
  siteUrl
  staff(perPage: 4, sort: [RELEVANCE]) { edges { role node { name { full } } } }
`

const PAGE_QUERY = `
  query CatalogPage(
    $page: Int, $perPage: Int, $sort: [MediaSort], $country: CountryCode,
    $genre: String, $minScore: Int, $ids: [Int]
  ) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(
        type: MANGA, isAdult: false, format_in: [MANGA, ONE_SHOT], sort: $sort,
        countryOfOrigin: $country, genre: $genre, averageScore_greater: $minScore, id_in: $ids
      ) { ${MEDIA_FIELDS} }
    }
  }
`

/* ---- Transport ------------------------------------------------------------ */

async function anilistQuery<T>(query: string, variables: Record<string, unknown>, retried = false): Promise<T> {
  await throttle()

  let response: Response
  try {
    response = await fetch(ANILIST_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': config.mangadexUserAgent,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw upstreamError('AniList est injoignable.')
  }

  if (response.status === 429 && !retried) {
    const wait = Math.min(Number(response.headers.get('retry-after')) || 30, MAX_RETRY_AFTER_S)
    // Tout le monde attend : la fenêtre de débit est partagée par l'IP.
    nextSlot = Math.max(nextSlot, Date.now() + wait * 1000)
    return anilistQuery<T>(query, variables, true)
  }
  if (!response.ok) throw upstreamError(`AniList a répondu ${response.status}.`)

  const payload = (await response.json()) as GraphQlResponse<T>
  if (!payload.data) throw upstreamError(payload.errors?.[0]?.message ?? 'Réponse AniList vide.')
  return payload.data
}

/* ---- Requêtes -------------------------------------------------------------- */

export interface MediaPageOptions {
  page: number
  perPage?: number
  sort?: AlSort
  country?: AlCountry
  genre?: string
  /** Note moyenne minimale, sur 100 (exclusive). */
  minScore?: number
}

export interface MediaPage {
  media: AlMedia[]
  hasNextPage: boolean
}

/** Une page du catalogue manga AniList (hors contenu adulte, formats MANGA / ONE_SHOT). */
export async function fetchMediaPage(options: MediaPageOptions): Promise<MediaPage> {
  const data = await anilistQuery<PageData>(PAGE_QUERY, {
    page: options.page,
    perPage: options.perPage ?? ANILIST_PAGE_SIZE,
    sort: [options.sort ?? 'POPULARITY_DESC'],
    country: options.country,
    genre: options.genre,
    minScore: options.minScore,
  })
  return { media: data.Page.media, hasNextPage: data.Page.pageInfo.hasNextPage }
}

/** Fiches AniList par identifiants (50 par requête), pour les œuvres découvertes via MangaDex. */
export async function fetchMediaByIds(ids: number[]): Promise<AlMedia[]> {
  const result: AlMedia[] = []
  for (let start = 0; start < ids.length; start += ANILIST_PAGE_SIZE) {
    const batch = ids.slice(start, start + ANILIST_PAGE_SIZE)
    const data = await anilistQuery<PageData>(PAGE_QUERY, { page: 1, perPage: batch.length, ids: batch })
    result.push(...data.Page.media)
  }
  return result
}
