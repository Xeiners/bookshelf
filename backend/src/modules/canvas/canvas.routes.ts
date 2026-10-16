import { Router } from 'express'
import { createReadStream } from 'node:fs'
import { z } from 'zod'
import { prisma } from '../../db.js'
import { HttpError, notFound } from '../../lib/errors.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { config } from '../../config.js'
import { profileOf } from '../dle/dle.rooms.js'
import { accessOf } from './canvas.access.js'
import { ensureCanvas } from './canvas.boot.js'
import { BRUSHES, REPORT_REASONS } from './canvas.constants.js'
import { onlineCount } from './canvas.hub.js'
import { gallery, listSeasons, seasonArchive, timelapse } from './canvas.seasons.js'
import { brushShop, buyBrush, likeObject, reportObject } from './canvas.social.js'
import { TILE_MAX_LEVEL, tile } from './canvas.tiles.js'
import { world } from './canvas.world.js'

/**
 * Toile partagée (cf. `canvas.hub.ts` pour le temps réel). Monté sous `/api/canvas` : un compte
 * connecté. Ici, ce qui n'a pas besoin du WebSocket : état, tuiles, galerie, saisons, « j'aime »,
 * signalements, pinceaux.
 */
export const canvasRouter = Router()
canvasRouter.use(requireAuth)
canvasRouter.use(async (_req, _res, next) => {
  await ensureCanvas()
  next()
})

const test = config.env === 'test'
const socialLimiter = rateLimit({ windowMs: 60_000, max: test ? 10_000 : 60 })
const tileLimiter = rateLimit({ windowMs: 60_000, max: test ? 100_000 : 1200 })

const ObjectId = z.string().regex(/^[0-9a-f]{16}$/)
const SeasonId = z.string().min(1).max(40)

/** Accueil : la saison, mes droits, combien d'artistes en ligne. */
canvasRouter.get('/', async (req, res) => {
  const access = await accessOf(currentUserId(req))
  if (!access) throw notFound('Compte introuvable.')
  const season = await prisma.canvasSeason.findUnique({ where: { id: world.seasonId } })
  res.set('Cache-Control', 'no-store')
  res.json({
    season: { id: world.seasonId, key: world.seasonKey, startedAt: season?.startedAt.toISOString() ?? null },
    online: onlineCount(),
    me: { canDraw: access.canDraw, reason: access.reason, waitMs: access.waitMs, admin: access.admin, brushes: [...access.brushes], likesReceived: access.likesReceived },
    brushes: BRUSHES,
  })
})

/** Pseudos et avatars (infobulles, signalements) : une trentaine d'identifiants à la fois. */
canvasRouter.get('/users', socialLimiter, async (req, res) => {
  const ids = z
    .string()
    .max(1500)
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.string().min(1).max(40)).max(30))
    .parse(req.query.ids ?? '')
  const users = await Promise.all(
    ids.map(async (id) => {
      const profile = await profileOf({ id, guest: null }).catch(() => null)
      return profile ? { id, name: profile.name, avatar: profile.avatarUrl ?? profile.avatar?.imageUrl ?? null } : null
    }),
  )
  res.set('Cache-Control', 'private, max-age=60')
  res.json({ users: users.filter((user) => user !== null) })
})

/** Tous les cadres de la saison, en abrégé : mini-carte, « aller vers un cadre ». */
canvasRouter.get('/frames', async (_req, res) => {
  const frames = world.frameList().filter((frame) => !frame.hidden).slice(0, 3000)
  res.set('Cache-Control', 'no-store')
  res.json({
    frames: frames.map((frame) => ({ id: frame.id, title: (frame.data.tt as string) ?? '', owner: frame.owner, likes: frame.likes, x: frame.data.x as number, y: frame.data.y as number, w: frame.data.w as number, h: frame.data.h as number })),
  })
})

/* ---- Tuiles ------------------------------------------------------------------------------- */

