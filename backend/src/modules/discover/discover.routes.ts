import { Router, type Request } from 'express'
import { z } from 'zod'
import { LangQuerySchema } from '../../lib/language.js'
import { optionalAuth } from '../../middleware/auth.js'
import { browseCatalog, browseMangadex, genreFacets } from '../../services/browse.service.js'
import { composeDeck } from '../../services/catalog.service.js'
import { getProfile, profileFromHistory, seenIds } from '../../services/recommendation/preference.service.js'
import type { TasteProfile } from '../../services/recommendation/scoring.js'

const WorkId = z.string().min(1).max(128)

/**
 * Historique local d'un invité : titres aimés (avec leurs libellés, favori et
 * note), titres passés. Le profil de goûts est calculé à la volée avec le même
 * algorithme que pour un compte. Connecté, il complète celui du compte (file
 * d'envoi pas encore vidée).
 */
const HistorySchema = z.object({
  liked: z
    .array(
      z.object({
        id: WorkId,
        categories: z.array(z.string().max(80)).max(12).default([]),
        rating: z.number().min(0).max(5).nullable().default(null),
        favorite: z.boolean().default(false),
        userRating: z.number().min(0.5).max(5).nullable().default(null),
      }),
    )
    .max(5000)
    .default([]),
  skipped: z.array(WorkId).max(2000).default([]),
})

const OriginSchema = z.enum(['all', 'manga', 'manhwa', 'manhua']).catch('all')

const DeckBody = z.intersection(
  HistorySchema,
  z.object({
    shelf: z.string().trim().max(40).default('pour-toi'),
    origin: OriginSchema,
    lang: LangQuerySchema,
    limit: z.coerce.number().int().min(1).max(40).default(20),
    /** Cartes déjà dans la file du front : jamais renvoyées deux fois. */
    seen: z.array(WorkId).max(1000).default([]),
  }),
)

const BrowseBody = z.intersection(
  HistorySchema,
  z.object({
    q: z.string().trim().max(120).default(''),
    origin: OriginSchema,
    genres: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
    status: z.enum(['any', 'ongoing', 'completed']).catch('any'),
    minScore: z.coerce.number().int().min(0).max(95).catch(0),
    sort: z.enum(['relevance', 'popularity', 'score', 'recent', 'match']).catch('relevance'),
    page: z.coerce.number().int().min(1).max(200).default(1),
    limit: z.coerce.number().int().min(1).max(48).default(24),
    lang: LangQuerySchema,
    /** `mangadex` : le complément d'une recherche maigre (seconde requête du front). */
    source: z.enum(['catalog', 'mangadex']).catch('catalog'),
  }),
)

type History = z.infer<typeof HistorySchema>

/** Profil de goûts de la requête : celui du compte, ou calculé depuis l'historique invité. */
async function resolveProfile(req: Request, history: History): Promise<{ profile: TasteProfile; seen: Set<string> }> {
  const seen = new Set<string>([...history.liked.map((item) => item.id), ...history.skipped])
  if (req.userId) {
    const [stored, account] = await Promise.all([getProfile(req.userId), seenIds(req.userId)])
    for (const id of account) seen.add(id)
    return { profile: stored, seen }
  }
  const { profile } = await profileFromHistory({
    liked: history.liked.map(({ id, categories, rating, favorite, userRating }) => ({
      id,
      book: { categories, rating },
      favorite,
      userRating,
    })),
    skipped: history.skipped,
  })
  return { profile, seen }
}

const isPersonalized = (profile: TasteProfile) =>
  Object.keys(profile.genres).length > 0 || Object.keys(profile.tags).length > 0

export const discoverRouter = Router()

discoverRouter.post('/deck', optionalAuth, async (req, res) => {
  const startedAt = performance.now()
  const body = DeckBody.parse(req.body ?? {})
  const { profile, seen } = await resolveProfile(req, body)
  for (const id of body.seen) seen.add(id)

  const deck = await composeDeck({
    shelf: body.shelf,
    origin: body.origin,
    language: body.lang,
    limit: body.limit,
    excluded: seen,
    profile,
  })

  res.set('Server-Timing', `deck;dur=${(performance.now() - startedAt).toFixed(1)}`)
  res.set('Cache-Control', 'no-store')
  res.json({ ...deck, personalized: isPersonalized(profile) })
})

/** Recherche et exploration du catalogue, avec le % de match de chaque titre. */
discoverRouter.post('/browse', optionalAuth, async (req, res) => {
  const startedAt = performance.now()
  const body = BrowseBody.parse(req.body ?? {})
  const { profile } = await resolveProfile(req, body)

  const request = {
    query: body.q,
    origin: body.origin,
    genres: body.genres,
    status: body.status,
    minScore: body.minScore,
    sort: body.sort,
    page: body.page,
    limit: body.limit,
    language: body.lang,
    profile,
  }

  res.set('Cache-Control', 'no-store')
  if (body.source === 'mangadex') {
    const books = await browseMangadex(request)
    res.json({ books, total: books.length, page: 1, hasMore: false, supplement: false, personalized: isPersonalized(profile) })
    return
  }

  const page = await browseCatalog(request)
  res.set('Server-Timing', `browse;dur=${(performance.now() - startedAt).toFixed(1)}`)
  res.json({ ...page, personalized: isPersonalized(profile) })
})

/** Genres disponibles comme filtres, libellés dans la langue demandée. */
discoverRouter.get('/genres', async (req, res) => {
  const { lang } = z.object({ lang: LangQuerySchema }).parse(req.query)
  res.set('Cache-Control', 'public, max-age=600')
  res.json({ genres: await genreFacets(lang) })
})
