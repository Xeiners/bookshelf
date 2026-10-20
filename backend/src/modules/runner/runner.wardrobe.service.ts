import { randomInt } from 'node:crypto'
import { prisma } from '../../core/db.js'
import { HttpError, badRequest, notFound } from '../../core/http/errors.js'
import { createNotification } from '../notifications/notifications.service.js'
import { priceOf } from '../promotions/promotions.service.js'
import { isGuestId } from '../dle/dle.guests.js'
import { creditStardust } from '../stardust/stardust.service.js'
import {
  BOX_PITY,
  BOX_PRICE,
  DUPLICATE_REFUND,
  FREE_BOX_MS,
  RARITY_WEIGHTS,
  WARDROBE,
  WARDROBE_SLOTS,
  WELCOME_GIFT_BOXES,
  readOutfit,
  rollBox,
  wardrobeItem,
  type Outfit,
  type WardrobeItem,
} from './runner.wardrobe.js'

/*
 * Garde-robe et boîtes mystère de l'aventurier (cf. `runner.wardrobe.ts`). Tout se joue sur
 * le serveur : débit des Poussières, tirage (aléa cryptographique), pièce ajoutée, doublon
 * remboursé, garantie légendaire — en une transaction. Les invités n'ont pas de garde-robe.
 */

export interface WardrobeView {
  items: readonly WardrobeItem[]
  /** Pièces possédées → exemplaires reçus. */
  owned: Record<string, number>
  outfit: Outfit
  /** Prix du moment (promotion comprise), et prix habituel. */
  price: number
  regular: number
  /** Prochaine boîte gratuite (ISO) ; `null` : disponible maintenant. */
  freeAt: string | null
  pity: number
  pityMax: number
  boxes: number
  /** Boîtes offertes à ouvrir (par d'autres membres, et celles de bienvenue). */
  gifts: number
  weights: Record<string, number>
  refunds: Record<string, number>
  balance: number
}

export interface BoxOpening {
  item: WardrobeItem
  duplicate: boolean
  refund: number
  guaranteed: boolean
  free: boolean
  source: BoxSource
  wardrobe: WardrobeView
}

/** D'où vient la boîte ouverte : la gratuite du jour, une payée, ou une offerte. */
export type BoxSource = 'free' | 'paid' | 'gift'

const random = () => randomInt(0, 2 ** 32) / 2 ** 32

function accountOnly(userId: string): void {
  if (isGuestId(userId)) throw new HttpError(403, 'wardrobe_account_only', 'La garde-robe demande un compte.')
}

/** La ligne de statistiques existe (créée HORS transaction : sous PostgreSQL, un échec l'annulerait). */
const ensureStats = (userId: string) => prisma.runnerStats.upsert({ where: { userId }, create: { userId }, update: {} }).catch(() => undefined)

export async function wardrobeView(userId: string, now = new Date()): Promise<WardrobeView> {
  accountOnly(userId)
  const [stats, rows, user, price] = await Promise.all([
    prisma.runnerStats.findUnique({ where: { userId } }),
    prisma.runnerItem.findMany({ where: { userId }, select: { itemId: true, count: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { stardust: true } }),
    priceOf('box', now),
  ])
  const owned = Object.fromEntries(rows.filter((row) => wardrobeItem(row.itemId)).map((row) => [row.itemId, row.count]))
  const nextFree = stats?.freeBoxAt ? stats.freeBoxAt.getTime() + FREE_BOX_MS : 0
  return {
    items: WARDROBE,
    owned,
    outfit: readOutfit(stats?.outfit ?? '{}', new Set(Object.keys(owned))),
    price,
    regular: BOX_PRICE,
    freeAt: nextFree > now.getTime() ? new Date(nextFree).toISOString() : null,
    pity: stats?.boxPity ?? 0,
    pityMax: BOX_PITY,
    boxes: stats?.boxes ?? 0,
    gifts: stats?.giftBoxes ?? WELCOME_GIFT_BOXES,
    weights: RARITY_WEIGHTS,
    refunds: DUPLICATE_REFUND,
    balance: user?.stardust ?? 0,
  }
}

/**
 * Ouvre une boîte : gratuite (409 `free_box_not_ready` avant 24 h), offerte (409
 * `no_gift_box` s'il n'y en a pas) ou payée (409 `not_enough_stardust`). La pièce tirée
 * rejoint la garde-robe ; un doublon rend des Poussières.
 */
export async function openBox(userId: string, source: BoxSource, now = new Date()): Promise<BoxOpening> {
  accountOnly(userId)
  await ensureStats(userId)
  const free = source === 'free'
  const price = source === 'paid' ? await priceOf('box', now) : 0
  const result = await prisma.$transaction(async (tx) => {
    if (source === 'gift') {
      const { count } = await tx.runnerStats.updateMany({ where: { userId, giftBoxes: { gt: 0 } }, data: { giftBoxes: { decrement: 1 } } })
      if (count === 0) throw new HttpError(409, 'no_gift_box', 'Aucune boîte offerte à ouvrir.')
    } else if (free) {
      const { count } = await tx.runnerStats.updateMany({
        where: { userId, OR: [{ freeBoxAt: null }, { freeBoxAt: { lte: new Date(now.getTime() - FREE_BOX_MS) } }] },
        data: { freeBoxAt: now },
      })
      if (count === 0) {
        const stats = await tx.runnerStats.findUnique({ where: { userId }, select: { freeBoxAt: true } })
        const at = new Date((stats?.freeBoxAt?.getTime() ?? now.getTime()) + FREE_BOX_MS).toISOString()
        throw new HttpError(409, 'free_box_not_ready', 'La boîte gratuite n’est pas encore prête.', { freeAt: at })
      }
    } else {
      const { count } = await tx.user.updateMany({ where: { id: userId, stardust: { gte: price } }, data: { stardust: { decrement: price } } })
      if (count === 0) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } })
        throw new HttpError(409, 'not_enough_stardust', 'Pas assez de Poussières d’Étoile.', { balance: user?.stardust ?? 0, price })
      }
      await tx.stardustEntry.create({ data: { userId, amount: -price, reason: 'runner_box' } })
    }
    const stats = await tx.runnerStats.findUniqueOrThrow({ where: { userId }, select: { boxPity: true } })
    const rows = await tx.runnerItem.findMany({ where: { userId }, select: { itemId: true } })
    const roll = rollBox(random, new Set(rows.map((row) => row.itemId)), stats.boxPity)
    await tx.runnerItem.upsert({
      where: { userId_itemId: { userId, itemId: roll.item.id } },
      create: { userId, itemId: roll.item.id },
      update: { count: { increment: 1 } },
    })
    await tx.runnerStats.update({
      where: { userId },
      data: { boxes: { increment: 1 }, boxPity: roll.item.rarity === 'legendary' ? 0 : { increment: 1 } },
    })
    if (roll.refund > 0) await creditStardust(tx, userId, roll.refund, 'runner_refund', { item: roll.item.id })
    return roll
  })
  return { ...result, free, source, wardrobe: await wardrobeView(userId, now) }
}

