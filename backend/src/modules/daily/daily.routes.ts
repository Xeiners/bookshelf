import { Router } from 'express'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { claimDaily, dailyStatus } from './daily.service.js'

/** Monté sous `/api/daily` : le calendrier de récompenses quotidiennes (un compte). */
export const dailyRouter = Router()
dailyRouter.use(requireAuth, (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

dailyRouter.get('/', async (req, res) => {
  res.json(await dailyStatus(currentUserId(req)))
})

/** Prendre la case du jour. */
dailyRouter.post('/claim', async (req, res) => {
  res.json(await claimDaily(currentUserId(req)))
})
