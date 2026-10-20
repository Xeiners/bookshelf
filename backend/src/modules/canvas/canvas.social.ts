import { prisma } from '../../core/db.js'
import { HttpError, conflict, notFound } from '../../core/http/errors.js'
import { createNotification } from '../notifications/notifications.service.js'
import { creditStardust } from '../stardust/stardust.service.js'
import { accessOf, parseBrushes, unlockedBrushes } from './canvas.access.js'
import { BRUSHES, LIKES_PER_DAY, LIKE_REWARD, REPORTS_PER_HOUR, REPORTS_TO_HIDE, REWARD_PER_DAY, brushOf, type ReportReason } from './canvas.constants.js'
import { refreshAccess } from './realtime/canvas.hub.js'
import { world, type WObject, type WorldEvent } from './realtime/canvas.world.js'

/*
 * Le côté social de la toile : « j'aime » (et les Poussières qu'ils rapportent), signalements
 * (trois comptes différents masquent un objet en attendant un administrateur), boutique de
 * pinceaux, invitations dans un cadre.
 */

const today = (now = new Date()) => now.toISOString().slice(0, 10)

const isUniqueViolation = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002'

async function visibleObject(id: string): Promise<WObject> {
  const object = await world.find(id)
  if (!object || object.hidden) throw notFound('Objet introuvable.')
  return object
}

/* ---- J'aime ------------------------------------------------------------------------------- */

export interface LikeResult {
  likes: number
  liked: true
  /** Une Poussière est allée à l'auteur (plafond journalier non atteint). */
  rewarded: boolean
}

export async function likeObject(userId: string, objectId: string, now = new Date()): Promise<LikeResult> {
  const access = await accessOf(userId, now.getTime())
  if (!access) throw notFound('Compte introuvable.')
  if (access.reason === 'banned') throw new HttpError(403, 'canvas_banned', 'Tu n’as plus accès à la toile.')
  if (access.waitMs > 0) throw new HttpError(403, 'canvas_young', 'Ton compte est trop récent pour aimer un dessin.', { waitMs: access.waitMs })
  const object = await visibleObject(objectId)
  if (object.owner === userId) throw new HttpError(409, 'own_object', 'Tu ne peux pas aimer ton propre dessin.')
  await world.persisted(object)
  const day = today(now)
  let unlocked: string[] = []
  const outcome = await prisma.$transaction(async (tx) => {
    const mine = await tx.canvasProfile.upsert({ where: { userId }, create: { userId, day, likesGivenToday: 0 }, update: {} })
    const given = mine.day === day ? mine.likesGivenToday : 0
    if (given >= LIKES_PER_DAY) throw new HttpError(429, 'like_limit', 'Tu as donné tous tes « j’aime » du jour.', { limit: LIKES_PER_DAY })
    try {
      await tx.canvasLike.create({ data: { objectId, userId } })
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Tu aimes déjà ce dessin.', 'already_liked')
      throw error
    }
    await tx.canvasProfile.update({ where: { userId }, data: { day, likesGivenToday: given + 1 } })
    const row = await tx.canvasObject.update({ where: { id: objectId }, data: { likes: { increment: 1 } }, select: { likes: true } })
    const owner = await tx.canvasProfile.upsert({ where: { userId: object.owner }, create: { userId: object.owner, day }, update: {} })
    const rewardedToday = owner.day === day ? owner.rewardedToday : 0
    const rewarded = rewardedToday < REWARD_PER_DAY
    const likesReceived = owner.likesReceived + 1
    await tx.canvasProfile.update({ where: { userId: object.owner }, data: { day, likesReceived, rewardedToday: rewarded ? rewardedToday + 1 : rewardedToday } })
    if (rewarded) await creditStardust(tx, object.owner, LIKE_REWARD, 'canvas_like', { objectId })
    // Un seuil de « j'aime » franchi : un nouveau pinceau.
    const owned = new Set(parseBrushes(owner.brushes))
    unlocked = BRUSHES.filter((brush) => brush.price > 0 && brush.likes > 0 && likesReceived >= brush.likes && owner.likesReceived < brush.likes && !owned.has(brush.id)).map((brush) => brush.id)
    for (const brush of unlocked) await createNotification(tx, object.owner, 'canvas_reward', { kind: 'brush', brush })
    return { likes: row.likes, rewarded }
  })
  world.setLikes(object, outcome.likes)
  if (unlocked.length > 0) void refreshAccess(object.owner).catch(() => undefined)
  return { likes: outcome.likes, liked: true, rewarded: outcome.rewarded }
}

/* ---- Signalements ------------------------------------------------------------------------- */

