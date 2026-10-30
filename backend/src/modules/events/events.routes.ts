import { Router } from 'express'
import { z } from 'zod'
import { currentUserId, requireAuth } from '../../core/http/auth.js'
import { claimEvent, pendingEvents } from './events.service.js'

/** Monté sous `/api/events` : les événements de l'équipe qui attendent ce compte, et leurs cadeaux. */
export const eventsRouter = Router()
eventsRouter.use(requireAuth, (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

eventsRouter.get('/pending', async (req, res) => {
  res.json({ events: await pendingEvents(currentUserId(req)) })
})

/** Récupère les cadeaux d'un événement. 404 s'il est fini ; 409 `event_claimed` la deuxième fois. */
eventsRouter.post('/:id/claim', async (req, res) => {
  res.json(await claimEvent(currentUserId(req), z.string().min(1).max(40).parse(req.params.id)))
})