canvasRouter.get('/tiles/:level/:x/:file', tileLimiter, async (req, res) => {
  const params = z
    .object({
      level: z.coerce.number().int().min(0).max(TILE_MAX_LEVEL),
      x: z.coerce.number().int().min(-4096).max(4096),
      file: z.string().regex(/^-?\d{1,5}\.png$/),
    })
    .parse(req.params)
  const y = Number(params.file.slice(0, -4))
  const result = await tile(params.level, params.x, y)
  res.set('X-Tile-Version', String(result.version))
  // La version est dans l'URL du client (`?v=`) : une image fraîche se garde ; une image en retard, non.
  res.set('Cache-Control', result.stale ? 'no-store' : 'private, max-age=300')
  if (!result.png) {
    res.status(204).end()
    return
  }
  res.type('png').send(result.png)
})

/* ---- Galerie, saisons ----------------------------------------------------------------------- */

canvasRouter.get('/gallery', async (req, res) => {
  const seasonId = z.object({ season: SeasonId.optional() }).parse(req.query).season ?? world.seasonId
  res.set('Cache-Control', 'no-store')
  res.json({ frames: await gallery(seasonId, currentUserId(req)) })
})

canvasRouter.get('/seasons', async (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ seasons: await listSeasons() })
})

canvasRouter.get('/seasons/:id/image', async (req, res) => {
  const file = await seasonArchive(SeasonId.parse(req.params.id))
  res.set('Cache-Control', 'private, max-age=86400')
  res.type('png')
  createReadStream(file).on('error', () => res.status(404).end()).pipe(res)
})

canvasRouter.get('/seasons/:id/timelapse', socialLimiter, async (req, res) => {
  const query = z.object({ after: ObjectId.optional(), limit: z.coerce.number().int().min(100).max(3000).default(2000) }).parse(req.query)
  res.set('Cache-Control', 'no-store')
  res.json(await timelapse(SeasonId.parse(req.params.id), query.after, query.limit))
})

/* ---- J'aime, signalements --------------------------------------------------------------------- */

canvasRouter.post('/objects/:id/like', socialLimiter, async (req, res) => {
  res.json(await likeObject(currentUserId(req), ObjectId.parse(req.params.id)))
})

canvasRouter.post('/objects/:id/report', socialLimiter, async (req, res) => {
  const { reason } = z.object({ reason: z.enum(REPORT_REASONS) }).parse(req.body)
  res.status(201).json(await reportObject(currentUserId(req), ObjectId.parse(req.params.id), reason))
})

/** Qui a dessiné cet objet ? (menu de l'objet : auteur, « j'aime », signalement) */
canvasRouter.get('/objects/:id', async (req, res) => {
  const object = await world.find(ObjectId.parse(req.params.id))
  if (!object || object.hidden) throw notFound('Objet introuvable.')
  const userId = currentUserId(req)
  const [profile, like, report] = await Promise.all([
    profileOf({ id: object.owner, guest: null }).catch(() => null),
    prisma.canvasLike.findUnique({ where: { objectId_userId: { objectId: object.id, userId } } }),
    prisma.canvasReport.findUnique({ where: { objectId_reporterId: { objectId: object.id, reporterId: userId } } }),
  ])
  res.set('Cache-Control', 'no-store')
  res.json({ id: object.id, type: object.type, likes: object.likes, createdAt: new Date(object.createdAt).toISOString(), owner: { id: object.owner, name: profile?.name ?? null, avatar: profile?.avatarUrl ?? profile?.avatar?.imageUrl ?? null }, liked: like !== null, reported: report !== null, mine: object.owner === userId })
})

/* ---- Pinceaux ----------------------------------------------------------------------------------- */

canvasRouter.get('/brushes', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await brushShop(currentUserId(req)))
})

canvasRouter.post('/brushes/:id/buy', socialLimiter, async (req, res) => {
  const id = z.string().min(1).max(20).parse(req.params.id)
  if (!BRUSHES.some((brush) => brush.id === id)) throw new HttpError(404, 'not_found', 'Pinceau inconnu.')
  res.json(await buyBrush(currentUserId(req), id))
})
