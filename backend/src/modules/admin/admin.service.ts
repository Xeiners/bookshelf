import { prisma } from '../../db.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { HttpError, badRequest, notFound } from '../../lib/errors.js'
import { forgetStanding } from '../../lib/sessionGuard.js'
import { boosterStatus, toCardDto, type BoosterStatus, type CardDto } from '../cards/cards.service.js'
import { createNotification } from '../notifications/notifications.service.js'
import { photoOwner, removeAvatar } from '../users/avatarUpload.js'
import { profileStats } from '../users/profile.service.js'
import type { ProfileStats } from '../users/titles.js'
import { isAdminEmail } from './admin.access.js'

/*
 * Administration : voir et chercher les comptes, leur offrir des boosters ou
 * des cartes, les suspendre, modérer leur profil. Chaque action est inscrite
 * au journal (`AdminAction`) et chaque cadeau prévient le compte (notification).
 */

export const ADMIN_ACTIONS = ['gift_boosters', 'gift_card', 'suspend', 'unsuspend', 'moderate'] as const
export type AdminActionType = (typeof ADMIN_ACTIONS)[number]

export interface Admin {
  id: string
  email: string
}

/** Boosters offerts d'un coup, au plus. */
export const MAX_GIFT_BOOSTERS = 20
/** Exemplaires d'une carte offerts d'un coup, au plus. */
export const MAX_GIFT_CARDS = 10
const USERS_PAGE = 30
const AUDIT_PAGE = 50
const DAY_MS = 24 * 60 * 60 * 1000

async function record(
  client: Prisma.TransactionClient | typeof prisma,
  admin: Admin,
  action: AdminActionType,
  targetUserId: string | null,
  details: Record<string, unknown>,
) {
  await client.adminAction.create({ data: { adminId: admin.id, adminEmail: admin.email, action, targetUserId, details: JSON.stringify(details) } })
}

const userNotFound = () => notFound('Compte introuvable.')

/* ---- Vue d'ensemble ------------------------------------------------------------------- */

export interface AdminOverview {
  users: number
  newThisWeek: number
  activeThisWeek: number
  suspended: number
  openOffers: number
  tradesThisWeek: number
  boostersOpened: number
}

export async function overview(now = new Date()): Promise<AdminOverview> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS)
  const [users, newThisWeek, activeThisWeek, suspended, openOffers, tradesThisWeek, opened] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { suspendedAt: { not: null } } }),
    prisma.tradeOffer.count({ where: { status: 'OPEN' } }),
    prisma.tradeOffer.count({ where: { status: 'COMPLETED', updatedAt: { gte: weekAgo } } }),
    prisma.user.aggregate({ _sum: { boostersOpened: true } }),
  ])
  return { users, newThisWeek, activeThisWeek, suspended, openOffers, tradesThisWeek, boostersOpened: opened._sum.boostersOpened ?? 0 }
}

/* ---- Comptes ------------------------------------------------------------------------------ */

export type UserFilter = 'all' | 'active' | 'suspended'

export interface AdminUserRow {
  id: string
  email: string
  displayName: string | null
  createdAt: string
  lastSeenAt: string | null
  suspended: boolean
  isAdmin: boolean
  /** Cartes différentes possédées. */
  cards: number
  /** Titres en bibliothèque. */
  library: number
  boostersOpened: number
}

const ROW_SELECT = {
  id: true,
  email: true,
  displayName: true,
  createdAt: true,
  lastSeenAt: true,
  suspendedAt: true,
  boostersOpened: true,
  _count: { select: { cards: true, entries: true } },
} satisfies Prisma.UserSelect

type Row = Prisma.UserGetPayload<{ select: typeof ROW_SELECT }>

const toRow = (user: Row): AdminUserRow => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  createdAt: user.createdAt.toISOString(),
  lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
  suspended: user.suspendedAt !== null,
  isAdmin: isAdminEmail(user.email),
  cards: user._count.cards,
  library: user._count.entries,
  boostersOpened: user.boostersOpened,
})

/**
 * Comptes, les plus récents d'abord, par pages (`cursor` = id du dernier reçu).
 * `q` cherche dans l'e-mail (toujours en minuscules) et le pseudo.
 */
export async function listUsers(options: { q?: string; filter?: UserFilter; cursor?: string }): Promise<{ users: AdminUserRow[]; next: string | null }> {
  const q = options.q?.trim() ?? ''
  const where: Prisma.UserWhereInput = {
    ...(q && {
      OR: [
        { email: { contains: q.toLowerCase() } },
        { displayName: { contains: q } },
        // SQLite compare les accents et la casse : la forme capitalisée attrape « alice » → « Alice ».
        { displayName: { contains: q.charAt(0).toUpperCase() + q.slice(1) } },
        { id: q },
      ],
    }),
    ...(options.filter === 'suspended' && { suspendedAt: { not: null } }),
    ...(options.filter === 'active' && { suspendedAt: null }),
  }
  const rows = await prisma.user.findMany({
    where,
    select: ROW_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: USERS_PAGE + 1,
    ...(options.cursor && { cursor: { id: options.cursor }, skip: 1 }),
  })
  const page = rows.slice(0, USERS_PAGE)
  return { users: page.map(toRow), next: rows.length > USERS_PAGE ? (page.at(-1)?.id ?? null) : null }
}

