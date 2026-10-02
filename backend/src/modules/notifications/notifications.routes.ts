import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { listNotifications, markRead, removeNotification } from './notifications.service.js'

/** Monté sous `/api/notifications`. Réservé aux comptes : un invité n'a rien à recevoir. */
export const notificationsRouter = Router()
notificationsRouter.use(requireAuth)

/** Une date invalide est ignorée : le client reçoit alors la liste complète, jamais une erreur. */
const ListQuery = z.object({ since: z.coerce.date().optional().catch(undefined) })
const ReadBody = z.object({ ids: z.array(z.string().min(1).max(40)).max(100).optional() })
const NotificationId = z.string().min(1).max(40)

/**
 * Sondé toutes les ~45 s par chaque appareil ouvert, et une même IP peut porter
 * plusieurs comptes (box familiale) : large, mais pas illimité. Les tests
 * enchaînent des centaines de requêtes depuis la même IP.
 */
const pollLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 5000 : 120 })
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 5000 : 120 })

/** `?since=<ISO>` : seulement les nouvelles (sondage) ; le nombre de non lues est toujours complet. */
notificationsRouter.get('/', pollLimiter, async (req, res) => {
  const { since } = ListQuery.parse(req.query)
  res.set('Cache-Control', 'no-store')
  res.json(await listNotifications(currentUserId(req), since))
})

/** `{ ids }` : celles-ci ; sans `ids` : toutes. */
notificationsRouter.post('/read', writeLimiter, async (req, res) => {
  const { ids } = ReadBody.parse(req.body ?? {})
  res.json({ unread: await markRead(currentUserId(req), ids) })
})

notificationsRouter.delete('/:id', writeLimiter, async (req, res) => {
  res.json({ unread: await removeNotification(currentUserId(req), NotificationId.parse(req.params.id)) })
})
