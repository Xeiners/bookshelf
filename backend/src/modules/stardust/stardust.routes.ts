import { Router } from 'express'
import { config } from '../../core/config.js'
import { currentUserId, requireAuth } from '../../core/http/auth.js'
import { rateLimit } from '../../core/http/rateLimit.js'
import { z } from 'zod'
import { MAX_PACKS_AT_ONCE } from '../cards/boosters.logic.js'
import { buyLegendaryPack } from '../cards/cards.service.js'
import { buyBooster, claimGuestStardust, walletOf } from './stardust.service.js'

/** Poussières d'Étoile (cf. `stardust.service.ts`). Monté sous `/api/stardust`. */
export const stardustRouter = Router()
stardustRouter.use(requireAuth)

/** Solde, prix d'un booster et derniers mouvements. */
stardustRouter.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await walletOf(currentUserId(req)))
})

const buyLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 1000 : 10 })

/** Boosters achetés d'un coup (1 par défaut). */
const BuyBody = z.object({ quantity: z.number().int().min(1).max(MAX_PACKS_AT_ONCE).default(1) })

/** Achète un ou plusieurs boosters de réserve. 409 `not_enough_stardust` si le solde ne suffit pas. */
stardustRouter.post('/booster', buyLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await buyBooster(currentUserId(req), BuyBody.parse(req.body ?? {}).quantity))
})

/** Achète et ouvre un Booster Légendaire : ses cartes, le nouveau solde. 409 `not_enough_stardust`, 503 si la collection n'est pas prête. */
stardustRouter.post('/legendary-pack', buyLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await buyLegendaryPack(currentUserId(req)))
})

const ClaimBody = z.object({ receipts: z.array(z.string().max(2048)).max(50) })

/** Poussières gagnées en invité : les reçus gardés sur l'appareil rejoignent le compte (plafonné). */
stardustRouter.post('/claim', buyLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await claimGuestStardust(currentUserId(req), ClaimBody.parse(req.body).receipts))
})
