import { prisma } from '../../db.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { BOX_PRICE } from '../runner/runner.wardrobe.js'
import { BOOSTER_PRICE } from '../stardust/prices.js'

/*
 * Promotions : un administrateur baisse le prix d'un booster ou d'une boîte mystère pour
 * un temps. Tout le monde en est prévenu (notification), la boutique affiche le prix barré,
 * et chaque achat débite le prix du moment, lu ici (jamais celui envoyé par le client).
 */

export const PROMOTION_TARGETS = ['booster', 'box'] as const
export type PromotionTarget = (typeof PROMOTION_TARGETS)[number]
/** Durée d'une promotion (h) : d'une heure à deux semaines. */
export const PROMOTION_MAX_HOURS = 24 * 14
export const PROMOTION_MESSAGE_MAX = 140

/** Prix habituel de chaque article. */
export const REGULAR_PRICE: Record<PromotionTarget, number> = { booster: BOOSTER_PRICE, box: BOX_PRICE }

export interface PromotionDto {
  id: string
  target: PromotionTarget
  price: number
  regular: number
  message: string | null
  startsAt: string
  endsAt: string
  /** Arrêtée avant son terme (`null` : elle court, ou s'est terminée d'elle-même). */
  endedAt: string | null
  active: boolean
}

type Row = { id: string; target: string; price: number; regular: number; message: string | null; startsAt: Date; endsAt: Date; endedAt: Date | null }

const isTarget = (value: string): value is PromotionTarget => (PROMOTION_TARGETS as readonly string[]).includes(value)
const isActive = (row: Row, now: Date) => row.endedAt === null && row.startsAt <= now && row.endsAt > now

function toDto(row: Row, now: Date): PromotionDto {
  return {
    id: row.id,
    target: isTarget(row.target) ? row.target : 'booster',
    price: row.price,
    regular: row.regular,
    message: row.message,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    active: isActive(row, now),
  }
}

/** Les promotions en cours, une au plus par article. */
export async function activePromotions(now = new Date()): Promise<PromotionDto[]> {
  const rows = await prisma.promotion.findMany({ where: { endedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { createdAt: 'desc' } })
  const seen = new Set<string>()
  return rows.filter((row) => isTarget(row.target) && !seen.has(row.target) && seen.add(row.target)).map((row) => toDto(row, now))
}

/** Prix du moment d'un article : celui de sa promotion en cours, sinon le prix habituel. */
export async function priceOf(target: PromotionTarget, now = new Date()): Promise<number> {
  const row = await prisma.promotion.findFirst({ where: { target, endedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { createdAt: 'desc' }, select: { price: true } })
  return row ? Math.min(row.price, REGULAR_PRICE[target]) : REGULAR_PRICE[target]
}

/** Historique pour l'administration : les plus récentes d'abord. */
export async function listPromotions(now = new Date()): Promise<PromotionDto[]> {
  const rows = await prisma.promotion.findMany({ orderBy: { createdAt: 'desc' }, take: 30 })
  return rows.map((row) => toDto(row, now))
}

const NOTIFY_CHUNK = 500

/**
 * Lance une promotion (elle remplace celle en cours sur le même article) et prévient
 * tous les comptes actifs. 400 si le prix n'est pas une vraie baisse.
 */
export async function createPromotion(
  admin: { id: string; email: string },
  input: { target: PromotionTarget; price: number; hours: number; message: string | null },
  now = new Date(),
): Promise<{ promotion: PromotionDto; notified: number }> {
  const regular = REGULAR_PRICE[input.target]
  if (!Number.isInteger(input.price) || input.price < 1 || input.price >= regular) throw badRequest(`Le prix promotionnel doit être compris entre 1 et ${regular - 1}.`, 'promotion_price')
  const hours = Math.min(PROMOTION_MAX_HOURS, Math.max(1, Math.round(input.hours)))
  const endsAt = new Date(now.getTime() + hours * 60 * 60 * 1000)
  const message = input.message?.trim().slice(0, PROMOTION_MESSAGE_MAX) || null
  const row = await prisma.$transaction(async (tx) => {
    await tx.promotion.updateMany({ where: { target: input.target, endedAt: null, endsAt: { gt: now } }, data: { endedAt: now } })
    const created = await tx.promotion.create({ data: { target: input.target, price: input.price, regular, message, startsAt: now, endsAt, createdBy: admin.id } })
    await tx.adminAction.create({
      data: { adminId: admin.id, adminEmail: admin.email, action: 'promotion', targetUserId: null, details: JSON.stringify({ target: input.target, price: input.price, regular, hours }) },
    })
    return created
  })
  // Tout le monde est prévenu, par paquets (hors transaction : la promotion vaut déjà).
  const payload = JSON.stringify({ promotionId: row.id, target: row.target, price: row.price, regular, endsAt: endsAt.toISOString(), message })
  let notified = 0
  let cursor: string | undefined
  for (;;) {
    const users = await prisma.user.findMany({
      where: { suspendedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: NOTIFY_CHUNK,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (users.length === 0) break
    const { count } = await prisma.notification.createMany({ data: users.map(({ id }) => ({ userId: id, type: 'promotion', data: payload, createdAt: now })) })
    notified += count
    cursor = users[users.length - 1]!.id
    if (users.length < NOTIFY_CHUNK) break
  }
  return { promotion: toDto(row, now), notified }
}

/** Arrête une promotion avant son terme. 404 si elle n'existe pas. */
export async function endPromotion(admin: { id: string; email: string }, id: string, now = new Date()): Promise<PromotionDto> {
  const row = await prisma.promotion.findUnique({ where: { id } })
  if (!row) throw notFound('Promotion introuvable.')
  if (!isActive(row, now)) return toDto(row, now)
  const ended = await prisma.$transaction(async (tx) => {
    const updated = await tx.promotion.update({ where: { id }, data: { endedAt: now } })
    await tx.adminAction.create({ data: { adminId: admin.id, adminEmail: admin.email, action: 'promotion_end', targetUserId: null, details: JSON.stringify({ target: row.target, price: row.price }) } })
    return updated
  })
  return toDto(ended, now)
}
