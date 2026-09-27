/**
 * Briques communes aux sources qui cherchent une œuvre par titre (Consumet,
 * Komga, Kavita) et aux bibliothèques personnelles qui servent leurs images
 * elles-mêmes.
 */
import { TtlCache } from '../../lib/cache.js'
import { MAX_IMAGE_BYTES } from '../../modules/proxy/proxy.fetch.js'
import { bestTitleMatch, searchQueries } from '../titleMatch.js'
import type { FetchedImage, NormalizedPage } from '../types.js'
import type { ProviderLog } from './http.js'

const HOUR = 60 * 60 * 1000

/**
 * Œuvre MangaDex → série de la source. Essaie les requêtes multi-noms
 * (`searchQueries`), retient le résultat le plus proche (`bestTitleMatch`),
 * journalise chaque recherche. Une correspondance tient 6 h ; une absence
 * (`null`) 30 min seulement, pour réessayer vite.
 */
export function createSeriesResolver<T>(options: {
  search: (query: string) => Promise<T[]>
  titlesOf: (candidate: T) => string[]
  log: ProviderLog
}): (mangaId: string, titleAliases: string[]) => Promise<T | null> {
  const matches = new TtlCache<T | null>({ maxEntries: 1000, ttlMs: 6 * HOUR })

  const find = async (titleAliases: string[]): Promise<T | null> => {
    for (const query of searchQueries(titleAliases)) {
      const results = await options.search(query)
      const match = bestTitleMatch(results, titleAliases, options.titlesOf)
      if (match) {
        options.log(`Search query: "${query}" -> ${results.length} résultat(s), retenu « ${match.title} » (${Math.round(match.score * 100)} %)`)
        return match.candidate
      }
      options.log(`Search query: "${query}" -> ${results.length} résultat(s), aucun assez proche`)
    }
    options.log(`aucune correspondance pour « ${titleAliases[0] ?? '?'} » (${titleAliases.length} titre(s) connus)`)
    return null
  }

  return (mangaId, titleAliases) =>
    titleAliases.length === 0
      ? Promise.resolve(null)
      : matches.getOrLoad(mangaId, () => find(titleAliases), (found) => (found === null ? HOUR / 2 : 6 * HOUR))
}

/**
 * Téléchargement d'images restreint à UNE origine, celle configurée par
 * l'administrateur (bibliothèque sur le réseau local, derrière une
 * authentification). Aucune redirection suivie : elle pourrait sortir de
 * l'origine. Type image obligatoire, taille bornée.
 */
export function originImageFetcher(options: {
  baseUrl: string
  headers: () => Promise<Record<string, string>> | Record<string, string>
  userAgent: string
  /** Délai d'un téléchargement (ms), 20 s par défaut. */
  timeoutMs?: number
}): (page: NormalizedPage) => Promise<{ image: FetchedImage | null; reason?: string }> {
  const origin = new URL(options.baseUrl).origin
  return async (page) => {
    let url: URL
    try {
      url = new URL(page.url)
    } catch {
      return { image: null, reason: 'URL invalide' }
    }
    if (url.origin !== origin) return { image: null, reason: `origine ${url.origin} refusée (seule ${origin} est autorisée)` }
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': options.userAgent, Accept: 'image/*', ...(await options.headers()) },
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      })
      if (!response.ok) return { image: null, reason: `statut ${response.status}` }
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.startsWith('image/')) return { image: null, reason: `type ${contentType || 'absent'}` }
      if (Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) return { image: null, reason: 'image trop lourde' }
      const body = Buffer.from(await response.arrayBuffer())
      if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) return { image: null, reason: 'taille invalide' }
      return { image: { body, contentType } }
    } catch (error) {
      return { image: null, reason: error instanceof Error ? error.message : 'erreur réseau' }
    }
  }
}

/** Titre qui ne fait que répéter la numérotation (« Chapitre 3 », « Tome 03 », « 3 ») : sans intérêt. */
export const isNumberingOnly = (title: string) =>
  /^\s*(?:(?:ch(?:apter|apitre)?|t(?:ome)?|vol(?:ume)?|#)\.?\s*)?\d+(?:\.\d+)?\s*$/i.test(title)

const EPOCH = new Date(0).toISOString()

/**
 * Date d'une bibliothèque en ISO. Kavita et Komga renvoient des dates SANS
 * fuseau (`2024-03-01T00:00:00`, heure du serveur) : lues telles quelles, le
 * navigateur les prendrait pour l'heure locale. On les tient pour UTC. Les
 * dates par défaut de .NET (`0001-01-01`) valent « inconnue ».
 */
export function libraryDate(...candidates: (string | null | undefined)[]): string {
  for (const value of candidates) {
    if (!value || value.startsWith('0001-')) continue
    const zoned = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? `${value}Z` : value
    const time = Date.parse(zoned)
    if (!Number.isNaN(time)) return new Date(time).toISOString()
  }
  return EPOCH
}
