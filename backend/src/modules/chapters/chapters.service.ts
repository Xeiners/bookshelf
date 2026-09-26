import { config } from '../../config.js'
import { TtlCache } from '../../lib/cache.js'
import { notFound, upstreamError } from '../../lib/errors.js'
import type { Language } from '../../lib/language.js'
import { READABLE_LANGUAGES } from '../manga/normalize.js'
import {
  fetchAtHome,
  fetchChapterFeed,
  fetchPageImage,
  type FetchedImage,
  type MdAtHome,
} from './chapters.client.js'
import { compareChapters, normalizeChapter, type ReaderChapter } from './chapters.normalize.js'

export type { ReaderChapter }

const MINUTE = 60 * 1000

/** Qualité d'image MangaDex : originale, ou compressée (« Data Saver »). */
export type Quality = 'data' | 'data-saver'

export interface ChapterList {
  mangaId: string
  /** Langue réellement servie : celle demandée, ou l'autre si elle n'a aucun chapitre. */
  language: Language
  /** Nombre de chapitres par langue, pour proposer la bascule FR ↔ EN. */
  available: Record<Language, number>
  chapters: ReaderChapter[]
}

/** Flux brut, indépendant de la langue demandée (fr + en en une fois) : bascule FR ↔ EN gratuite. */
const feedCache = new TtlCache<ReaderChapter[]>({ maxEntries: 300, ttlMs: 10 * MINUTE })

export async function listChapters(mangaId: string, language: Language): Promise<ChapterList> {
  const all = await feedCache.getOrLoad(mangaId, async () =>
    (await fetchChapterFeed(mangaId, READABLE_LANGUAGES)).map(normalizeChapter).sort(compareChapters),
  )

  const available: Record<Language, number> = { fr: 0, en: 0 }
  for (const chapter of all) available[chapter.language] += 1

  const other: Language = language === 'fr' ? 'en' : 'fr'
  const served = available[language] > 0 || available[other] === 0 ? language : other
  return { mangaId, language: served, available, chapters: all.filter((chapter) => chapter.language === served) }
}

/* ---- Pages (MangaDex At-Home) --------------------------------------------- */

/**
 * Nœud MD@Home par chapitre. Son URL reste valable ~15 min ; on la garde 10 min,
 * et on l'oublie dès qu'une image échoue (le nœud peut être tombé). Le cache
 * protège surtout la limite de 40 appels/min par IP, partagée par tous nos lecteurs.
 */
const atHomeCache = new TtlCache<MdAtHome>({ maxEntries: 500, ttlMs: 10 * MINUTE })

const atHome = (chapterId: string) => atHomeCache.getOrLoad(chapterId, () => fetchAtHome(chapterId))

const filesOf = (server: MdAtHome, quality: Quality) =>
  quality === 'data' ? server.chapter.data : server.chapter.dataSaver

export interface ChapterPage {
  index: number
  /** Image via notre relais (même origine : cache du Service Worker, pas de hotlinking). */
  url: string
  /** Même page en « Data Saver » : repli du front si l'originale échoue. */
  fallbackUrl: string | null
}

const imagePath = (chapterId: string, quality: Quality, file: string) =>
  `${config.publicApiBase}/chapters/${chapterId}/image/${quality}/${encodeURIComponent(file)}`

export async function listPages(chapterId: string, quality: Quality): Promise<ChapterPage[]> {
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
