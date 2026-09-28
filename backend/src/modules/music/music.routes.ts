import { Router } from 'express'
import { z } from 'zod'
import { LangQuerySchema } from '../../lib/language.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { searchYouTube } from './youtubeSearch.js'

const SearchQuery = z.object({
  q: z.string().trim().min(2).max(100),
  type: z.enum(['video', 'playlist']).catch('video'),
  lang: LangQuerySchema,
})

export const musicRouter = Router()

/**
 * Recherche de musique (YouTube) pour les playlists d'ambiance, ouverte aux
 * invités. Bornée par IP : chaque recherche non gardée en cache interroge YouTube.
 */
musicRouter.get('/search', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const { q, type, lang } = SearchQuery.parse(req.query)
  const results = await searchYouTube(q, type, lang)
  res.set('Cache-Control', 'private, max-age=600')
  res.json({ results })
})
