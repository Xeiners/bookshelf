import { Router } from 'express'
import { activePromotions } from './promotions.service.js'

/** Monté sous `/api/promotions` : les promotions en cours, pour tout le monde (boutique). */
export const promotionsRouter = Router()

promotionsRouter.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ promotions: await activePromotions() })
})
