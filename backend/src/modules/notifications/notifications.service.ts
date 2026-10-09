import { prisma } from '../../db.js'
import type { Prisma } from '../../generated/prisma/client.js'
import type { CardDto } from '../cards/cards.service.js'

/*
 * Notifications d'un compte : un échange conclu avec lui, une offre du marché
 * qui l'intéresse, un cadeau de l'équipe (boosters, carte). Le serveur ne rédige rien : il garde le type et les données
 * (instantanés des cartes, autre collectionneur), le front écrit la phrase dans
 * sa langue. Le front les relève en sondant `GET /api/notifications?since=` :
 * aucune connexion permanente à tenir derrière Caddy et Nginx.
 */

export const NOTIFICATION_TYPES = ['trade_accepted', 'trade_match', 'booster_gift', 'card_gift', 'card_share'] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export interface NotificationParty {
  id: string
  displayName: string | null
}

/** Un autre compte a accepté MON offre : l'échange est fait. */
export interface TradeAcceptedData {
  offerId: string
  /** Carte que je reçois (celle que je demandais). */
  received: CardDto
  /** Carte que je cède (mon doublon). */
  given: CardDto
  by: NotificationParty
}

/** Nouvelle offre au marché : elle propose une carte qui me manque, contre une carte que j'ai. */
export interface TradeMatchData {
  offerId: string
  /** Carte proposée : celle que je recevrais. */
  offered: CardDto
  /** Carte demandée : celle que je céderais. */
  requested: CardDto
  by: NotificationParty
}

/** Boosters offerts par l'équipe (administration). */
export interface BoosterGiftData {
  count: number
  /** Mot de l'équipe, facultatif. */
  message: string | null
}

/** Carte offerte par l'équipe (administration), ou par un autre membre (`from`). */
export interface CardGiftData {
  card: CardDto
  count: number
  message: string | null
  /** Membre qui l'offre ; absent : cadeau de l'équipe. */
  from?: NotificationParty | null
}

/** Un membre me montre des cartes qu'il vient d'obtenir (elles restent les siennes). */
export interface CardShareData {
  cards: CardDto[]
  by: NotificationParty
  message: string | null
}

interface DataOf {
  trade_accepted: TradeAcceptedData
  trade_match: TradeMatchData
  booster_gift: BoosterGiftData
  card_gift: CardGiftData
  card_share: CardShareData
}

export type NotificationDto = {
  [Type in NotificationType]: {
    id: string
    type: Type
    data: DataOf[Type]
    read: boolean
    createdAt: string
    /** Offre encore ouverte (`trade_match`) : sinon la notification ne mène plus nulle part. */
    active: boolean
  }
}[NotificationType]

/** Notifications renvoyées par liste, au plus. */
export const LIST_LIMIT = 50
/** Au-delà, une notification est effacée. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
/** Offres intéressantes signalées à un même compte par heure, au plus : un marché animé ne doit pas l'inonder. */
export const MATCH_BURST = 5
/** Comptes prévenus d'une même nouvelle offre, au plus. */
const MATCH_FANOUT = 200

type Client = Prisma.TransactionClient | typeof prisma

export const createNotification = <Type extends NotificationType>(client: Client, userId: string, type: Type, data: DataOf[Type]) =>
  client.notification.create({ data: { userId, type, data: JSON.stringify(data) } })

/**
 * Nouvelle offre : prévient les comptes à qui elle manque (ils n'ont pas la
 * carte proposée) et qui pourraient la remplir (ils ont la carte demandée).
 * Que la carte demandée soit encore LIBRE chez eux (pas réservée par leurs
 * propres offres), le marché le dira : c'est lui qui tranche, pas l'alerte.
 */
export async function notifyTradeMatch(data: TradeMatchData, ownerId: string, now = new Date()): Promise<number> {
  const holders = await prisma.userCard.findMany({
    where: {
      cardId: data.requested.id,
      userId: { not: ownerId },
      user: { cards: { none: { cardId: data.offered.id } } },
    },
    select: { userId: true },
    orderBy: { obtainedAt: 'desc' },
    take: MATCH_FANOUT,
  })
  if (holders.length === 0) return 0

  const recent = await prisma.notification.groupBy({
    by: ['userId'],
    where: {
      userId: { in: holders.map((holder) => holder.userId) },
      type: 'trade_match',
      createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
    },
    _count: { _all: true },
  })
  const saturated = new Set(recent.filter((row) => row._count._all >= MATCH_BURST).map((row) => row.userId))
  const recipients = holders.filter((holder) => !saturated.has(holder.userId))
  if (recipients.length === 0) return 0

  const payload = JSON.stringify(data)
  const { count } = await prisma.notification.createMany({
    data: recipients.map(({ userId }) => ({ userId, type: 'trade_match', data: payload, createdAt: now })),
  })
  return count
}

/** Données stockées, relues avec tolérance : une ligne illisible est écartée, pas la liste. */
function parseData(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const isType = (type: string): type is NotificationType => (NOTIFICATION_TYPES as readonly string[]).includes(type)

/**
 * Les notifications du compte, les plus récentes d'abord, et le nombre de non
 * lues. `since` : seulement celles créées après (sondage). Les plus anciennes
 * que la rétention sont effacées au passage.
 */
export async function listNotifications(userId: string, since?: Date, now = new Date()) {
  await prisma.notification.deleteMany({ where: { userId, createdAt: { lt: new Date(now.getTime() - RETENTION_MS) } } })
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...(since && { createdAt: { gt: since } }) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ])

  const parsed = rows.flatMap((row) => {
    const data = parseData(row.data)
    return data && isType(row.type) ? [{ row, type: row.type, data }] : []
  })

  // Offres signalées : encore ouvertes ?
  const matchIds = parsed.filter((item) => item.type === 'trade_match').map((item) => String(item.data.offerId))
  const open = matchIds.length
    ? new Set(
        (await prisma.tradeOffer.findMany({ where: { id: { in: matchIds }, status: 'OPEN' }, select: { id: true } })).map((offer) => offer.id),
      )
    : new Set<string>()

  // Les données ont été écrites par `createNotification` / `notifyTradeMatch` : leur forme suit le type.
  const notifications = parsed.map(
    ({ row, type, data }) =>
      ({
        id: row.id,
        type,
        data,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
        active: type === 'trade_match' ? open.has(String(data.offerId)) : true,
      }) as unknown as NotificationDto,
  )
  return { notifications, unread }
}

/** Marque comme lues : celles citées, ou toutes. Renvoie le nombre de non lues restantes. */
export async function markRead(userId: string, ids: readonly string[] | undefined, now = new Date()): Promise<number> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids && { id: { in: [...ids] } }) },
    data: { readAt: now },
  })
  return prisma.notification.count({ where: { userId, readAt: null } })
}

/** Efface une notification du compte (idempotent : celle d'un autre compte n'existe pas pour lui). */
export async function removeNotification(userId: string, id: string): Promise<number> {
  await prisma.notification.deleteMany({ where: { id, userId } })
  return prisma.notification.count({ where: { userId, readAt: null } })
}