export async function reportObject(userId: string, objectId: string, reason: ReportReason, now = new Date()): Promise<{ hidden: boolean }> {
  const object = await visibleObject(objectId)
  if (object.owner === userId) throw new HttpError(409, 'own_object', 'Tu ne peux pas signaler ton propre dessin.')
  const recent = await prisma.canvasReport.count({ where: { reporterId: userId, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } })
  if (recent >= REPORTS_PER_HOUR) throw new HttpError(429, 'report_limit', 'Trop de signalements pour le moment.')
  await world.persisted(object)
  try {
    await prisma.canvasReport.create({ data: { objectId, reporterId: userId, reason } })
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Tu as déjà signalé ce dessin.', 'already_reported')
    throw error
  }
  const reporters = await prisma.canvasReport.count({ where: { objectId, resolvedAt: null } })
  if (reporters >= REPORTS_TO_HIDE && !object.hidden) {
    await world.setHidden(objectId, true, 'reports')
    await createNotification(prisma, object.owner, 'canvas_moderated', { action: 'hidden', kind: object.type, reason: null })
    return { hidden: true }
  }
  return { hidden: false }
}

/* ---- Pinceaux ----------------------------------------------------------------------------- */

export interface BrushView {
  id: string
  price: number
  likes: number
  owned: boolean
  /** Débloqué par les « j'aime » reçus (sans rien payer). */
  byLikes: boolean
}

export interface BrushShop {
  brushes: BrushView[]
  balance: number
  likesReceived: number
}

export async function brushShop(userId: string): Promise<BrushShop> {
  const [profile, user] = await Promise.all([prisma.canvasProfile.findUnique({ where: { userId } }), prisma.user.findUnique({ where: { id: userId }, select: { stardust: true } })])
  const likesReceived = profile?.likesReceived ?? 0
  const purchased = parseBrushes(profile?.brushes ?? '[]')
  const owned = unlockedBrushes(purchased, likesReceived)
  return {
    brushes: BRUSHES.map((brush) => ({
      id: brush.id,
      price: brush.price,
      likes: brush.likes,
      owned: brush.price === 0 || owned.has(brush.id),
      byLikes: brush.price > 0 && brush.likes > 0 && likesReceived >= brush.likes,
    })),
    balance: user?.stardust ?? 0,
    likesReceived,
  }
}

export async function buyBrush(userId: string, brushId: string): Promise<BrushShop> {
  const brush = brushOf(brushId)
  if (!brush) throw notFound('Pinceau inconnu.')
  if (brush.price === 0) throw conflict('Ce pinceau est déjà à toi.', 'brush_owned')
  await prisma.$transaction(async (tx) => {
    const profile = await tx.canvasProfile.upsert({ where: { userId }, create: { userId }, update: {} })
    const purchased = parseBrushes(profile.brushes)
    if (unlockedBrushes(purchased, profile.likesReceived).has(brush.id)) throw conflict('Ce pinceau est déjà à toi.', 'brush_owned')
    const { count } = await tx.user.updateMany({ where: { id: userId, stardust: { gte: brush.price } }, data: { stardust: { decrement: brush.price } } })
    if (count === 0) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } })
      throw new HttpError(409, 'not_enough_stardust', 'Pas assez de Poussières d’Étoile.', { balance: user?.stardust ?? 0, price: brush.price })
    }
    await tx.stardustEntry.create({ data: { userId, amount: -brush.price, reason: 'canvas_brush', data: JSON.stringify({ brush: brush.id }) } })
    await tx.canvasProfile.update({ where: { userId }, data: { brushes: JSON.stringify([...purchased, brush.id]) } })
  })
  await refreshAccess(userId)
  return brushShop(userId)
}

/* ---- Invitations dans un cadre ------------------------------------------------------------ */

/** Un compte invité dans un cadre en est prévenu. */
export function watchInvitations(): () => void {
  return world.on((event: WorldEvent) => {
    if (event.type !== 'upsert' || event.invited.length === 0) return
    const frame = event.obj
    void (async () => {
      const owner = await prisma.user.findUnique({ where: { id: frame.owner }, select: { id: true, displayName: true } })
      if (!owner) return
      const existing = await prisma.user.findMany({ where: { id: { in: event.invited } }, select: { id: true } })
      const x = Math.round((frame.data.x as number) + (frame.data.w as number) / 2)
      const y = Math.round((frame.data.y as number) + (frame.data.h as number) / 2)
      for (const { id } of existing) {
        await createNotification(prisma, id, 'canvas_invite', { frameId: frame.id, title: (frame.data.tt as string) ?? '', by: { id: owner.id, displayName: owner.displayName }, x, y })
      }
    })().catch((error) => console.error('[canvas] invitation', error))
  })
}
