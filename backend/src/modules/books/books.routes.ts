import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { prisma } from '../../db.js'
import { HttpError, notFound } from '../../lib/errors.js'
import { LangQuerySchema } from '../../lib/language.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { BookSchema } from './book.schema.js'
import {
  ONLINE_NOVEL_ID,
  assertQuota,
  deleteBook,
  getBook,
  importBook,
  linkBook,
  listBooks,
  matchBook,
  payloadTooLarge,
  receiveUpload,
  safeFileName,
  saveProgress,
  storageUsed,
  toDto,
  updateMetadata,
  workAlreadyLinked,
} from './books.service.js'
import { toBook } from './metadata.normalize.js'
import { discoverNovels, novelSummary, searchNovels } from './metadata.service.js'
import { NOVEL_SHELF_IDS, novelShelfQuery } from './novels.discover.js'

/*
 * Romans : recherche de fiches (publique) et bibliothèque EPUB d'un compte
 * (fichiers stockés côté serveur, position synchronisée entre appareils).
 * Les routes à chemin fixe (`/search`, `/upload`) sont déclarées AVANT `/:id`,
 * sinon Express prendrait « search » pour un identifiant de livre.
 */

/** Monté sous `/api/books`. */
export const booksRouter = Router()

const SearchQuery = z.object({
  q: z.string().trim().min(2).max(160),
  lang: LangQuerySchema,
})

const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 40 })

/** Romans FR / EN (Open Library + Google Books), au format `Book` du catalogue. */
booksRouter.get('/search', searchLimiter, async (req, res) => {
  if (!config.books.metadataLookup) throw new HttpError(503, 'metadata_disabled', 'Recherche de romans désactivée sur ce serveur.')
  const { q, lang } = SearchQuery.parse(req.query)
  const results = await searchNovels(q, lang)
  res.set('Cache-Control', 'public, max-age=600')
  res.json({ results: results.map((item) => toBook(item, lang)) })
})

/** Historique envoyé par le deck, comme pour `/api/discover/deck` (champs en trop ignorés). */
const DeckBody = z.object({
  shelf: z.enum(NOVEL_SHELF_IDS).default('pour-toi'),
  lang: LangQuerySchema,
  limit: z.number().int().min(1).max(30).default(20),
  /** « Nouvelle sélection » : décale le point de départ dans le classement. */
  round: z.number().int().min(0).max(10_000).default(0),
  seen: z.array(z.string().max(128)).max(1000).default([]),
  skipped: z.array(z.string().max(128)).max(10_000).default([]),
  liked: z
    .array(z.object({ id: z.string().max(128), categories: z.array(z.string().max(200)).max(12).default([]) }))
    .max(10_000)
    .default([]),
})

const deckLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 })

/**
 * Deck « Romans » : une fournée de fiches (format `Book`, `kind: 'book'`) pour
 * l'étagère demandée, sans ce qui a déjà été vu, passé ou gardé. Public : un
 * invité swipe aussi. Même contrat de réponse que `/api/discover/deck`.
 */
booksRouter.post('/discover', deckLimiter, async (req, res) => {
  if (!config.books.metadataLookup) throw new HttpError(503, 'metadata_disabled', 'Romans indisponibles sur ce serveur.')
  const body = DeckBody.parse(req.body ?? {})
  const exclude = new Set([...body.seen, ...body.skipped, ...body.liked.map((book) => book.id)])
  // Une relance repart plus loin dans le classement (5 points de départ, puis on reboucle).
  const offset = (body.round % 5) * 40 + body.seen.length
  const { books, hasMore } = await discoverNovels({
    query: novelShelfQuery(body.shelf, body.lang, body.liked),
    language: body.lang,
    offset,
    exclude,
    limit: body.limit,
  })
  res.set('Cache-Control', 'no-store')
  res.json({ books: books.map((item) => toBook(item, body.lang)), hasMore, personalized: body.shelf === 'pour-toi' })
})

/** Résumé d'un roman du deck (Open Library), demandé quand sa carte approche. */
booksRouter.get('/summary/:id', searchLimiter, async (req, res) => {
  const id = z.string().regex(/^ol:OL\d+W$/).parse(req.params.id)
  res.set('Cache-Control', 'public, max-age=86400')
  res.json({ synopsis: await novelSummary(id) })
})

booksRouter.use(requireAuth)

/**
 * Corps refusé : on le lit sans le garder avant de répondre. Un navigateur
 * encore en train d'envoyer ne verrait sinon qu'une connexion coupée, jamais
 * le 413 et son message. Au-delà de `DRAIN_LIMIT` octets annoncés, la
 * connexion est fermée : mieux vaut une erreur réseau que d'aspirer 1 Go.
 */
