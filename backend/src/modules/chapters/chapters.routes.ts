import { Router } from 'express'
import { z } from 'zod'
import { MAX_ALTERNATES } from '../../extensions/aggregator.js'
import { isChapterKey } from '../../extensions/chapterKey.js'
import { badRequest } from '../../lib/errors.js'
import { LangQuerySchema } from '../../lib/language.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { listChapters, listPages } from './chapters.service.js'
import { loadPageImage } from './mangadex.pages.js'
import { OFFICIAL_WORK_ID, officialPlatforms } from './official.service.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Nom de fichier MD@Home : `x1-<hash>.png`, `1-<hash>.jpg`… */
const PAGE_FILE = /^[\w-]{1,160}\.(?:jpe?g|png|webp|gif)$/i

const QualitySchema = z.enum(['data', 'data-saver'])
const PagesQuery = z.object({
  quality: QualitySchema.catch('data'),
  /** Versions du même chapitre chez d'autres sources, essayées si celle-ci échoue. */
  alt: z.string().max(4_000).optional().catch(undefined),
})

/**
 * Résoudre les pages d'un chapitre coûte un appel `/at-home/server`, limité par
 * MangaDex à 40/min pour TOUT notre serveur : un seul client ne doit pas
 * pouvoir l'épuiser. Large pour une lecture normale (un chapitre toutes les
 * quelques minutes, plus le préchargement du suivant).
 */
const pagesLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 })

/** Monté sous `/api/manga` : `GET /api/manga/:id/chapters?lang=fr|en`. */
export const mangaChaptersRouter = Router()

mangaChaptersRouter.get('/:id/chapters', async (req, res) => {
  const { id } = req.params
  if (!UUID.test(id)) throw badRequest('Identifiant MangaDex invalide.')
  const lang = LangQuerySchema.parse(req.query.lang)
  // Court : un nouveau chapitre doit apparaître vite, le cache serveur absorbe le reste.
  res.set('Cache-Control', 'public, max-age=300')
  res.json(await listChapters(id, lang))
})

/** `GET /api/manga/:id/platforms?lang=` : où lire l'œuvre officiellement. */
mangaChaptersRouter.get('/:id/platforms', async (req, res) => {
  const { id } = req.params
  if (!OFFICIAL_WORK_ID.test(id)) throw badRequest('Identifiant d’œuvre invalide.')
  const lang = LangQuerySchema.parse(req.query.lang)
  res.set('Cache-Control', 'public, max-age=3600')
  res.json({ platforms: await officialPlatforms(id, lang) })
})

/** Monté sous `/api/chapters`. */
export const chaptersRouter = Router()

chaptersRouter.get('/:chapterId/pages', pagesLimiter, async (req, res) => {
  // Avec un middleware devant, Express type les paramètres en `string | string[]`.
  const chapterId = String(req.params.chapterId)
  if (!isChapterKey(chapterId)) throw badRequest('Identifiant de chapitre invalide.')
  const { quality, alt } = PagesQuery.parse(req.query)
  const alternates = (alt ?? '').split(',').filter(isChapterKey).slice(0, MAX_ALTERNATES)
  const served = await listPages(chapterId, quality, alternates)
  // Les URL listées pointent vers nos relais, stables : cacheables un moment.
  // Sauf un repli sur une autre source : la source demandée peut revenir vite.
  res.set('Cache-Control', served.fallback ? 'private, max-age=60' : 'private, max-age=600')
  res.json({
    chapterId,
    servedBy: served.chapterId,
    source: served.source,
    fallback: served.fallback,
    quality,
    pages: served.pages,
  })
})

/*
 * Relais des images MangaDex : même logique que les couvertures (cf. manga.routes.ts).
 * Même origine pour le navigateur, donc le Service Worker peut garder le
 * chapitre en cours pour une lecture hors-ligne ; et le rapport MD@Home exigé
 * par MangaDex part d'ici. Rien n'est gardé en mémoire : le cache HTTP du
 * navigateur et celui du Service Worker suffisent, la RAM du VPS est partagée.
 * Les autres sources passent par le relais générique `/api/proxy`.
 */
chaptersRouter.get('/:chapterId/image/:quality/:file', async (req, res) => {
  const { chapterId, file } = req.params
  if (!UUID.test(chapterId) || !PAGE_FILE.test(file)) throw badRequest('Page invalide.')
  const quality = QualitySchema.parse(req.params.quality)

  const image = await loadPageImage(chapterId, quality, file)
  // Nom de fichier = empreinte du contenu : immuable. Sauf repli « Data Saver »
  // servi à la place de l'originale : il ne doit pas s'installer durablement.
  res.set(
    'Cache-Control',
    image.degraded ? 'public, max-age=300' : 'public, max-age=2592000, immutable',
  )
  if (image.degraded) res.set('X-Reader-Quality', 'data-saver')
  res.type(image.contentType).send(image.body)
})
