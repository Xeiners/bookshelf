import { Router } from 'express'
import { config } from '../../config.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { z } from 'zod'
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

/** Achète un booster de réserve. 409 `not_enough_stardust` si le solde ne suffit pas. */
stardustRouter.post('/booster', buyLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await buyBooster(currentUserId(req)))
})

const ClaimBody = z.object({ receipts: z.array(z.string().max(2048)).max(50) })

/** Poussières gagnées en invité : les reçus gardés sur l'appareil rejoignent le compte (plafonné). */
stardustRouter.post('/claim', buyLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await claimGuestStardust(currentUserId(req), ClaimBody.parse(req.body).receipts))
})
