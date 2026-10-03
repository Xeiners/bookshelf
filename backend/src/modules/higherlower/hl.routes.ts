import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { currentPlayer, requirePlayer } from '../dle/dle.guests.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { ROOM_CODE, normalizeRoomCode } from '../dle/dle.logic.js'
import { HL_METRICS } from './hl.data.js'
import { createCoop, currentCoopOf, guessCoop, joinCoop, leaveCoop, setCoopMetric, startCoop, waitCoop } from './hl.coop.js'
import { endRun, guessRun, hlOverview, startRun } from './hl.service.js'

/**
 * Higher or Lower (cf. `hl.service.ts`). Monté sous `/api/higher-lower` : un compte, ou un
 * invité avec son pseudo (le même que celui du BookshelfDLE, cf. `dle.guests.ts`).
 */
export const higherLowerRouter = Router()
higherLowerRouter.use(requirePlayer)
higherLowerRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

/** Métriques, paliers de récompense, mes records, classements du jour et de tous les temps. */
higherLowerRouter.get('/', async (req, res) => {
  const userId = currentPlayer(req).id
  res.json({ ...(await hlOverview(userId)), currentCoop: currentCoopOf(userId) })
})

const playLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 10_000 : 90 })

const StartBody = z.object({ metric: z.enum(HL_METRICS) })

/** Nouvelle partie : la carte de référence (valeur connue) et la première à deviner. */
higherLowerRouter.post('/runs', playLimiter, async (req, res) => {
  res.status(201).json(await startRun(currentPlayer(req).id, StartBody.parse(req.body).metric))
})

const GuessBody = z.object({ choice: z.enum(['higher', 'lower']) })
const RunParams = z.object({ id: z.string().regex(/^[0-9a-f]{18}$/) })

/** Plus haut ou plus bas : la valeur révélée, puis la carte suivante ou le bilan de la partie. */
higherLowerRouter.post('/runs/:id/guess', playLimiter, async (req, res) => {
  const { id } = RunParams.parse(req.params)
  res.json(await guessRun(currentPlayer(req).id, id, GuessBody.parse(req.body).choice))
})

/** Arrêter la partie en cours : la série compte (records, Poussières) comme une fin normale. */
higherLowerRouter.post('/runs/:id/end', playLimiter, async (req, res) => {
  const { id } = RunParams.parse(req.params)
  res.json(await endRun(currentPlayer(req).id, id))
})

/* ---- COOP (cf. `hl.coop.ts`) ------------------------------------------------------------ */

const Code = z
  .string()
  .max(16)
  .transform(normalizeRoomCode)
  .refine((code) => ROOM_CODE.test(code), 'Code de salon invalide.')
const coopLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 10_000 : 60 })

higherLowerRouter.post('/coop', coopLimiter, async (req, res) => {
  res.status(201).json(await createCoop(currentPlayer(req), StartBody.parse(req.body).metric))
})

/** État du salon, en attente longue : `?v=<version connue>` ne répond qu'au changement suivant. */
higherLowerRouter.get('/coop/:code', async (req, res) => {
  const since = z.coerce.number().int().nonnegative().nullable().catch(null).parse(req.query.v ?? null)
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  const view = await waitCoop(currentPlayer(req).id, Code.parse(req.params.code), since, controller.signal)
  if (!res.writableEnded && !controller.signal.aborted) res.json(view)
})

higherLowerRouter.post('/coop/:code/join', coopLimiter, async (req, res) => {
  res.json(await joinCoop(currentPlayer(req), Code.parse(req.params.code)))
})

higherLowerRouter.post('/coop/:code/leave', coopLimiter, (req, res) => {
  leaveCoop(currentPlayer(req).id, Code.parse(req.params.code))
  res.status(204).end()
})

higherLowerRouter.post('/coop/:code/metric', coopLimiter, (req, res) => {
  res.json(setCoopMetric(currentPlayer(req).id, Code.parse(req.params.code), StartBody.parse(req.body).metric))
})

higherLowerRouter.post('/coop/:code/start', coopLimiter, (req, res) => {
  res.json(startCoop(currentPlayer(req).id, Code.parse(req.params.code)))
})

const CoopGuessBody = z.object({ choice: z.enum(['higher', 'lower']), turn: z.number().int().nonnegative() })

higherLowerRouter.post('/coop/:code/guess', playLimiter, async (req, res) => {
  const { choice, turn } = CoopGuessBody.parse(req.body)
  res.json(await guessCoop(currentPlayer(req).id, Code.parse(req.params.code), choice, turn))
})
