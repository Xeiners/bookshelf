import type { Prisma } from '../../../generated/prisma/client.js'
import { prisma } from '../../../core/db.js'
import { creditStardust } from '../../stardust/stardust.service.js'
import { parseFeatured } from '../../users/profile.service.js'
import { isRarity } from '../boosters.logic.js'
import { RETIRED_SERIES, seriesRetired } from '../series.js'
import { emptyTally, mergeSummaries, summarize, RETIREMENT_VALUE, type RarityTally, type RetiredCard, type RetirementSummary } from './retirement.logic.js'

/*
 * Retrait des Séries 1 et 2 : les cartes qu'un compte en possède sont converties en Poussières,
 * une fois pour toutes, dans UNE transaction (cartes retirées, Poussières créditées, bilan
 * enregistré). Sans double crédit possible : chaque carte n'est retirée que si son nombre
 * d'exemplaires n'a pas bougé depuis la lecture, sinon tout est annulé — deux conversions
 * simultanées du même compte (démarrage du serveur et requête de l'app) n'en font qu'une.
 *
 * Le bilan (`SeriesRetirement`) reste à montrer tant que l'animation n'a pas été vue jusqu'au bout
 * (`seenAt`) : recharger la page la rejoue, sans rien recréditer.
 */

export interface RetirementView extends RetirementSummary {
  /** Solde de Poussières actuel (fin du compteur de l'animation). */
  balance: number
  createdAt: string
}

/** Une conversion concurrente l'a emporté : rien n'est à refaire ici. */
class AlreadyRetired extends Error {}

const parse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const summaryOf = (row: { stardust: number; copies: number; cards: number; byRarity: string; highlights: string }): RetirementSummary => ({
  stardust: row.stardust,
  copies: row.copies,
  cards: row.cards,
  byRarity: { ...emptyTally(), ...parse<Partial<RarityTally>>(row.byRarity, {}) },
  highlights: parse<RetiredCard[]>(row.highlights, []),
})

async function convert(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
  // Ordre fixe : deux conversions simultanées verrouillent les lignes dans le même ordre (pas d'interblocage).
  const rows = await tx.userCard.findMany({ where: { userId, card: { series: { in: [...RETIRED_SERIES] } } }, include: { card: true }, orderBy: { cardId: 'asc' } })
  if (rows.length === 0) return false
  // Offres du Marché de ce compte autour d'une carte retirée : annulées (leurs exemplaires réservés sont convertis).
  await tx.tradeOffer.updateMany({
    where: { userId, status: 'OPEN', OR: [{ offeredCard: { series: { in: [...RETIRED_SERIES] } } }, { requestedCard: { series: { in: [...RETIRED_SERIES] } } }] },
    data: { status: 'CANCELLED' },
  })
  for (const row of rows) {
    const { count } = await tx.userCard.deleteMany({ where: { userId, cardId: row.cardId, count: row.count } })
    if (count !== 1) throw new AlreadyRetired()
  }
  const added = summarize(
    rows.flatMap((row): RetiredCard[] =>
      isRarity(row.card.rarity)
        ? [{ id: row.card.id, number: row.card.number, series: row.card.series, name: row.card.name || row.card.title, title: row.card.title, imageUrl: row.card.imageUrl, rarity: row.card.rarity, count: row.count }]
        : [],
    ),
  )
  // Avatar et vitrine du profil : une carte retirée les quitte.
  const user = await tx.user.findUnique({ where: { id: userId }, select: { avatarCardId: true, featuredCardIds: true } })
  const gone = new Set(rows.map((row) => row.cardId))
  if (user) {
    const featured = parseFeatured(user.featuredCardIds)
    if ((user.avatarCardId && gone.has(user.avatarCardId)) || featured.some((id) => gone.has(id))) {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(user.avatarCardId && gone.has(user.avatarCardId) && { avatarCardId: null }),
          featuredCardIds: JSON.stringify(featured.filter((id) => !gone.has(id))),
        },
      })
    }
  }
  if (added.stardust > 0) await creditStardust(tx, userId, added.stardust, 'series_retirement', { copies: added.copies, cards: added.cards })
  const existing = await tx.seriesRetirement.findUnique({ where: { userId } })
  const total = existing ? mergeSummaries(summaryOf(existing), added) : added
  const data = { stardust: total.stardust, copies: total.copies, cards: total.cards, byRarity: JSON.stringify(total.byRarity), highlights: JSON.stringify(total.highlights) }
  // De nouvelles cartes converties : l'animation est (re)montrée.
  if (existing) await tx.seriesRetirement.update({ where: { userId }, data: { ...data, seenAt: null } })
  else await tx.seriesRetirement.create({ data: { userId, ...data } })
  return true
}

/**
 * Convertit les cartes retirées d'un compte, s'il en a (sans effet tant que la Série 3 n'est pas
 * complète). Idempotent : `false` quand il n'y avait rien à convertir, ou qu'une conversion
 * concurrente l'a fait.
 */
export async function retireUser(userId: string): Promise<boolean> {
  if (!(await seriesRetired())) return false
  try {
    return await prisma.$transaction((tx) => convert(tx, userId))
  } catch (error) {
    if (error instanceof AlreadyRetired) return false
    // Bilan créé au même instant par une autre conversion (clé primaire) : elle l'a emporté.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return false
    throw error
  }
}

/**
 * Au démarrage du serveur : convertit les cartes retirées de tous les comptes, et annule les
 * offres du Marché qui en demandent encore (offres d'autres comptes, que la conversion d'un
 * compte n'atteint pas).
 */
export async function retireAll(): Promise<{ users: number; stardust: number }> {
  if (!(await seriesRetired())) return { users: 0, stardust: 0 }
  await prisma.tradeOffer.updateMany({
    where: { status: 'OPEN', OR: [{ offeredCard: { series: { in: [...RETIRED_SERIES] } } }, { requestedCard: { series: { in: [...RETIRED_SERIES] } } }] },
    data: { status: 'CANCELLED' },
  })
  const owners = await prisma.userCard.findMany({ where: { card: { series: { in: [...RETIRED_SERIES] } } }, distinct: ['userId'], select: { userId: true } })
  let users = 0
  for (const { userId } of owners) {
    if (await retireUser(userId)) users += 1
  }
  const stardust = users > 0 ? ((await prisma.seriesRetirement.aggregate({ _sum: { stardust: true } }))._sum.stardust ?? 0) : 0
  return { users, stardust }
}

/** Le bilan à montrer (animation pas encore vue), après avoir converti ce qui restait ; `null` sinon. */
export async function pendingRetirement(userId: string): Promise<RetirementView | null> {
  await retireUser(userId)
  const [row, user] = await Promise.all([
    prisma.seriesRetirement.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { stardust: true } }),
  ])
  if (!row || row.seenAt) return null
  return { ...summaryOf(row), balance: user?.stardust ?? 0, createdAt: row.createdAt.toISOString() }
}

/** L'animation a été vue jusqu'au bout : on ne la remontre plus. */
export async function acknowledgeRetirement(userId: string): Promise<void> {
  await prisma.seriesRetirement.updateMany({ where: { userId, seenAt: null }, data: { seenAt: new Date() } })
}

export { RETIREMENT_VALUE }
