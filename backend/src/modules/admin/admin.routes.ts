import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import { storedAvatar } from '../users/avatarUpload.js'
import { currentAdmin, requireAdmin } from './admin.access.js'
import { dleReview } from '../dle/dle.review.js'
import { adminOverview as canvasOverview, banUser, purgeUser, removeObject, restoreObject, unbanUser } from '../canvas/canvas.moderation.js'
import { ensureCanvas } from '../canvas/canvas.boot.js'
import { PROMOTION_MAX_HOURS, PROMOTION_MESSAGE_MAX, PROMOTION_TARGETS, createPromotion, endPromotion, listPromotions } from '../promotions/promotions.service.js'
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

/* ---- Promotions --------------------------------------------------------------------- */

const PromotionBody = z.object({
  target: z.enum(PROMOTION_TARGETS),
  price: z.number().int().min(1).max(100_000),
  hours: z.number().int().min(1).max(PROMOTION_MAX_HOURS),
  message: z.string().trim().max(PROMOTION_MESSAGE_MAX).transform((value) => value || null).nullable().default(null),
})

adminRouter.get('/promotions', async (_req, res) => {
  res.json({ promotions: await listPromotions() })
})

/** Lance une promotion : tous les comptes sont prévenus. 400 `promotion_price` si ce n'est pas une baisse. */
adminRouter.post('/promotions', async (req, res) => {
  res.status(201).json(await createPromotion(currentAdmin(req), PromotionBody.parse(req.body)))
})

adminRouter.post('/promotions/:id/end', async (req, res) => {
  res.json({ promotion: await endPromotion(currentAdmin(req), z.string().min(1).max(40).parse(req.params.id)) })
})

/* ---- Toile partagée ------------------------------------------------------------------- */

const CanvasObjectId = z.string().regex(/^[0-9a-f]{16}$/)

adminRouter.get('/canvas', async (_req, res) => {
  await ensureCanvas()
  res.json(await canvasOverview())
})

adminRouter.post('/canvas/objects/:id/remove', async (req, res) => {
  await ensureCanvas()
  await removeObject(currentAdmin(req), CanvasObjectId.parse(req.params.id))
  res.json({ ok: true })
})

adminRouter.post('/canvas/objects/:id/restore', async (req, res) => {
  await ensureCanvas()
  await restoreObject(currentAdmin(req), CanvasObjectId.parse(req.params.id))
  res.json({ ok: true })
})

adminRouter.post('/canvas/users/:id/purge', async (req, res) => {
  await ensureCanvas()
  res.json({ removed: await purgeUser(currentAdmin(req), UserId.parse(req.params.id)) })
})

adminRouter.post('/canvas/users/:id/ban', async (req, res) => {
  await ensureCanvas()
  await banUser(currentAdmin(req), UserId.parse(req.params.id), SuspendBody.parse(req.body ?? {}).reason)
  res.json({ ok: true })
})

adminRouter.post('/canvas/users/:id/unban', async (req, res) => {
  await ensureCanvas()
  await unbanUser(currentAdmin(req), UserId.parse(req.params.id))
  res.json({ ok: true })
})

adminRouter.get('/audit', async (req, res) => {
  res.json(await auditLog(AuditQuery.parse(req.query)))
})

/* ---- Revue des images d'énigme du BookshelfDLE ------------------------------------------------ */

const Category = z.string().min(1).max(30)
const ReviewQuery = z.object({ limit: z.coerce.number().int().min(1).max(20).catch(8) })
const ImageQuery = z.object({ character: z.string().min(1).max(80), key: z.string().min(1).max(300) })
const PortraitQuery = z.object({ character: z.string().min(1).max(80) })
const ReviewBody = z.object({ characterId: z.string().min(1).max(80), key: z.string().min(1).max(300), decision: z.enum(['approve', 'ban', 'clear']) })

/** Les univers de personnages et l'avancement de leur revue. */
adminRouter.get('/dle-images', async (_req, res) => {
  res.json({ universes: await dleReview.overview() })
})

/** Les prochaines images à revoir dans un univers (`ready: false` : elles se chargent encore). */
adminRouter.get('/dle-images/:category/queue', async (req, res) => {
  res.json(await dleReview.queue(Category.parse(req.params.category), ReviewQuery.parse(req.query).limit))
})

/** L'image elle-même, relayée (l'adresse d'origine ne sort pas du serveur). */
adminRouter.get('/dle-images/:category/image', async (req, res) => {
  const { character, key } = ImageQuery.parse(req.query)
  const image = await dleReview.image(Category.parse(req.params.category), character, key)
  res.set('Cache-Control', 'private, max-age=3600').type(image.contentType).send(image.body)
})

/** Le portrait du personnage : de quoi juger l'image. */
adminRouter.get('/dle-images/:category/portrait', async (req, res) => {
  const { character } = PortraitQuery.parse(req.query)
  const image = await dleReview.portrait(Category.parse(req.params.category), character)
  res.set('Cache-Control', 'private, max-age=3600').type(image.contentType).send(image.body)
})

/** Valide (`approve`), bannit (`ban`) ou efface (`clear`) la décision sur une image. */
adminRouter.post('/dle-images/:category/review', async (req, res) => {
  const { characterId, key, decision } = ReviewBody.parse(req.body)
  res.json(await dleReview.decide(currentAdmin(req), Category.parse(req.params.category), characterId, key, decision))
})