/** Équipe une tenue : chaque pièce doit être possédée et à son emplacement (400 sinon). */
export async function setOutfit(userId: string, outfit: Partial<Record<string, string | null>>, now = new Date()): Promise<WardrobeView> {
  accountOnly(userId)
  await ensureStats(userId)
  const rows = await prisma.runnerItem.findMany({ where: { userId }, select: { itemId: true } })
  const owned = new Set(rows.map((row) => row.itemId))
  const next: Outfit = {}
  for (const slot of WARDROBE_SLOTS) {
    const id = outfit[slot]
    if (id === null || id === undefined) continue
    const item = wardrobeItem(id)
    if (!item || item.slot !== slot || !owned.has(id)) throw new HttpError(400, 'item_not_owned', 'Pièce inconnue ou pas encore obtenue.')
    next[slot] = id
  }
  await prisma.runnerStats.update({ where: { userId }, data: { outfit: JSON.stringify(next) } })
  return wardrobeView(userId, now)
}

/** Longueur maximale du mot joint à une boîte offerte. */
export const GIFT_NOTE_MAX = 140

/**
 * Offrir une boîte à un autre membre : l'expéditeur la paie (prix d'une boîte), le
 * destinataire la trouve dans sa garde-robe (`gifts`) et reçoit une notification. 400 pour
 * soi-même, 404 pour un membre introuvable, 409 `not_enough_stardust`.
 */
export async function giftBox(senderId: string, recipientId: string, message: string | null, now = new Date()): Promise<WardrobeView> {
  accountOnly(senderId)
  if (senderId === recipientId) throw badRequest('Tu ne peux pas t’offrir une boîte à toi-même.', 'gift_self')
  const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { id: true, suspendedAt: true } })
  if (!recipient || recipient.suspendedAt) throw notFound('Ce membre est introuvable.')
  await ensureStats(recipientId)
  const note = message?.trim().slice(0, GIFT_NOTE_MAX) || null
  const price = await priceOf('box', now)
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({ where: { id: senderId, stardust: { gte: price } }, data: { stardust: { decrement: price } } })
    if (count === 0) {
      const user = await tx.user.findUnique({ where: { id: senderId }, select: { stardust: true } })
      throw new HttpError(409, 'not_enough_stardust', 'Pas assez de Poussières d’Étoile.', { balance: user?.stardust ?? 0, price })
    }
    await tx.stardustEntry.create({ data: { userId: senderId, amount: -price, reason: 'runner_gift', data: JSON.stringify({ to: recipientId }) } })
    await tx.runnerStats.update({ where: { userId: recipientId }, data: { giftBoxes: { increment: 1 } } })
    const sender = await tx.user.findUnique({ where: { id: senderId }, select: { id: true, displayName: true } })
    await createNotification(tx, recipientId, 'box_gift', { from: { id: senderId, displayName: sender?.displayName ?? null }, message: note })
  })
  return wardrobeView(senderId, now)
}
