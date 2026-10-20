import { prisma } from '../../core/db.js'
import { conflict, notFound } from '../../core/http/errors.js'
import { record, type Admin } from '../admin/admin.service.js'
import { createNotification } from '../notifications/notifications.service.js'
import { onlineCount, refreshAccess, silence } from './realtime/canvas.hub.js'
import { world } from './realtime/canvas.world.js'

/*
 * Modération de la toile par l'administration : la file des signalements, effacer ou rendre
 * un objet, tout effacer chez un compte, exclure un compte de la toile. Chaque action est
 * inscrite au journal et prévient le compte concerné.
 */

export interface QueueItem {
  id: string
  type: string
  data: unknown
  owner: { id: string; name: string | null }
  hidden: boolean
  reports: number
  reasons: Record<string, number>
  likes: number
  createdAt: string
  box: { minX: number; minY: number; maxX: number; maxY: number }
}

export interface CanvasAdminOverview {
  online: number
  objects: number
  frames: number
  artists: number
  pending: number
  hidden: number
  banned: number
  queue: QueueItem[]
}

const QUEUE_LIMIT = 40

export async function adminOverview(): Promise<CanvasAdminOverview> {
  await world.flush()
  const seasonId = world.seasonId
  const [objects, frames, artists, hidden, banned, groups] = await Promise.all([
    prisma.canvasObject.count({ where: { seasonId } }),
    prisma.canvasObject.count({ where: { seasonId, type: 'f' } }),
    prisma.canvasObject.groupBy({ by: ['ownerId'], where: { seasonId } }).then((list) => list.length),
    prisma.canvasObject.count({ where: { seasonId, hiddenAt: { not: null } } }),
    prisma.canvasProfile.count({ where: { bannedAt: { not: null } } }),
    prisma.canvasReport.groupBy({ by: ['objectId'], where: { resolvedAt: null }, _count: { _all: true }, orderBy: { _count: { objectId: 'desc' } }, take: QUEUE_LIMIT }),
  ])
  const ids = groups.map((group) => group.objectId)
  const [rows, reports] = await Promise.all([
    prisma.canvasObject.findMany({ where: { id: { in: ids }, seasonId }, include: { owner: { select: { id: true, displayName: true } } } }),
    prisma.canvasReport.findMany({ where: { objectId: { in: ids }, resolvedAt: null }, select: { objectId: true, reason: true } }),
  ])
  const byId = new Map(rows.map((row) => [row.id, row]))
  const queue: QueueItem[] = []
  for (const group of groups) {
    const row = byId.get(group.objectId)
    if (!row) continue
    const reasons: Record<string, number> = {}
    for (const report of reports) if (report.objectId === row.id) reasons[report.reason] = (reasons[report.reason] ?? 0) + 1
    queue.push({
      id: row.id,
      type: row.type,
      data: JSON.parse(row.data) as unknown,
      owner: { id: row.owner.id, name: row.owner.displayName },
      hidden: row.hiddenAt !== null,
      reports: group._count._all,
      reasons,
      likes: row.likes,
      createdAt: row.createdAt.toISOString(),
      box: { minX: row.minX, minY: row.minY, maxX: row.maxX, maxY: row.maxY },
    })
  }
  const pending = await prisma.canvasReport.count({ where: { resolvedAt: null } })
  return { online: onlineCount(), objects, frames, artists, pending, hidden, banned, queue }
}

export async function removeObject(admin: Admin, id: string): Promise<void> {
  const object = await world.find(id)
  if (!object) throw notFound('Objet introuvable.')
  await world.persisted(object)
  world.drop(object, admin.id)
  await prisma.canvasReport.updateMany({ where: { objectId: id, resolvedAt: null }, data: { resolvedAt: new Date() } })
  await prisma.$transaction(async (tx) => {
    await record(tx, admin, 'canvas_remove', object.owner, { objectId: id, kind: object.type })
    await createNotification(tx, object.owner, 'canvas_moderated', { action: 'removed', kind: object.type, reason: null })
  })
}

/** Les signalements étaient infondés : l'objet redevient visible. */
export async function restoreObject(admin: Admin, id: string): Promise<void> {
  const object = await world.find(id)
  if (!object) throw notFound('Objet introuvable.')
  await world.persisted(object)
  await world.setHidden(id, false, null)
  await prisma.canvasReport.updateMany({ where: { objectId: id, resolvedAt: null }, data: { resolvedAt: new Date() } })
  await prisma.$transaction(async (tx) => {
    await record(tx, admin, 'canvas_restore', object.owner, { objectId: id, kind: object.type })
    if (object.hidden) await createNotification(tx, object.owner, 'canvas_moderated', { action: 'restored', kind: object.type, reason: null })
  })
}

export async function purgeUser(admin: Admin, userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) throw notFound('Compte introuvable.')
  const removed = await world.purge(userId, admin.id)
  await prisma.$transaction(async (tx) => {
    await record(tx, admin, 'canvas_purge', userId, { removed })
    if (removed > 0) await createNotification(tx, userId, 'canvas_moderated', { action: 'removed', kind: null, reason: null })
  })
  return removed
}

export async function banUser(admin: Admin, userId: string, reason: string | null): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) throw notFound('Compte introuvable.')
  const profile = await prisma.canvasProfile.findUnique({ where: { userId } })
  if (profile?.bannedAt) throw conflict('Ce compte est déjà exclu de la toile.', 'already_banned')
  await prisma.$transaction(async (tx) => {
    await tx.canvasProfile.upsert({ where: { userId }, create: { userId, bannedAt: new Date(), bannedReason: reason }, update: { bannedAt: new Date(), bannedReason: reason } })
    await record(tx, admin, 'canvas_ban', userId, { reason })
    await createNotification(tx, userId, 'canvas_moderated', { action: 'banned', kind: null, reason })
  })
  silence(userId)
  await refreshAccess(userId)
}

export async function unbanUser(admin: Admin, userId: string): Promise<void> {
  const profile = await prisma.canvasProfile.findUnique({ where: { userId } })
  if (!profile?.bannedAt) throw conflict('Ce compte n’est pas exclu de la toile.', 'not_banned')
  await prisma.$transaction(async (tx) => {
    await tx.canvasProfile.update({ where: { userId }, data: { bannedAt: null, bannedReason: null } })
    await record(tx, admin, 'canvas_unban', userId, {})
    await createNotification(tx, userId, 'canvas_moderated', { action: 'unbanned', kind: null, reason: null })
  })
  await refreshAccess(userId)
}
