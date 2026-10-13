import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { currentPlayer, requirePlayer } from '../dle/dle.guests.js'
import { finishRunnerRun, runnerOverview, startRunnerRun } from './runner.service.js'

/**
 * Manga Runner 3D (cf. `runner.service.ts`). Monté sous `/api/runner` : un compte, ou un
 * invité avec son pseudo (le même que celui du BookshelfDLE, cf. `dle.guests.ts`).
 */
export const runnerRouter = Router()
runnerRouter.use(requirePlayer)
runnerRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

/** Mes records, le plafond du jour et le classement. */
runnerRouter.get('/', async (req, res) => {
  res.json(await runnerOverview(currentPlayer(req).id))
})

const runLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 10_000 : 30 })

/** Départ : identifiant de la course et graine de la piste. */
runnerRouter.post('/runs', runLimiter, (req, res) => {
  res.status(201).json(startRunnerRun(currentPlayer(req).id))
})

const RunParams = z.object({ id: z.string().regex(/^[0-9a-f]{18}$/) })
const EndBody = z.object({
  distance: z.number().finite().min(0).max(10_000_000),
  stardust: z.number().int().min(0).max(1_000_000),
  quiz: z.number().int().min(0).max(10_000),
})

/** Arrivée : le bilan déclaré, borné par le serveur, puis records et Poussières. */
runnerRouter.post('/runs/:id/end', runLimiter, async (req, res) => {
  const { id } = RunParams.parse(req.params)
  res.json(await finishRunnerRun(currentPlayer(req).id, id, EndBody.parse(req.body)))
})
