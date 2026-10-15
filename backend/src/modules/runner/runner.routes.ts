import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { requireAdmin } from '../admin/admin.access.js'
import { finishRunnerRun, reviveRunnerRun, runnerOverview, startRunnerRun } from './runner.service.js'
import { openBox, setOutfit, wardrobeView } from './runner.wardrobe.service.js'
import { WARDROBE_SLOTS } from './runner.wardrobe.js'

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

/** Revivre après un choc : la course continue, contre des Poussières (prix doublé à chaque fois). */
runnerRouter.post('/runs/:id/revive', runLimiter, async (req, res) => {
  const { id } = RunParams.parse(req.params)
  res.json(await reviveRunnerRun(currentUserId(req), id))
})

/** Garde-robe de l'aventurier : pièces, tenue, boîtes (gratuite toutes les 24 h). */
runnerRouter.get('/wardrobe', async (req, res) => {
  res.json(await wardrobeView(currentUserId(req)))
})

const boxLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 10_000 : 40 })
const BoxBody = z.object({ free: z.boolean().default(false) })

/** Ouvre une boîte mystère : la pièce tirée, doublon remboursé, et la garde-robe à jour. */
runnerRouter.post('/boxes', boxLimiter, async (req, res) => {
  const { free } = BoxBody.parse(req.body ?? {})
  res.status(201).json(await openBox(currentUserId(req), free))
})

const OutfitBody = z.object(Object.fromEntries(WARDROBE_SLOTS.map((slot) => [slot, z.string().max(40).nullable().optional()])))

/** Équipe une tenue (pièces possédées seulement). */
runnerRouter.patch('/outfit', async (req, res) => {
  res.json(await setOutfit(currentUserId(req), OutfitBody.parse(req.body ?? {}) as Record<string, string | null | undefined>))
})
