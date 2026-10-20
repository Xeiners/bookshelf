import { config } from '../../core/config.js'
import { prisma } from '../../core/db.js'
import { BRUSHES } from './canvas.constants.js'
import { isAdminEmail } from '../admin/admin.access.js'
import { profileOf } from '../dle/dle.rooms.js'

/*
 * Ce qu'un compte peut faire sur la toile : regarder (tout compte connecté), dessiner (compte
 * assez ancien, non exclu), quels pinceaux il possède. Les pinceaux de départ sont à tous ; les
 * autres s'achètent en Poussières ou se débloquent avec les « j'aime » reçus.
 */

export interface CanvasAccess {
  userId: string
  admin: boolean
  /** Peut dessiner ? Sinon `reason` dit pourquoi (`young`, `banned`) et `waitMs` combien de temps. */
  canDraw: boolean
  reason: 'young' | 'banned' | null
  waitMs: number
  /** Pinceaux possédés hors départ (achetés, ou débloqués par les « j'aime »). */
  brushes: Set<string>
  likesReceived: number
  name: string | null
  avatar: string | null
}

export function unlockedBrushes(purchased: readonly string[], likesReceived: number): Set<string> {
  const unlocked = new Set(purchased)
  for (const brush of BRUSHES) if (brush.price > 0 && brush.likes > 0 && likesReceived >= brush.likes) unlocked.add(brush.id)
  return unlocked
}

export const parseBrushes = (json: string): string[] => {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

export async function accessOf(userId: string, now = Date.now()): Promise<CanvasAccess | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, createdAt: true, canvasProfile: true } })
  if (!user) return null
  const admin = isAdminEmail(user.email)
  const profile = await profileOf({ id: userId, guest: null })
  const banned = user.canvasProfile?.bannedAt != null
  const waitMs = admin ? 0 : Math.max(0, user.createdAt.getTime() + config.canvas.minAccountAgeMs - now)
  const likesReceived = user.canvasProfile?.likesReceived ?? 0
  return {
    userId,
    admin,
    canDraw: !banned && waitMs === 0,
    reason: banned ? 'banned' : waitMs > 0 ? 'young' : null,
    waitMs,
    brushes: unlockedBrushes(parseBrushes(user.canvasProfile?.brushes ?? '[]'), likesReceived),
    likesReceived,
    name: profile.name,
    avatar: profile.avatarUrl ?? profile.avatar?.imageUrl ?? null,
  }
}
