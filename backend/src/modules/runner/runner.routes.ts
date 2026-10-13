import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { requireAdmin } from '../admin/admin.access.js'
import { finishRunnerRun, runnerOverview, startRunnerRun } from './runner.service.js'

/**
 * Manga Runner 3D (cf. `runner.service.ts`). Monté sous `/api/runner`. Pour l'instant
 * réservé aux administrateurs (`ADMIN_EMAILS`) : 404 pour les autres comptes et les
 * invités, comme l'administration. Le service sait déjà servir les invités du
 * BookshelfDLE (reçus de Poussières) pour le jour de l'ouverture à tous.
 */
export const runnerRouter = Router()
runnerRouter.use(requireAuth, requireAdmin)
runnerRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

/** Mes records, le plafond du jour et le classement. */
runnerRouter.get('/', async (req, res) => {
  res.json(await runnerOverview(currentUserId(req)))
})

const runLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 10_000 : 30 })

/** Départ : identifiant de la course et graine de la piste. */
runnerRouter.post('/runs', runLimiter, (req, res) => {
  res.status(201).json(startRunnerRun(currentUserId(req)))
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
  res.json(await finishRunnerRun(currentUserId(req), id, EndBody.parse(req.body)))
})