export interface AdminAuditEntry {
  id: string
  adminEmail: string
  targetUserId: string | null
  /** Pseudo ou e-mail du compte visé, s'il existe encore. */
  targetLabel: string | null
  action: AdminActionType
  details: Record<string, unknown>
  createdAt: string
}

export interface AdminUserDetail extends AdminUserRow {
  bio: string | null
  avatarUrl: string | null
  /** Photo personnelle stockée (sinon : couverture ou carte). */
  hasPhoto: boolean
  isProfilePublic: boolean
  preferredLanguage: string
  emailVerified: boolean
  suspendedAt: string | null
  suspendedReason: string | null
  boosters: BoosterStatus
  stats: ProfileStats
  openOffers: number
  tradesCompleted: number
  audit: AdminAuditEntry[]
}

export async function userDetail(userId: string): Promise<AdminUserDetail> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...ROW_SELECT, bio: true, avatarUrl: true, isProfilePublic: true, preferredLanguage: true, emailVerifiedAt: true, suspendedReason: true },
  })
  if (!user) throw userNotFound()
  // La recette (boosters illimités) ne concerne que l'ouverture : l'admin voit le vrai stock.
  const [boosters, stats, openOffers, tradesCompleted, audit] = await Promise.all([
    boosterStatus(userId, new Date(), false),
    profileStats(userId),
    prisma.tradeOffer.count({ where: { userId, status: 'OPEN' } }),
    prisma.tradeOffer.count({ where: { status: 'COMPLETED', OR: [{ userId }, { acceptedById: userId }] } }),
    auditLog({ userId }),
  ])
  return {
    ...toRow(user),
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    hasPhoto: photoOwner(user.avatarUrl) !== null,
    isProfilePublic: user.isProfilePublic,
    preferredLanguage: user.preferredLanguage,
    emailVerified: user.emailVerifiedAt !== null,
    suspendedAt: user.suspendedAt?.toISOString() ?? null,
    suspendedReason: user.suspendedReason,
    boosters,
    stats,
    openOffers,
    tradesCompleted,
    audit: audit.entries,
  }
}

async function requireUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, suspendedAt: true } })
  if (!user) throw userNotFound()
  return user
}

/* ---- Cadeaux ----------------------------------------------------------------------------- */

/** Boosters offerts : hors plafond, ils s'ajoutent au stock et ne se perdent jamais. Le compte est prévenu. */
export async function giftBoosters(admin: Admin, userId: string, count: number, message: string | null): Promise<BoosterStatus> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_GIFT_BOOSTERS) throw badRequest(`Entre 1 et ${MAX_GIFT_BOOSTERS} boosters.`)
  await requireUser(userId)
  await prisma.$transaction(async (tx) => {
    await tx.userBooster.upsert({
      where: { userId },
      create: { userId, giftedBoosters: count },
      update: { giftedBoosters: { increment: count } },
    })
    await createNotification(tx, userId, 'booster_gift', { count, message })
    await record(tx, admin, 'gift_boosters', userId, { count, message })
  })
  return boosterStatus(userId, new Date(), false)
}

/** Une carte précise, en `count` exemplaires (la première fois, elle entre dans l'album). */
export async function giftCard(admin: Admin, userId: string, cardId: string, count: number, message: string | null): Promise<{ card: CardDto; count: number }> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_GIFT_CARDS) throw badRequest(`Entre 1 et ${MAX_GIFT_CARDS} exemplaires.`)
  await requireUser(userId)
  const card = await prisma.card.findUnique({ where: { id: cardId } })
  if (!card) throw notFound('Carte inconnue.')
  const dto = toCardDto(card)
  const owned = await prisma.$transaction(async (tx) => {
    const row = await tx.userCard.upsert({
      where: { userId_cardId: { userId, cardId } },
      create: { userId, cardId, count },
      update: { count: { increment: count } },
    })
    await createNotification(tx, userId, 'card_gift', { card: dto, count, message })
    await record(tx, admin, 'gift_card', userId, { cardId, cardName: dto.name, rarity: dto.rarity, count, message })
    return row.count
  })
  return { card: dto, count: owned }
}

/* ---- Suspension -------------------------------------------------------------------------- */

/**
 * Suspend un compte : connexion refusée, toutes ses sessions coupées (version
 * incrémentée), ses offres au Marché retirées. Jamais un administrateur.
 */
