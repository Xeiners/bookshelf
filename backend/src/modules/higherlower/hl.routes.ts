import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { HL_METRICS } from './hl.data.js'
import { endRun, guessRun, hlOverview, startRun } from './hl.service.js'

/** Higher or Lower (cf. `hl.service.ts`). Monté sous `/api/higher-lower`, comptes seulement. */
export const higherLowerRouter = Router()
higherLowerRouter.use(requireAuth)
higherLowerRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

/** Métriques, paliers de récompense, mes records, classements du jour et de tous les temps. */
higherLowerRouter.get('/', async (req, res) => {
  res.json(await hlOverview(currentUserId(req)))
})

const playLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 10_000 : 90 })

const StartBody = z.object({ metric: z.enum(HL_METRICS) })

/** Nouvelle partie : la carte de référence (valeur connue) et la première à deviner. */
higherLowerRouter.post('/runs', playLimiter, async (req, res) => {
  res.status(201).json(await startRun(currentUserId(req), StartBody.parse(req.body).metric))
})

const GuessBody = z.object({ choice: z.enum(['higher', 'lower']) })
const RunParams = z.object({ id: z.string().regex(/^[0-9a-f]{18}$/) })

/** Plus haut ou plus bas : la valeur révélée, puis la carte suivante ou le bilan de la partie. */
higherLowerRouter.post('/runs/:id/guess', playLimiter, async (req, res) => {
  const { id } = RunParams.parse(req.params)
  res.json(await guessRun(currentUserId(req), id, GuessBody.parse(req.body).choice))
})

/** Arrêter la partie en cours : la série compte (records, Poussières) comme une fin normale. */
higherLowerRouter.post('/runs/:id/end', playLimiter, async (req, res) => {
  const { id } = RunParams.parse(req.params)
  res.json(await endRun(currentUserId(req), id))
})
