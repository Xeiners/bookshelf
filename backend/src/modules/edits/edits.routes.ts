import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../core/config.js'
import { HttpError } from '../../core/http/errors.js'
import { rateLimit } from '../../core/http/rateLimit.js'
import { UNIVERSE_IDS, type EditUniverse } from './edits.logic.js'
import { editsPage } from './edits.service.js'

/**
 * Monté sous `/api/edits`, ouvert à tous (invités compris) : le fil ne dépend d'aucun compte, et
 * le cache des recherches protège le quota YouTube. `?universe=` filtre sur une série, `?seed=`
 * fixe l'ordre du fil d'une visite, `?offset=` reprend où le défilement en est.
 */
export const editsRouter = Router()

const limiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 1000 : 60 })
const PAGE_SIZE = 8

const Query = z.object({
  universe: z.enum(UNIVERSE_IDS as [EditUniverse, ...EditUniverse[]]).optional(),
  seed: z.string().regex(/^[\w-]{1,32}$/).default('daily'),
  offset: z.coerce.number().int().min(0).max(2000).default(0),
})

editsRouter.get('/', limiter, async (req, res) => {
  if (!config.music.search) throw new HttpError(503, 'edits_disabled', 'Recherche YouTube désactivée.')
  const { universe, seed, offset } = Query.parse(req.query)
  res.set('Cache-Control', 'private, max-age=300')
  res.json(await editsPage({ universe: universe ?? null, seed, offset, limit: PAGE_SIZE }))
})
