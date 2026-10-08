import { prisma } from '../../db.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { HttpError, badRequest, conflict, notFound } from '../../lib/errors.js'
import type { Rarity } from '../cards/boosters.logic.js'
import { toCardDto, type CardDto } from '../cards/cards.service.js'
import { createNotification, notifyTradeMatch } from '../notifications/notifications.service.js'
import { parseFeatured } from '../users/profile.service.js'

/*
 * Marché d'échange de doublons. Un compte propose un doublon contre une carte
 * de même rareté ; un autre accepte, et les deux cartes changent de main dans
 * une seule transaction.
 *
 * Aucune carte ne se crée ni ne se perd, même sous des requêtes simultanées :
 * chaque écriture qui compte est CONDITIONNELLE (`updateMany … where`) et son
 * résultat vérifié. Une condition qui ne tient plus (offre déjà acceptée,
 * exemplaire parti ailleurs) fait échouer toute la transaction : rien n'est
 * écrit. Sous PostgreSQL, la ligne visée est verrouillée par la première
 * écriture ; la seconde attend, relit la condition et ne passe plus. SQLite
 * sérialise les écritures.
 *
 * Réservation : tant qu'une offre est ouverte, son exemplaire est réservé. On
 * ne propose une carte que s'il en reste au moins deux exemplaires LIBRES (un
 * pour l'offre, un que l'on garde), et on ne cède pas, pour accepter une
 * offre, un exemplaire réservé par ses propres offres.
 */

export const TRADE_STATUSES = ['OPEN', 'COMPLETED', 'CANCELLED'] as const
export type TradeStatus = (typeof TRADE_STATUSES)[number]

/** Offres ouvertes par compte, au plus. */
export const MAX_OPEN_OFFERS = 20
/** Offres renvoyées par le marché, au plus (les plus récentes). */
export const MARKET_LIMIT = 100
/** Historique de « Mes échanges ». */
const HISTORY_LIMIT = 40

export interface TradeParty {
  id: string
  /** Pseudo, `null` s'il n'en a pas (l'adresse e-mail ne quitte jamais le serveur). */
  displayName: string | null
}

export interface TradeOfferDto {
  id: string
  status: TradeStatus
  createdAt: string
  updatedAt: string
  offered: CardDto
  requested: CardDto
  owner: TradeParty
  acceptedBy: TradeParty | null
  /** Offre du compte qui regarde. */
  mine: boolean
  /** Le compte peut l'accepter : ce n'est pas son offre, et il a un exemplaire libre de la carte demandée. */
  canAccept: boolean
  /** Le compte possède déjà la carte proposée (il en aurait un doublon). */
  ownsOffered: boolean
}

export interface MarketFilter {
  rarity?: Rarity
  series?: 1 | 2 | 3
  /** Seulement les offres que le compte peut remplir. */
  fillable?: boolean
}

