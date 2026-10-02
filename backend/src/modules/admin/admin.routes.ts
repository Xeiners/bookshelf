import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import { storedAvatar } from '../users/avatarUpload.js'
import { currentAdmin, requireAdmin } from './admin.access.js'
import {
  MAX_GIFT_BOOSTERS,
  MAX_GIFT_CARDS,
  auditLog,
  giftBoosters,
  giftCard,
  listUsers,
  moderateUser,
  overview,
  searchCards,
  suspendUser,
  unsuspendUser,
  userDetail,
} from './admin.service.js'

/**
 * Monté sous `/api/admin`. Comptes de `ADMIN_EMAILS` seulement ; pour les
 * autres, ces routes n'existent pas (404). Rien n'y est jamais mis en cache.
 */
export const adminRouter = Router()
adminRouter.use(requireAuth, requireAdmin, (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

const UserId = z.string().min(1).max(40)
const Message = z
  .string()
  .trim()
  .max(200)
  .transform((value) => value || null)
  .nullable()
  .default(null)

const UsersQuery = z.object({
  q: z.string().max(100).default(''),
  filter: z.enum(['all', 'active', 'suspended']).catch('all'),
  cursor: z.string().max(40).optional(),
})
const AuditQuery = z.object({ userId: z.string().max(40).optional(), cursor: z.string().max(40).optional() })
const CardsQuery = z.object({ q: z.string().max(100).default('') })

const GiftBoostersBody = z.object({ count: z.number().int().min(1).max(MAX_GIFT_BOOSTERS), message: Message })
const GiftCardBody = z.object({ cardId: z.string().min(1).max(40), count: z.number().int().min(1).max(MAX_GIFT_CARDS).default(1), message: Message })
const SuspendBody = z.object({ reason: Message })
const ModerateBody = z.object({
  displayName: z.boolean().optional(),
  bio: z.boolean().optional(),
  avatar: z.boolean().optional(),
  makePrivate: z.boolean().optional(),
  cancelOffers: z.boolean().optional(),
})

adminRouter.get('/overview', async (_req, res) => {
  res.json(await overview())
})

adminRouter.get('/users', async (req, res) => {
  res.json(await listUsers(UsersQuery.parse(req.query)))
})

adminRouter.get('/users/:id', async (req, res) => {
  res.json({ user: await userDetail(UserId.parse(req.params.id)) })
})

/** Photo personnelle d'un compte : seul son titulaire la voit d'ordinaire, l'admin en a besoin pour modérer. */
adminRouter.get('/users/:id/avatar-image', async (req, res) => {
  const avatar = await storedAvatar(UserId.parse(req.params.id))
  res.type(avatar.contentType).sendFile(avatar.file)
})

adminRouter.post('/users/:id/boosters', async (req, res) => {
  const { count, message } = GiftBoostersBody.parse(req.body)
  res.json({ boosters: await giftBoosters(currentAdmin(req), UserId.parse(req.params.id), count, message) })
})

adminRouter.post('/users/:id/cards', async (req, res) => {
  const { cardId, count, message } = GiftCardBody.parse(req.body)
  res.json(await giftCard(currentAdmin(req), UserId.parse(req.params.id), cardId, count, message))
})

adminRouter.post('/users/:id/suspend', async (req, res) => {
  const { reason } = SuspendBody.parse(req.body ?? {})
  const id = UserId.parse(req.params.id)
  await suspendUser(currentAdmin(req), id, reason)
  res.json({ user: await userDetail(id) })
})

adminRouter.post('/users/:id/unsuspend', async (req, res) => {
  const id = UserId.parse(req.params.id)
  await unsuspendUser(currentAdmin(req), id)
  res.json({ user: await userDetail(id) })
})

adminRouter.post('/users/:id/moderate', async (req, res) => {
  const id = UserId.parse(req.params.id)
  await moderateUser(currentAdmin(req), id, ModerateBody.parse(req.body))
  res.json({ user: await userDetail(id) })
})

adminRouter.get('/cards', async (req, res) => {
  res.json({ cards: await searchCards(CardsQuery.parse(req.query).q) })
})

adminRouter.get('/audit', async (req, res) => {
  res.json(await auditLog(AuditQuery.parse(req.query)))
})
