import { Router } from 'express'
import { z } from 'zod'
import { currentUserId, requireAuth } from '../../core/http/auth.js'
import { REWARD_CHOICES, claimReward, pendingRewards } from './rewards.service.js'

/** Monté sous `/api/rewards` : les récompenses de record à choisir (un compte). */
export const rewardsRouter = Router()
rewardsRouter.use(requireAuth, (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

rewardsRouter.get('/', async (req, res) => {
  res.json({ rewards: await pendingRewards(currentUserId(req)) })
})

const ClaimBody = z.object({ choice: z.enum(REWARD_CHOICES) })

/** Choisir sa récompense : un booster ou une boîte mystère. */
rewardsRouter.post('/:id/claim', async (req, res) => {
  const id = z.string().min(1).max(40).parse(req.params.id)
  res.json(await claimReward(currentUserId(req), id, ClaimBody.parse(req.body).choice))
})
