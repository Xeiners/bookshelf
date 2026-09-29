import { Router } from 'express'
import { z } from 'zod'
import { LangQuerySchema } from '../../lib/language.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { SyncBodySchema, syncPlaylists } from './playlists.js'
import { IMPORTABLE_PLAYLIST, importYouTubePlaylist } from './youtubePlaylist.js'
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

const PlaylistQuery = z.object({ lang: LangQuerySchema })

/**
 * Vidéos d'une playlist YouTube (titre compris), pour la recréer en playlist
 * d'ambiance. Mix automatiques (`RD…`) refusés : ils n'existent que pour un visiteur.
 */
musicRouter.get('/playlist/:id', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const id = z.string().regex(IMPORTABLE_PLAYLIST).parse(req.params.id)
  const { lang } = PlaylistQuery.parse(req.query)
  res.set('Cache-Control', 'private, max-age=600')
  res.json(await importYouTubePlaylist(id, lang))
})

const syncLimiter = rateLimit({ windowMs: 60_000, max: 60 })

/**
 * Playlists d'ambiance du compte : l'appareil envoie les siennes (suppressions
 * comprises), reçoit l'état fusionné de tous ses appareils. Corps vide : simple lecture.
 */
musicRouter.post('/playlists/sync', syncLimiter, requireAuth, async (req, res) => {
  const { playlists } = SyncBodySchema.parse(req.body ?? {})
  res.set('Cache-Control', 'no-store')
  res.json({ playlists: await syncPlaylists(currentUserId(req), playlists) })
})
