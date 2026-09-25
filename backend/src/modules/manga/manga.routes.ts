import { Router } from 'express'
import { z } from 'zod'
import { TtlCache } from '../../lib/cache.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { LangQuerySchema } from '../../lib/language.js'
import { bookFor, findWork } from '../../services/catalog.service.js'
import { fetchCoverImage } from './mangadex.client.js'
import { BATCH_LIMIT, getManga, getMangas, listShelf, searchManga } from './manga.service.js'
import { SHELVES, findShelf } from './shelves.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Œuvre connue d'AniList seulement (catalogue agrégé du deck). */
const ANILIST_ID = /^al-\d{1,9}$/
const COVER_FILE = /^[\w-]+\.(?:jpe?g|png|webp|gif)$/i

const OriginSchema = z.enum(['all', 'manga', 'manhwa']).default('all')

/** Pagination du catalogue, bornée à la fenêtre de 10 000 résultats de MangaDex. */
const Pagination = z
  .object({
    page: z.coerce.number().int().min(1).max(500).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(24),
  })
  .refine(({ page, limit }) => page * limit <= 10_000, {
    message: 'Page hors de la fenêtre consultable (10 000 résultats).',
    path: ['page'],
  })

/** `?lang=fr|en` : langue des titres, résumés et genres. Absente ou inconnue → `fr`. */
const LangQuery = z.object({ lang: LangQuerySchema })

const SearchQuery = z.intersection(
  z.intersection(Pagination, LangQuery),
  z.object({
    q: z.string().trim().min(2).max(120),
    origin: OriginSchema,
  }),
)

const BatchQuery = z.intersection(
  LangQuery,
  z.object({
    ids: z
      .string()
      .transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean))
      .pipe(z.array(z.string().regex(UUID)).min(1).max(BATCH_LIMIT)),
  }),
)

export const mangaRouter = Router()

mangaRouter.get('/shelves', (req, res) => {
  const { lang } = LangQuery.parse(req.query)
  res.json({ shelves: SHELVES.map(({ id, label }) => ({ id, label: label[lang] })) })
})

mangaRouter.get('/shelves/:shelfId', async (req, res) => {
  const shelf = findShelf(req.params.shelfId)
  if (!shelf) throw notFound('Étagère inconnue.')
  const { page, limit } = Pagination.parse(req.query)
  const { lang } = LangQuery.parse(req.query)
  res.set('Cache-Control', 'public, max-age=300')
  res.json(await listShelf(shelf, page, limit, lang))
})

mangaRouter.get('/search', async (req, res) => {
  const { q, page, limit, origin, lang } = SearchQuery.parse(req.query)
  res.set('Cache-Control', 'public, max-age=120')
  res.json(await searchManga(q, page, limit, origin, lang))
})

/** `?ids=a,b,c&lang=en` : traduction d'une bibliothèque enregistrée (100 ids max). */
mangaRouter.get('/batch', async (req, res) => {
  const { ids, lang } = BatchQuery.parse(req.query)
  res.set('Cache-Control', 'public, max-age=600')
  res.json({ books: await getMangas(ids, lang) })
})

mangaRouter.get('/:id', async (req, res) => {
  const { id } = req.params
  const { lang } = LangQuery.parse(req.query)
  if (ANILIST_ID.test(id)) {
    const work = await findWork(id)
    if (!work) throw notFound()
    res.set('Cache-Control', 'public, max-age=3600')
    res.json({ book: await bookFor(work, lang) })
    return
  }
  if (!UUID.test(id)) throw badRequest('Identifiant MangaDex invalide.')
  res.set('Cache-Control', 'public, max-age=3600')
  res.json({ book: await getManga(id, lang) })
})

/* ---- Couvertures ---------------------------------------------------------
 * Relayées par l'API : MangaDex interdit le hotlinking depuis un site tiers,
 * et le Service Worker du front peut ainsi les mettre en cache (même origine).
 */

interface CachedImage {
  body: Buffer
  contentType: string
}

/** ~300 couvertures 512 px ≈ 25-35 Mo : le deck repasse souvent sur les mêmes. */
const coverCache = new TtlCache<CachedImage>({ maxEntries: 300, ttlMs: 12 * 60 * 60 * 1000 })

const CoverQuery = z.object({
  size: z.enum(['256', '512']).default('512'),
})

export const coverRouter = Router()

coverRouter.get('/:mangaId/:fileName', async (req, res) => {
  const { mangaId, fileName } = req.params
  if (!UUID.test(mangaId) || !COVER_FILE.test(fileName)) throw badRequest('Couverture invalide.')
  const size = Number(CoverQuery.parse(req.query).size) as 256 | 512

  const image = await coverCache.getOrLoad(`${mangaId}/${fileName}/${size}`, async () => {
    // La raison exacte part dans les journaux : côté navigateur, tout échec
    // amont se ressemble (404), impossible sinon de distinguer un blocage
    // MangaDex d'un souci réseau ou DNS du serveur.
    const upstream = await fetchCoverImage(mangaId, fileName, size).catch((error: unknown) => {
      const cause = error instanceof Error ? `${error.name}: ${error.message} ${String(error.cause ?? '')}` : String(error)
      console.warn(`[covers] ${mangaId}/${fileName} (${size}) : échec réseau vers MangaDex — ${cause}`)
      throw notFound('Couverture indisponible.')
    })
    if (!upstream.ok) {
      console.warn(`[covers] ${mangaId}/${fileName} (${size}) : MangaDex a répondu ${upstream.status}`)
      throw notFound('Couverture indisponible.')
    }
    return {
      body: Buffer.from(await upstream.arrayBuffer()),
      contentType: upstream.headers.get('content-type') ?? 'image/jpeg',
    }
  })

  // Un nom de fichier de couverture MangaDex est immuable.
  res.set('Cache-Control', 'public, max-age=604800, immutable')
  res.type(image.contentType).send(image.body)
})