const OFFER_INCLUDE = {
  offeredCard: true,
  requestedCard: true,
  user: { select: { id: true, displayName: true } },
  acceptedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.TradeOfferInclude

type OfferRow = Prisma.TradeOfferGetPayload<{ include: typeof OFFER_INCLUDE }>

/** Ce que le compte possède, et ce que ses offres ouvertes réservent, par carte. */
interface Holdings {
  owned: Map<string, number>
  reserved: Map<string, number>
}

async function holdingsOf(client: Prisma.TransactionClient | typeof prisma, userId: string): Promise<Holdings> {
  const [cards, offers] = await Promise.all([
    client.userCard.findMany({ where: { userId }, select: { cardId: true, count: true } }),
    client.tradeOffer.groupBy({ by: ['offeredCardId'], where: { userId, status: 'OPEN' }, _count: { _all: true } }),
  ])
  return {
    owned: new Map(cards.map((card) => [card.cardId, card.count])),
    reserved: new Map(offers.map((offer) => [offer.offeredCardId, offer._count._all])),
  }
}

/**
 * Exemplaires qu'il faut posséder pour pouvoir CÉDER une carte : un de plus
 * que ceux réservés par ses offres ouvertes, et, s'il en réserve, un de plus
 * encore (on garde toujours un exemplaire d'une carte qu'on propose).
 */
export const requiredToGive = (reserved: number) => (reserved > 0 ? reserved + 2 : 1)

/** Exemplaires qu'il faut posséder pour PROPOSER une carte : un par offre ouverte, celle-ci comprise, plus un à garder. */
export const requiredToOffer = (reserved: number) => reserved + 2

const canGive = (holdings: Holdings, cardId: string) =>
  (holdings.owned.get(cardId) ?? 0) >= requiredToGive(holdings.reserved.get(cardId) ?? 0)

const party = (user: { id: string; displayName: string | null } | null): TradeParty | null =>
  user ? { id: user.id, displayName: user.displayName } : null

function toDto(row: OfferRow, viewerId: string, holdings: Holdings | null): TradeOfferDto {
  const mine = row.userId === viewerId
  return {
    id: row.id,
    status: row.status as TradeStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    offered: toCardDto(row.offeredCard),
    requested: toCardDto(row.requestedCard),
    owner: party(row.user)!,
    acceptedBy: party(row.acceptedBy),
    mine,
    canAccept: !mine && row.status === 'OPEN' && holdings !== null && canGive(holdings, row.requestedCardId),
    ownsOffered: (holdings?.owned.get(row.offeredCardId) ?? 0) > 0,
  }
}

/* ---- Lecture ---------------------------------------------------------------------- */

/** Offres ouvertes des autres comptes, les plus récentes d'abord. */
export async function listMarket(viewerId: string, filter: MarketFilter = {}): Promise<TradeOfferDto[]> {
  const cardFilter: Prisma.CardWhereInput = {
    ...(filter.rarity && { rarity: filter.rarity }),
    ...(filter.series && { series: filter.series }),
  }
  const [rows, holdings] = await Promise.all([
    prisma.tradeOffer.findMany({
      where: { status: 'OPEN', userId: { not: viewerId }, offeredCard: cardFilter },
      include: OFFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      // « Remplissables » : filtré ensuite en mémoire, on en lit donc davantage.
      take: filter.fillable ? MARKET_LIMIT * 5 : MARKET_LIMIT,
    }),
    holdingsOf(prisma, viewerId),
  ])
  const offers = rows.map((row) => toDto(row, viewerId, holdings))
  return (filter.fillable ? offers.filter((offer) => offer.canAccept) : offers).slice(0, MARKET_LIMIT)
}

/** « Mes échanges » : mes offres (ouvertes d'abord) et celles que j'ai acceptées. */
export async function listMine(userId: string): Promise<TradeOfferDto[]> {
  const [open, history, holdings] = await Promise.all([
    prisma.tradeOffer.findMany({ where: { userId, status: 'OPEN' }, include: OFFER_INCLUDE, orderBy: { createdAt: 'desc' } }),
    prisma.tradeOffer.findMany({
      where: { status: { not: 'OPEN' }, OR: [{ userId }, { acceptedById: userId }] },
      include: OFFER_INCLUDE,
      orderBy: { updatedAt: 'desc' },
      take: HISTORY_LIMIT,
    }),
    holdingsOf(prisma, userId),
  ])
  return [...open, ...history].map((row) => toDto(row, userId, holdings))
}

/* ---- Création ------------------------------------------------------------------------ */

export async function createOffer(userId: string, input: { offeredCardId: string; requestedCardId: string }): Promise<TradeOfferDto> {
  const { offeredCardId, requestedCardId } = input
  if (offeredCardId === requestedCardId) throw badRequest('Propose une autre carte que celle que tu demandes.', 'same_card')
  const [offered, requested] = await Promise.all([
    prisma.card.findUnique({ where: { id: offeredCardId }, select: { rarity: true } }),
    prisma.card.findUnique({ where: { id: requestedCardId }, select: { rarity: true } }),
  ])
  if (!offered || !requested) throw notFound('Carte inconnue.')
  if (offered.rarity !== requested.rarity) throw badRequest('Un échange se fait entre cartes de même rareté.', 'rarity_mismatch')

  const row = await prisma.$transaction(async (tx) => {
    // Verrou de la ligne « carte possédée » (écriture neutre) : deux créations simultanées sur le même
    // doublon passent l'une après l'autre, et la seconde voit la réservation de la première.
    const locked = await tx.userCard.updateMany({ where: { userId, cardId: offeredCardId }, data: { count: { increment: 0 } } })
    if (locked.count === 0) throw notDuplicate()
    const [owned, reserved, open, same] = await Promise.all([
      tx.userCard.findUnique({ where: { userId_cardId: { userId, cardId: offeredCardId } }, select: { count: true } }),
      tx.tradeOffer.count({ where: { userId, offeredCardId, status: 'OPEN' } }),
      tx.tradeOffer.count({ where: { userId, status: 'OPEN' } }),
      tx.tradeOffer.count({ where: { userId, offeredCardId, requestedCardId, status: 'OPEN' } }),
    ])
    if ((owned?.count ?? 0) < requiredToOffer(reserved)) throw notDuplicate()
    if (same > 0) throw conflict('Tu proposes déjà cet échange.', 'offer_exists')
    if (open >= MAX_OPEN_OFFERS) {
      throw new HttpError(409, 'offer_limit', `${MAX_OPEN_OFFERS} offres ouvertes au plus.`, { max: MAX_OPEN_OFFERS })
    }
    return tx.tradeOffer.create({ data: { userId, offeredCardId, requestedCardId }, include: OFFER_INCLUDE })
  })
  // Hors transaction : l'offre est publiée même si l'alerte échoue.
  await notifyTradeMatch(
    { offerId: row.id, offered: toCardDto(row.offeredCard), requested: toCardDto(row.requestedCard), by: party(row.user)! },
    userId,
  ).catch((error: unknown) => console.error('[trades] alerte de nouvelle offre impossible', error))
  return toDto(row, userId, await holdingsOf(prisma, userId))
}

const notDuplicate = () =>
  conflict('Il te faut au moins deux exemplaires libres de cette carte (tu en gardes toujours un).', 'not_duplicate')

/* ---- Échange ------------------------------------------------------------------------- */

export interface TradeResult {
  offer: TradeOfferDto
  /** Carte reçue par celui qui accepte. */
  received: CardDto
  /** Carte cédée par celui qui accepte. */
  given: CardDto
}

/** Retire un exemplaire ; au dernier, la carte quitte aussi l'avatar et la vitrine du profil. */
async function removeIfEmpty(tx: Prisma.TransactionClient, userId: string, cardId: string): Promise<void> {
  const { count } = await tx.userCard.deleteMany({ where: { userId, cardId, count: { lte: 0 } } })
  if (count === 0) return
  const user = await tx.user.findUnique({ where: { id: userId }, select: { avatarCardId: true, featuredCardIds: true } })
  if (!user) return
  const featured = parseFeatured(user.featuredCardIds)
  if (user.avatarCardId !== cardId && !featured.includes(cardId)) return
  await tx.user.update({
    where: { id: userId },
    data: {
      ...(user.avatarCardId === cardId && { avatarCardId: null }),
      featuredCardIds: JSON.stringify(featured.filter((id) => id !== cardId)),
    },
  })
}

/** Ajoute un exemplaire (première fois : la carte entre dans l'album). */
const receive = (tx: Prisma.TransactionClient, userId: string, cardId: string, now: Date) =>
  tx.userCard.upsert({
    where: { userId_cardId: { userId, cardId } },
    create: { userId, cardId, obtainedAt: now },
    update: { count: { increment: 1 } },
  })

/**
 * Accepte une offre : tout ou rien, dans une transaction.
 *  1. l'offre passe de OPEN à COMPLETED — un seul acceptant y parvient ;
 *  2. le créateur cède son doublon, s'il en a encore au moins deux ;
 *  3. celui qui accepte cède la carte demandée, sans toucher à ses exemplaires réservés ;
 *  4. chacun reçoit la carte de l'autre.
 */
export async function acceptOffer(offerId: string, responderId: string, now = new Date()): Promise<TradeResult> {
  const row = await prisma.$transaction(async (tx) => {
    const offer = await tx.tradeOffer.findUnique({ where: { id: offerId }, select: { userId: true, status: true, offeredCardId: true, requestedCardId: true } })
    if (!offer) throw notFound('Offre introuvable.')
    if (offer.userId === responderId) throw badRequest('Tu ne peux pas accepter ta propre offre.', 'own_offer')
    if (offer.status !== 'OPEN') throw offerClosed()
    const { userId: ownerId, offeredCardId, requestedCardId } = offer

    // 1. Clôture conditionnelle : c'est elle qui départage des acceptations simultanées.
    const closed = await tx.tradeOffer.updateMany({
      where: { id: offerId, status: 'OPEN' },
      data: { status: 'COMPLETED', acceptedById: responderId },
    })
    if (closed.count !== 1) throw offerClosed()

    // 2. Le créateur cède un exemplaire et en garde toujours un.
    const given = await tx.userCard.updateMany({
      where: { userId: ownerId, cardId: offeredCardId, count: { gte: 2 } },
      data: { count: { decrement: 1 } },
    })
    if (given.count !== 1) throw conflict('Le créateur de l’offre n’a plus ce doublon.', 'offer_unavailable')

    // 3. Celui qui accepte cède un exemplaire libre de la carte demandée.
    const reserved = await tx.tradeOffer.count({ where: { userId: responderId, offeredCardId: requestedCardId, status: 'OPEN' } })
    const taken = await tx.userCard.updateMany({
      where: { userId: responderId, cardId: requestedCardId, count: { gte: requiredToGive(reserved) } },
      data: { count: { decrement: 1 } },
    })
    if (taken.count !== 1) {
      throw conflict(
        reserved > 0 ? 'Cette carte est réservée par tes propres offres.' : 'Tu n’as pas la carte demandée.',
        'card_not_available',
      )
    }
    await removeIfEmpty(tx, responderId, requestedCardId)

    // 4. Chacun reçoit la carte de l'autre.
    await receive(tx, responderId, offeredCardId, now)
    await receive(tx, ownerId, requestedCardId, now)

    const closedOffer = await tx.tradeOffer.findUniqueOrThrow({ where: { id: offerId }, include: OFFER_INCLUDE })
    // Le créateur l'apprend : dans la transaction, pas d'échange sans sa notification.
    await createNotification(tx, ownerId, 'trade_accepted', {
      offerId,
      received: toCardDto(closedOffer.requestedCard),
      given: toCardDto(closedOffer.offeredCard),
      by: party(closedOffer.acceptedBy)!,
    })
    return closedOffer
  })
  const offer = toDto(row, responderId, await holdingsOf(prisma, responderId))
  return { offer, received: offer.offered, given: offer.requested }
}

const offerClosed = () => conflict('Cette offre n’est plus disponible.', 'offer_closed')

/* ---- Annulation ------------------------------------------------------------------------ */

/** Annule sa propre offre ouverte : son doublon redevient libre. */
export async function cancelOffer(offerId: string, userId: string): Promise<TradeOfferDto> {
  const { count } = await prisma.tradeOffer.updateMany({ where: { id: offerId, userId, status: 'OPEN' }, data: { status: 'CANCELLED' } })
  const row = await prisma.tradeOffer.findUnique({ where: { id: offerId }, include: OFFER_INCLUDE })
  // L'offre d'un autre compte n'existe pas pour celui-ci : 404, jamais 403.
  if (!row || row.userId !== userId) throw notFound('Offre introuvable.')
  if (count === 0) throw offerClosed()
  return toDto(row, userId, await holdingsOf(prisma, userId))
}
