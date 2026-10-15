import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { currentPlayer, requirePlayer } from '../dle/dle.guests.js'
import { finishRunnerRun, reviveRunnerRun, runnerOverview, startRunnerRun } from './runner.service.js'
import { GIFT_NOTE_MAX, giftBox, openBox, setOutfit, wardrobeView } from './runner.wardrobe.service.js'
import { WARDROBE_SLOTS } from './runner.wardrobe.js'

/**
 * Manga Runner 3D (cf. `runner.service.ts`). Monté sous `/api/runner` : un compte, ou un
 * invité avec son pseudo (le même que celui du BookshelfDLE, cf. `dle.guests.ts`). La
 * garde-robe et les boîtes demandent un compte (403 `wardrobe_account_only`).
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

/** Revivre après un choc : la course continue, contre des Poussières (prix doublé à chaque fois). */
runnerRouter.post('/runs/:id/revive', runLimiter, async (req, res) => {
  const { id } = RunParams.parse(req.params)
  res.json(await reviveRunnerRun(currentPlayer(req).id, id))
})

/** Garde-robe de l'aventurier : pièces, tenue, boîtes (gratuite toutes les 24 h). */
runnerRouter.get('/wardrobe', async (req, res) => {
  res.json(await wardrobeView(currentPlayer(req).id))
})

const boxLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 10_000 : 40 })
const BoxBody = z.object({ free: z.boolean().default(false), gift: z.boolean().default(false) })

/** Ouvre une boîte mystère : la pièce tirée, doublon remboursé, et la garde-robe à jour. */
runnerRouter.post('/boxes', boxLimiter, async (req, res) => {
  const { free, gift } = BoxBody.parse(req.body ?? {})
  res.status(201).json(await openBox(currentPlayer(req).id, gift ? 'gift' : free ? 'free' : 'paid'))
})

const GiftBody = z.object({ to: z.string().regex(/^[a-z0-9]{8,40}$/i), message: z.string().max(GIFT_NOTE_MAX).nullable().optional() })

/** Offrir une boîte mystère à un autre membre (payée par l'expéditeur). */
runnerRouter.post('/gifts', boxLimiter, async (req, res) => {
  const { to, message } = GiftBody.parse(req.body ?? {})
  res.status(201).json(await giftBox(currentPlayer(req).id, to, message ?? null))
})

const OutfitBody = z.object(Object.fromEntries(WARDROBE_SLOTS.map((slot) => [slot, z.string().max(40).nullable().optional()])))

/** Équipe une tenue (pièces possédées seulement). */
runnerRouter.patch('/outfit', async (req, res) => {
  res.json(await setOutfit(currentPlayer(req).id, OutfitBody.parse(req.body ?? {}) as Record<string, string | null | undefined>))
})
