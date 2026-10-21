import { config } from '../../core/config.js'
import { TtlCache } from '../../core/infra/cache.js'
import { BROWSER_UA, TIMEOUT_MS } from '../music/youtubeSearch.js'
import {
  QUERIES_PER_BATCH,
  editQueries,
  interleave,
  parseShortsPage,
  parseVideosList,
  searchIds,
  type EditQuery,
  type EditUniverse,
  type EditVideo,
} from './edits.logic.js'

/*
 * Fil « Edits » : chaque recherche YouTube est gardée 12 h (une recherche de l'API officielle
 * coûte 100 unités sur les 10 000 du jour), et les recherches ne partent qu'au fur et à mesure du
 * défilement, quatre par quatre. Avec `YOUTUBE_API_KEY` : l'API officielle (format vérifié,
 * vidéos intégrables seulement) ; sans clé, ou quota épuisé : la page de résultats publique.
 */

const cache = new TtlCache<EditVideo[]>({ maxEntries: 400, ttlMs: 12 * 60 * 60 * 1000 })

async function searchDataApi(query: EditQuery, key: string): Promise<EditVideo[]> {
  const search = new URL('https://www.googleapis.com/youtube/v3/search')
  search.searchParams.set('part', 'id')
  search.searchParams.set('type', 'video')
  search.searchParams.set('q', query.q)
  search.searchParams.set('videoDuration', 'short')
  search.searchParams.set('videoEmbeddable', 'true')
  search.searchParams.set('safeSearch', 'moderate')
  search.searchParams.set('maxResults', '25')
  search.searchParams.set('key', key)
  const found = await fetch(search, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!found.ok) throw new Error(`search ${found.status}`)
  const ids = searchIds(await found.json())
  if (ids.length === 0) return []
  // Détails (1 unité) : durée, et dimensions du lecteur pour ne garder que le vertical.
  const details = new URL('https://www.googleapis.com/youtube/v3/videos')
  details.searchParams.set('part', 'snippet,contentDetails,player')
  details.searchParams.set('id', ids.join(','))
  details.searchParams.set('maxHeight', '640')
  details.searchParams.set('key', key)
  const response = await fetch(details, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`videos ${response.status}`)
  return parseVideosList(await response.json(), query.universe)
}

async function searchResultsPage(query: EditQuery): Promise<EditVideo[]> {
  const url = new URL('https://www.youtube.com/results')
  url.searchParams.set('search_query', query.q)
  const response = await fetch(url, {
    // Consentement aux cookies déjà « refusé » : pas de redirection vers consent.youtube.com (UE).
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en;q=0.9', Cookie: 'SOCS=CAI' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`results ${response.status}`)
  return parseShortsPage(await response.text(), query.universe)
}

/** Une recherche, gardée en cache ; un échec vaut une liste vide (le fil continue avec les autres). */
function runQuery(query: EditQuery): Promise<EditVideo[]> {
  return cache.getOrLoad(
    query.q.toLowerCase(),
    async () => {
      const key = config.music.youtubeApiKey
      if (key) {
        try {
          return await searchDataApi(query, key)
        } catch (reason) {
          console.warn('[edits] YouTube Data API en échec, repli sur youtube.com :', reason instanceof Error ? reason.message : reason)
        }
      }
      try {
        return await searchResultsPage(query)
      } catch (reason) {
        console.warn('[edits] recherche impossible :', reason instanceof Error ? reason.message : reason)
        return []
      }
    },
    // Rien trouvé (blocage passager, page changée) : on retentera bientôt.
    (videos) => (videos.length > 0 ? 12 * 60 * 60 * 1000 : 5 * 60 * 1000),
  )
}

export interface EditsPage {
  items: EditVideo[]
  /** Position de la page suivante ; `null` : tout a été vu. */
  next: number | null
}

/**
 * Une page du fil. Le fil d'une graine est toujours assemblé de la même façon (lots de
 * recherches mêlés à tour de rôle, sans doublon) : `offset` désigne la même vidéo d'une page à
 * l'autre. Les lots ne sont cherchés que lorsque le défilement les atteint.
 */
export async function editsPage(options: { universe: EditUniverse | null; seed: string; offset: number; limit: number }): Promise<EditsPage> {
  const queries = editQueries(options.universe, options.seed)
  const wanted = options.offset + options.limit
  const seen = new Set<string>()
  const pool: EditVideo[] = []
  let loaded = 0
  while (loaded < queries.length && pool.length < wanted) {
    const batch = queries.slice(loaded, loaded + QUERIES_PER_BATCH)
    loaded += batch.length
    pool.push(...interleave(await Promise.all(batch.map(runQuery)), seen))
  }
  const items = pool.slice(options.offset, wanted)
  const exhausted = loaded >= queries.length && wanted >= pool.length
  return { items, next: exhausted ? null : options.offset + items.length }
}

/** Tests : oublie les recherches gardées. */
export const clearEditsCache = () => cache.clear()