export async function suspendUser(admin: Admin, userId: string, reason: string | null, now = new Date()): Promise<void> {
  const user = await requireUser(userId)
  if (isAdminEmail(user.email)) throw new HttpError(409, 'admin_protected', 'Un administrateur ne peut pas être suspendu.')
  if (user.suspendedAt) throw new HttpError(409, 'already_suspended', 'Ce compte est déjà suspendu.')
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { suspendedAt: now, suspendedReason: reason, sessionVersion: { increment: 1 } },
    })
    const { count } = await tx.tradeOffer.updateMany({ where: { userId, status: 'OPEN' }, data: { status: 'CANCELLED' } })
    await record(tx, admin, 'suspend', userId, { reason, offersCancelled: count })
  })
  forgetStanding(userId)
}

/** Réactive un compte. Ses anciennes sessions restent coupées : il se reconnecte. */
export async function unsuspendUser(admin: Admin, userId: string): Promise<void> {
  const user = await requireUser(userId)
  if (!user.suspendedAt) throw new HttpError(409, 'not_suspended', 'Ce compte n’est pas suspendu.')
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { suspendedAt: null, suspendedReason: null } })
    await record(tx, admin, 'unsuspend', userId, {})
  })
  forgetStanding(userId)
}

/* ---- Modération -------------------------------------------------------------------------- */

export interface Moderation {
  /** Pseudo effacé (le compte s'affiche alors comme « un collectionneur »). */
  displayName?: boolean
  bio?: boolean
  /** Avatar retiré (photo effacée du disque, couverture ou carte détachée). */
  avatar?: boolean
  /** Profil passé en privé. */
  makePrivate?: boolean
  /** Offres ouvertes au Marché annulées. */
  cancelOffers?: boolean
}

export async function moderateUser(admin: Admin, userId: string, moderation: Moderation): Promise<string[]> {
  await requireUser(userId)
  const applied = (Object.keys(moderation) as (keyof Moderation)[]).filter((key) => moderation[key] === true)
  if (applied.length === 0) throw badRequest('Rien à modérer.')
  const data: Prisma.UserUpdateInput = {
    ...(moderation.displayName && { displayName: null }),
    ...(moderation.bio && { bio: null }),
    ...(moderation.avatar && { avatarUrl: null, avatarCardId: null }),
    ...(moderation.makePrivate && { isProfilePublic: false }),
  }
  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) await tx.user.update({ where: { id: userId }, data })
    const cancelled = moderation.cancelOffers
      ? (await tx.tradeOffer.updateMany({ where: { userId, status: 'OPEN' }, data: { status: 'CANCELLED' } })).count
      : 0
    await record(tx, admin, 'moderate', userId, { fields: applied, ...(moderation.cancelOffers && { offersCancelled: cancelled }) })
  })
  if (moderation.avatar) await removeAvatar(userId)
  return applied
}

/* ---- Cartes (choix d'un cadeau) ------------------------------------------------------------ */

export async function searchCards(q: string): Promise<CardDto[]> {
  const query = q.trim()
  const cards = await prisma.card.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query } },
            { title: { contains: query } },
            { mangaTitle: { contains: query } },
            { name: { contains: query.charAt(0).toUpperCase() + query.slice(1) } },
            ...(/^\d+$/.test(query) ? [{ number: Number(query) }] : []),
          ],
        }
      : {},
    orderBy: { number: 'asc' },
    take: 40,
  })
  return cards.map(toCardDto)
}

/* ---- Journal ----------------------------------------------------------------------------- */

const parseDetails = (raw: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function auditLog(options: { userId?: string; cursor?: string }): Promise<{ entries: AdminAuditEntry[]; next: string | null }> {
  const rows = await prisma.adminAction.findMany({
    where: options.userId ? { targetUserId: options.userId } : {},
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: AUDIT_PAGE + 1,
    ...(options.cursor && { cursor: { id: options.cursor }, skip: 1 }),
  })
  const page = rows.slice(0, AUDIT_PAGE)
  const targetIds = [...new Set(page.map((row) => row.targetUserId).filter((id): id is string => id !== null))]
  const targets = new Map(
    (await prisma.user.findMany({ where: { id: { in: targetIds } }, select: { id: true, displayName: true, email: true } })).map((user) => [
      user.id,
      user.displayName ?? user.email,
    ]),
  )
  return {
    entries: page.map((row) => ({
      id: row.id,
      adminEmail: row.adminEmail,
      targetUserId: row.targetUserId,
      targetLabel: row.targetUserId ? (targets.get(row.targetUserId) ?? null) : null,
      action: row.action as AdminActionType,
      details: parseDetails(row.details),
      createdAt: row.createdAt.toISOString(),
    })),
    next: rows.length > AUDIT_PAGE ? (page.at(-1)?.id ?? null) : null,
  }
}