const DRAIN_LIMIT = 4 * config.books.maxUploadBytes

function discardBody(req: Request, declared: number): Promise<void> {
  if (!(declared <= DRAIN_LIMIT)) {
    req.res?.set('Connection', 'close')
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    req.on('end', resolve).on('error', () => resolve()).on('close', resolve)
    req.resume()
  })
}

/** Types acceptés pour le corps brut d'un envoi. Le contenu est de toute façon vérifié. */
const UPLOAD_TYPES = new Set(['application/epub+zip', 'application/octet-stream'])

const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60 })

const UploadQuery = z.object({
  lang: LangQuerySchema,
  /** Import depuis la fiche d'un roman : le fichier lui est rattaché d'office. */
  workId: z.string().regex(ONLINE_NOVEL_ID).optional(),
})

/**
 * Import d'un EPUB : le fichier est le CORPS de la requête (pas de
 * multipart), son nom dans l'en-tête `X-File-Name` (encodé URI). Une seule
 * lecture en flux vers le disque, sans tampon mémoire ni dépendance.
 * 201 : importé ; 200 + `duplicate` : ce fichier était déjà là.
 *
 * `match` dit où le livre se range : fiche en ligne reconnue ou imposée
 * (`linked`), fiche tirée du fichier (`created`), ou fiches à départager
 * par l'utilisateur (`choose`, puis `POST /:id/link`).
 */
booksRouter.post('/upload', uploadLimiter, async (req, res) => {
  const userId = currentUserId(req)
  const { lang, workId } = UploadQuery.parse(req.query)
  const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
  const declared = Number(req.headers['content-length'])

  // Refus décidé avant de lire le fichier : type, taille annoncée, espace du compte.
  let refusal: HttpError | null = null
  if (!UPLOAD_TYPES.has(type)) refusal = new HttpError(415, 'unsupported_type', 'Seuls les fichiers EPUB sont acceptés.')
  else if (declared > config.books.maxUploadBytes) {
    refusal = payloadTooLarge(`Fichier trop volumineux (${Math.round(config.books.maxUploadBytes / 1024 / 1024)} Mo maximum).`)
  } else if (workId && (await prisma.userBook.count({ where: { userId, workId } })) > 0) {
    // Fiche déjà dotée d'un fichier : refusé avant de recevoir le moindre octet.
    refusal = workAlreadyLinked()
  } else if (Number.isFinite(declared)) {
    refusal = await assertQuota(userId, declared).then(
      () => null,
      (error: unknown) => (error instanceof HttpError ? error : Promise.reject(error)),
    )
  }
  if (refusal) {
    await discardBody(req, declared)
    throw refusal
  }

  const upload = await receiveUpload(req)
  const { book, duplicate, match } = await importBook(userId, upload, safeFileName(req.header('x-file-name')), lang, workId ?? null)
  res.status(duplicate ? 200 : 201).json({ book: toDto(book), duplicate, match })
})

booksRouter.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const books = await listBooks(currentUserId(req))
  res.json({ books: books.map(toDto) })
})

/** Espace occupé par les romans du compte, et quota. Avant `/:id` : « storage » n'est pas un id. */
booksRouter.get('/storage', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const userId = currentUserId(req)
  const [usedBytes, count] = await Promise.all([storageUsed(userId), prisma.userBook.count({ where: { userId } })])
  res.json({ usedBytes, quotaBytes: config.books.quotaBytes, count })
})

const IdParam = z.string().min(1).max(64).regex(/^[\w-]+$/)

booksRouter.get('/:id', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ book: toDto(await getBook(currentUserId(req), IdParam.parse(req.params.id))) })
})

/** Nom de fichier pour `Content-Disposition` : repli ASCII + version UTF-8 (RFC 6266). */
function disposition(name: string): string {
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'livre.epub'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * Sert un fichier stocké. `res.sendFile` (module `send`) gère `Range`,
 * `If-Range`, `ETag` et les 206 / 304 / 416. Il signale un 416 comme une
 * erreur, en-tête `Content-Range` déjà posé : on répond simplement le statut.
 */
function sendStored(res: Response, relative: string, headers: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    res.sendFile(relative, { root: config.books.dir, headers, dotfiles: 'deny', cacheControl: false }, (error?: Error) => {
      if (!error || res.headersSent) return resolve()
      const status = (error as { status?: number }).status
      if (status === 404 || (error as { code?: string }).code === 'ENOENT') return reject(notFound('Fichier introuvable sur le serveur.'))
      if (status && status >= 400 && status < 500) {
        res.status(status).end()
        return resolve()
      }
      reject(error)
    })
  })
}

