import { prisma } from '../../db.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { HttpError } from '../../lib/errors.js'
import { boosterStatus, type BoosterStatus } from '../cards/cards.service.js'
import { GUEST_CLAIM_CAP, readReceipt } from '../dle/dle.guests.js'

/*
 * Poussières d'Étoile : la monnaie du BookshelfDLE. Gagnées en résolvant les
 * énigmes, dépensées en boosters. Le solde vit sur le compte (`User.stardust`,
 * jamais négatif) ; chaque mouvement est inscrit dans `StardustEntry`.
 */

/** Prix d'un booster. Repère : une énigme du jour bien menée en rapporte ~60. */
export const BOOSTER_PRICE = 150

export type StardustReason = 'dle_daily' | 'dle_room' | 'higher_lower' | 'bomb_party' | 'booster_purchase' | 'guest_claim'

/** Crédite (ou débite, `amount` < 0) un compte et inscrit le mouvement, dans la transaction donnée. */
export async function creditStardust(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  reason: StardustReason,
  data: Record<string, unknown> = {},
): Promise<number> {
  const user = await tx.user.update({ where: { id: userId }, data: { stardust: { increment: amount } }, select: { stardust: true } })
  await tx.stardustEntry.create({ data: { userId, amount, reason, data: JSON.stringify(data) } })
  return user.stardust
}

export interface StardustEntryDto {
  id: string
  amount: number
  reason: StardustReason
  data: Record<string, unknown>
  createdAt: string
}

const parseData = (json: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(json)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export interface StardustWallet {
  balance: number
  boosterPrice: number
  /** Derniers mouvements, du plus récent au plus ancien. */
  history: StardustEntryDto[]
}

export async function walletOf(userId: string): Promise<StardustWallet> {
  const [user, entries] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { stardust: true } }),
    prisma.stardustEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ])
  return {
    balance: user?.stardust ?? 0,
    boosterPrice: BOOSTER_PRICE,
    history: entries.map((entry) => ({
      id: entry.id,
      amount: entry.amount,
      reason: entry.reason as StardustReason,
      data: parseData(entry.data),
      createdAt: entry.createdAt.toISOString(),
    })),
  }
}

/**
 * Achète un booster : `BOOSTER_PRICE` Poussières contre un booster de réserve (hors
 * plafond, jamais perdu, comme un booster offert). Atomique : le débit n'aboutit que si
 * le solde suffit au moment de l'écriture — deux achats simultanés ne dépensent jamais
 * deux fois les mêmes Poussières. 409 `not_enough_stardust` sinon.
 */
export async function buyBooster(userId: string): Promise<{ balance: number; status: BoosterStatus }> {
  const balance = await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId, stardust: { gte: BOOSTER_PRICE } },
      data: { stardust: { decrement: BOOSTER_PRICE } },
    })
    if (count === 0) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } })
      throw new HttpError(409, 'not_enough_stardust', 'Pas assez de Poussières d’Étoile.', {
        balance: user?.stardust ?? 0,
        price: BOOSTER_PRICE,
      })
    }
    await tx.userBooster.upsert({ where: { userId }, create: { userId, giftedBoosters: 1 }, update: { giftedBoosters: { increment: 1 } } })
    await tx.stardustEntry.create({ data: { userId, amount: -BOOSTER_PRICE, reason: 'booster_purchase' } })
    const user = await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } })
    return user?.stardust ?? 0
  })
  return { balance, status: await boosterStatus(userId) }
}

/**
 * Échange les reçus de Poussières gagnés en invité (cf. `dle.guests.ts`) : chacun
 * n'est accepté qu'une fois (tous comptes confondus), périmé au bout de 14 jours,
 * et un compte récupère au plus `GUEST_CLAIM_CAP` Poussières d'invité en tout.
 */
export async function claimGuestStardust(userId: string, tokens: readonly string[], now = Date.now()): Promise<{ balance: number; credited: number }> {
  const receipts = new Map<string, number>()
  for (const token of tokens) {
    const receipt = readReceipt(token, now)
    if (receipt) receipts.set(receipt.n, receipt.a)
  }
  const credited = await prisma.$transaction(async (tx) => {
    const claimed = await tx.stardustEntry.aggregate({ where: { userId, reason: 'guest_claim' }, _sum: { amount: true } })
    let room = Math.max(0, GUEST_CLAIM_CAP - (claimed._sum.amount ?? 0))
    let total = 0
    for (const [nonce, amount] of receipts) {
      if (room <= 0) break
      const used = await tx.stardustEntry.findFirst({ where: { reason: 'guest_claim', data: { contains: nonce } }, select: { id: true } })
      if (used) continue
      const take = Math.min(amount, room)
      await creditStardust(tx, userId, take, 'guest_claim', { receipt: nonce })
      room -= take
      total += take
    }
    return total
  })
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { stardust: true } })
  return { balance: user?.stardust ?? 0, credited }
}
