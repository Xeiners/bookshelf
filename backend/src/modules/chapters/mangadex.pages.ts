import { config } from '../../config.js'
import { TtlCache } from '../../lib/cache.js'
import { notFound, upstreamError } from '../../lib/errors.js'
import type { NormalizedPage, Quality } from '../../extensions/types.js'
import { fetchAtHome, fetchPageImage, type FetchedImage, type MdAtHome } from './chapters.client.js'

/* ---- Pages MangaDex (At-Home) ----------------------------------------------
 * Propres à MangaDex : nœuds MD@Home éphémères, rapport de téléchargement
 * obligatoire, repli « Data Saver ». Utilisées par la source MangaDex
 * (`extensions/providers/mangadex.provider.ts`) et par le relais d'images
 * `/api/chapters/:id/image/…`.
 */

const MINUTE = 60 * 1000

/**
 * Nœud MD@Home par chapitre. Son URL reste valable ~15 min ; on la garde 10 min,
 * et on l'oublie dès qu'une image échoue (le nœud peut être tombé). Le cache
 * protège surtout la limite de 40 appels/min par IP, partagée par tous nos lecteurs.
 */
const atHomeCache = new TtlCache<MdAtHome>({ maxEntries: 500, ttlMs: 10 * MINUTE })

const atHome = (chapterId: string) => atHomeCache.getOrLoad(chapterId, () => fetchAtHome(chapterId))

const filesOf = (server: MdAtHome, quality: Quality) =>
  quality === 'data' ? server.chapter.data : server.chapter.dataSaver

const imagePath = (chapterId: string, quality: Quality, file: string) =>
  `${config.publicApiBase}/chapters/${chapterId}/image/${quality}/${encodeURIComponent(file)}`

/** Pages d'un chapitre, via notre relais (même origine : cache du Service Worker, pas de hotlinking). */
export async function listPages(chapterId: string, quality: Quality): Promise<NormalizedPage[]> {
  const server = await atHome(chapterId)
  const files = filesOf(server, quality)
  if (files.length === 0) throw notFound('Ce chapitre n’a aucune page.')
  const saver = server.chapter.dataSaver
  return files.map((file, index) => ({
    index,
    url: imagePath(chapterId, quality, file),
    fallbackUrl: quality === 'data' && saver[index] ? imagePath(chapterId, 'data-saver', saver[index]) : null,
  }))
}

export interface PageImage extends FetchedImage {
  /** `true` si la version « Data Saver » a remplacé l'originale introuvable. */
  degraded: boolean
}

/**
 * Une page de chapitre, avec deux replis successifs :
 * 1. nœud en panne → on oublie le nœud, MangaDex en attribue un autre, on retente ;
 * 2. originale toujours indisponible → la même page en « Data Saver ».
 */
export async function loadPageImage(chapterId: string, quality: Quality, file: string): Promise<PageImage> {
  const locate = async (fresh: boolean) => {
    if (fresh) atHomeCache.delete(chapterId)
    const server = await atHome(chapterId)
    const index = filesOf(server, quality).indexOf(file)
    return { server, index }
  }

  let { server, index } = await locate(false)
  // Fichier inconnu : le chapitre a peut-être été remplacé depuis la mise en cache.
  if (index === -1) ({ server, index } = await locate(true))
  if (index === -1) throw notFound('Page introuvable dans ce chapitre.')

  const urlFor = (target: MdAtHome, targetQuality: Quality, targetFile: string) =>
    `${target.baseUrl}/${targetQuality}/${target.chapter.hash}/${targetFile}`

  const first = await fetchPageImage(urlFor(server, quality, file))
  if (first) return { ...first, degraded: false }

  const retry = await locate(true).catch(() => null)
  if (retry && retry.index !== -1) {
    const second = await fetchPageImage(urlFor(retry.server, quality, file))
    if (second) return { ...second, degraded: false }
  }

  const current = retry?.server ?? server
  const saverFile = quality === 'data' ? current.chapter.dataSaver[index] : undefined
  if (saverFile) {
    const degraded = await fetchPageImage(urlFor(current, 'data-saver', saverFile))
    if (degraded) return { ...degraded, degraded: true }
  }

  console.warn(`[chapters] ${chapterId}/${quality}/${file} : page indisponible sur MD@Home`)
  throw upstreamError('Page indisponible pour le moment.')
}