/** Le fichier EPUB, en flux, requêtes `Range` comprises (reprise, lecture partielle). */
booksRouter.get('/:id/file', async (req, res) => {
  const book = await getBook(currentUserId(req), IdParam.parse(req.params.id))
  await sendStored(res, book.filePath, {
    'Content-Type': 'application/epub+zip',
    'Content-Disposition': disposition(book.originalName),
    // Le front garde sa copie dans IndexedDB (hors-ligne) : inutile d'en garder une seconde en cache HTTP.
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
})

const COVER_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }

/** Couverture extraite du fichier. Son URL change avec le fichier (`?v=`) : cache long. */
booksRouter.get('/:id/cover', async (req, res) => {
  const book = await getBook(currentUserId(req), IdParam.parse(req.params.id))
  if (!book.coverPath) throw notFound('Ce livre n’a pas de couverture.')
  await sendStored(res, book.coverPath, {
    'Content-Type': COVER_TYPES[book.coverPath.split('.').pop() ?? ''] ?? 'application/octet-stream',
    'Cache-Control': 'private, max-age=604800',
    'X-Content-Type-Options': 'nosniff',
  })
})

const ProgressBody = z.object({
  /** CFI EPUB : `epubcfi(/6/14!/4/2/1:0)`. */
  cfi: z.string().min(8).max(2000).startsWith('epubcfi('),
  percent: z.number().min(0).max(100),
  at: z.number().int().positive(),
})

/** Position de lecture (CFI + pourcentage). La plus récente, d'après `at`, fait foi. */
booksRouter.patch('/:id/progress', async (req, res) => {
  const input = ProgressBody.parse(req.body)
  const { applied, book } = await saveProgress(currentUserId(req), IdParam.parse(req.params.id), input)
  res.json({ applied, book: toDto(book) })
})

/** Couvertures acceptées : celles que proposent nos sources de fiches, en HTTPS. */
const COVER_HOSTS = new Set(['covers.openlibrary.org', 'books.google.com', 'books.googleusercontent.com'])
const CoverUrl = z.url({ protocol: /^https$/ }).max(1000).refine((url) => COVER_HOSTS.has(new URL(url).hostname), {
  message: 'Couverture refusée : Open Library ou Google Books uniquement.',
})

const nullableText = (max: number) => z.string().trim().max(max).nullable().transform((value) => value || null)

const MetadataBody = z
  .object({
    title: z.string().trim().min(1).max(500),
    author: nullableText(300),
    synopsis: z.string().trim().max(10_000),
    coverUrl: CoverUrl.nullable(),
    publisher: nullableText(200),
    year: z.number().int().min(0).max(2100).nullable(),
    pages: z.number().int().min(1).max(100_000).nullable(),
  })
  .partial()
  .strict()

const LinkBody = z.union([
  z.object({ record: BookSchema }).strict(),
  z.object({ own: z.literal(true) }).strict(),
])

/**
 * Rattache le fichier à une fiche : celle choisie parmi les propositions (ou
 * trouvée par une recherche), ou une fiche tirée du fichier (`own`). 409 si
 * la fiche a déjà un autre fichier.
 */
booksRouter.post('/:id/link', async (req, res) => {
  const choice = LinkBody.parse(req.body)
  const { book, record } = await linkBook(currentUserId(req), IdParam.parse(req.params.id), choice)
  res.json({ book: toDto(book), record })
})

const MatchBody = z.object({ lang: LangQuerySchema, mode: z.enum(['auto', 'interactive']).default('interactive') })

/** Nouveau rapprochement (import d'avant le rattachement, ou propositions à revoir). */
booksRouter.post('/:id/match', uploadLimiter, async (req, res) => {
  const { lang, mode } = MatchBody.parse(req.body ?? {})
  const { book, match } = await matchBook(currentUserId(req), IdParam.parse(req.params.id), lang, mode)
  res.json({ book: toDto(book), match })
})

/** Corrige la fiche. `coverUrl: null` revient à la couverture du fichier. */
booksRouter.patch('/:id', async (req, res) => {
  const patch = MetadataBody.parse(req.body)
  res.json({ book: toDto(await updateMetadata(currentUserId(req), IdParam.parse(req.params.id), patch)) })
})

/** Supprime le livre du compte, fichiers compris. */
booksRouter.delete('/:id', async (req, res) => {
  await deleteBook(currentUserId(req), IdParam.parse(req.params.id))
  res.status(204).end()
})
