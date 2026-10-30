import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../core/config.js'
import { rateLimit } from '../../core/http/rateLimit.js'
import { currentPlayer, requirePlayer } from '../dle/dle.guests.js'
import { finishJumpRun, jumpOverview, startJumpRun } from './jump.service.js'
import { buyCharacter, selectCharacter } from './jump.characters.js'

/**
 * Page Jump (cf. `jump.service.ts`). Monté sous `/api/jump` : un compte, ou un invité avec son
 * pseudo (le même que celui du BookshelfDLE, cf. `dle.guests.ts`).
 */
export const jumpRouter = Router()

jumpRouter.use(requirePlayer)
jumpRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

/** Mes records, le plafond du jour et le classement. */
jumpRouter.get('/', async (req, res) => {
  res.json(await jumpOverview(currentPlayer(req).id))
})

const runLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 10_000 : 40 })

/** Départ : identifiant de la partie. */
jumpRouter.post('/runs', runLimiter, (req, res) => {
  res.status(201).json(startJumpRun(currentPlayer(req).id))
})

const RunParams = z.object({ id: z.string().regex(/^[0-9a-f]{18}$/) })
const EndBody = z.object({
  score: z.number().int().min(0).max(10_000_000),
  height: z.number().int().min(0).max(100_000_000),
  stars: z.number().int().min(0).max(1_000_000),
  stomps: z.number().int().min(0).max(1_000_000),
})

/** Arrivée : le bilan déclaré, borné par le serveur, puis records et Poussières. */
jumpRouter.post('/runs/:id/end', runLimiter, async (req, res) => {
  const { id } = RunParams.parse(req.params)
  res.json(await finishJumpRun(currentPlayer(req).id, id, EndBody.parse(req.body)))
})

const CharacterParams = z.object({ id: z.string().min(1).max(40) })

/** Achète un personnage (un compte) : le nouveau solde, et il est choisi. 409 `character_owned` ou `not_enough_stardust`. */
jumpRouter.post('/characters/:id/buy', runLimiter, async (req, res) => {
  res.json(await buyCharacter(currentPlayer(req).id, CharacterParams.parse(req.params).id))
})

/** Choisit un personnage déjà possédé. */
jumpRouter.post('/characters/:id/select', runLimiter, async (req, res) => {
  res.json(await selectCharacter(currentPlayer(req).id, CharacterParams.parse(req.params).id))
})
