import { prisma } from '../../db.js'
import { badRequest, conflict } from '../../lib/errors.js'
import { creditStardust } from '../stardust/stardust.service.js'
import { isRarity, type Rarity } from './boosters.logic.js'
import { DUPLICATE_VALUE, MAX_CONVERT_CARDS, convertibleCopies, valueOf } from './duplicates.logic.js'

/*
 * Doublons → Poussières. Le serveur décide de tout : quels exemplaires sont libres (un gardé, un
 * réservé par offre ouverte au Marché), combien ils rendent, et le crédit. Chaque retrait est
 * CONDITIONNEL (`updateMany … where count >= …`) et vérifié : deux conversions simultanées, ou
 * une conversion et un échange, ne peuvent pas céder le même exemplaire. Tout ou rien.
 */

export interface DuplicateItem {
  cardId: string
  rarity: Rarity
  /** Exemplaires convertibles. */
  extra: number
  value: number
  isFavorite: boolean
}

export interface DuplicatesView {
  values: Record<Rarity, number>
  items: DuplicateItem[]
}

export interface ConversionResult {
  /** Poussières créditées. */
  gained: number
  /** Exemplaires convertis. */
  copies: number
  balance: number
  /** Détail par carte. */
  converted: { cardId: string; copies: number; value: number }[]
}

/** Ce que le compte peut convertir : ses cartes en plusieurs exemplaires, libres de toute offre. */
export async function duplicatesOf(userId: string): Promise<DuplicatesView> {
  const rows = await prisma.userCard.findMany({ where: { userId, count: { gt: 1 } }, include: { card: { select: { rarity: true } } } })
  const reserved = await reservedBy(userId)
  const items: DuplicateItem[] = []
  for (const row of rows) {
    if (!isRarity(row.card.rarity)) continue
    const extra = convertibleCopies(row.count, reserved.get(row.cardId) ?? 0)
    if (extra > 0) items.push({ cardId: row.cardId, rarity: row.card.rarity, extra, value: valueOf(row.card.rarity, extra), isFavorite: row.isFavorite })
  }
  return { values: DUPLICATE_VALUE, items }
}

async function reservedBy(userId: string): Promise<Map<string, number>> {
  const offers = await prisma.tradeOffer.groupBy({ by: ['offeredCardId'], where: { userId, status: 'OPEN' }, _count: { _all: true } })
  return new Map(offers.map((offer) => [offer.offeredCardId, offer._count._all]))
}

/** Ce qu'on convertit : `copies` exemplaires d'une carte, ou tous les doublons des raretés choisies (favoris exceptés). */
export type ConversionRequest = { cardId: string; copies: number } | { rarities: readonly Rarity[] }

export async function convertDuplicates(userId: string, request: ConversionRequest): Promise<ConversionResult> {
  return prisma.$transaction(async (tx) => {
    const reserved = new Map((await tx.tradeOffer.groupBy({ by: ['offeredCardId'], where: { userId, status: 'OPEN' }, _count: { _all: true } })).map((offer) => [offer.offeredCardId, offer._count._all]))
    const plan: { cardId: string; rarity: Rarity; copies: number }[] = []
    if ('cardId' in request) {
      const row = await tx.userCard.findUnique({ where: { userId_cardId: { userId, cardId: request.cardId } }, include: { card: { select: { rarity: true } } } })
      if (!row || !isRarity(row.card.rarity)) throw badRequest('Tu ne possèdes pas cette carte.', 'card_not_owned')
      const free = convertibleCopies(row.count, reserved.get(request.cardId) ?? 0)
      if (request.copies > free) throw conflict(free === 0 ? 'Aucun doublon libre pour cette carte (tu en gardes toujours un, et ceux de tes offres au Marché sont réservés).' : `Tu ne peux convertir que ${free} exemplaire${free > 1 ? 's' : ''} de cette carte.`, 'not_enough_duplicates')
      plan.push({ cardId: request.cardId, rarity: row.card.rarity, copies: request.copies })
    } else {
      const wanted = new Set(request.rarities)
      const rows = await tx.userCard.findMany({ where: { userId, count: { gt: 1 }, isFavorite: false, card: { rarity: { in: [...wanted] } } }, include: { card: { select: { rarity: true } } }, take: MAX_CONVERT_CARDS })
      for (const row of rows) {
        if (!isRarity(row.card.rarity)) continue
        const free = convertibleCopies(row.count, reserved.get(row.cardId) ?? 0)
        if (free > 0) plan.push({ cardId: row.cardId, rarity: row.card.rarity, copies: free })
      }
    }
    if (plan.length === 0) throw conflict('Aucun doublon à convertir.', 'no_duplicates')
    let gained = 0
    let copies = 0
    for (const step of plan) {
      // Un gardé, plus ceux que l'on réserve : la condition est relue par la base au moment du retrait.
      const taken = await tx.userCard.updateMany({
        where: { userId, cardId: step.cardId, count: { gte: step.copies + 1 + (reserved.get(step.cardId) ?? 0) } },
        data: { count: { decrement: step.copies } },
      })
      if (taken.count !== 1) throw conflict('Tes doublons ont changé entre-temps : réessaie.', 'duplicates_changed')
      gained += valueOf(step.rarity, step.copies)
      copies += step.copies
    }
    const balance = await creditStardust(tx, userId, gained, 'card_convert', { copies, cards: plan.length })
    return { gained, copies, balance, converted: plan.map((step) => ({ cardId: step.cardId, copies: step.copies, value: valueOf(step.rarity, step.copies) })) }
  })
}
