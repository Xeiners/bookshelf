import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { currentPlayer, requirePlayer } from '../dle/dle.guests.js'
import { stackCoverImage, stackCovers } from './stack.covers.js'
import { finishStackRun, stackOverview, startStackRun } from './stack.service.js'

/**
 * Page Stack (cf. `stack.service.ts`). Monté sous `/api/stack` : un compte, ou un invité avec
 * son pseudo (le même que celui du BookshelfDLE, cf. `dle.guests.ts`).
 */
export const stackRouter = Router()

/** Les affiches d'anime des pages : publiques, comme les couvertures du reste de l'app. */
stackRouter.get('/covers', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=900')
  res.json({ covers: await stackCovers() })
})

stackRouter.get('/covers/:id', async (req, res) => {
  const image = await stackCoverImage(z.coerce.number().int().positive().max(10_000_000).parse(req.params.id))
  res.set('Cache-Control', 'public, max-age=604800, immutable')
  res.type(image.contentType).send(image.body)
})

stackRouter.use(requirePlayer)
stackRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

/** Mes records, le plafond du jour et le classement. */
stackRouter.get('/', async (req, res) => {
  res.json(await stackOverview(currentPlayer(req).id))
})

const runLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 10_000 : 40 })

/** Départ : identifiant de la partie. */
stackRouter.post('/runs', runLimiter, (req, res) => {
  res.status(201).json(startStackRun(currentPlayer(req).id))
})

const RunParams = z.object({ id: z.string().regex(/^[0-9a-f]{18}$/) })
const EndBody = z.object({
  score: z.number().int().min(0).max(1_000_000),
  pages: z.number().int().min(0).max(10_000),
  perfects: z.number().int().min(0).max(10_000),
})

/** Arrivée : le bilan déclaré, borné par le serveur, puis records et Poussières. */
stackRouter.post('/runs/:id/end', runLimiter, async (req, res) => {
  const { id } = RunParams.parse(req.params)
  res.json(await finishStackRun(currentPlayer(req).id, id, EndBody.parse(req.body)))
})
