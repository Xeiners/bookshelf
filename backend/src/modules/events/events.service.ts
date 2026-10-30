import { prisma } from '../../core/db.js'
import { badRequest, conflict, notFound } from '../../core/http/errors.js'
import { record, type Admin } from '../admin/admin.service.js'
import { boosterStatus, type BoosterStatus } from '../cards/cards.service.js'
import { creditStardust } from '../stardust/stardust.service.js'

/*
 * Événements de l'équipe : pour une fête (Halloween…), un administrateur écrit un mot et
 * choisit des cadeaux (boosters, packs Légendaire, Poussières d'Étoile). Chaque compte qui se
 * connecte pendant l'événement les découvre dans une fenêtre et les récupère, une seule fois.
 * Rien n'est distribué d'avance : un compte qui ne passe pas ne reçoit rien (et rien ne pèse
 * sur la base quand l'événement est lancé).
 */

export const EVENT_TITLE_MAX = 60
export const EVENT_MESSAGE_MAX = 400
/** Durée d'un événement (h) : d'une heure à deux semaines. */
export const EVENT_MAX_HOURS = 24 * 14
/** Cadeaux d'un événement, au plus. */
export const EVENT_MAX = { boosters: 10, legendaryPacks: 5, stardust: 10_000 } as const

export interface TeamEventDto {
  id: string
  title: string
  message: string
  boosters: number
  legendaryPacks: number
  stardust: number
  startsAt: string
  endsAt: string
  /** Arrêté avant son terme (`null` : il court, ou s'est terminé de lui-même). */
  endedAt: string | null
  active: boolean
}

export interface AdminTeamEventDto extends TeamEventDto {
  /** Comptes qui ont récupéré leurs cadeaux. */
  claims: number
}

type Row = { id: string; title: string; message: string; boosters: number; legendaryPacks: number; stardust: number; startsAt: Date; endsAt: Date; endedAt: Date | null }

const isActive = (row: Row, now: Date) => row.endedAt === null && row.startsAt <= now && row.endsAt > now
const activeWhere = (now: Date) => ({ endedAt: null, startsAt: { lte: now }, endsAt: { gt: now } })

function toDto(row: Row, now: Date): TeamEventDto {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    boosters: row.boosters,
    legendaryPacks: row.legendaryPacks,
    stardust: row.stardust,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    active: isActive(row, now),
  }
}

/** Les événements en cours dont ce compte n'a pas encore récupéré les cadeaux, les plus anciens d'abord. */
export async function pendingEvents(userId: string, now = new Date()): Promise<TeamEventDto[]> {
  const rows = await prisma.teamEvent.findMany({ where: { ...activeWhere(now), claims: { none: { userId } } }, orderBy: { createdAt: 'asc' } })
  return rows.map((row) => toDto(row, now))
}

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002'

/**
 * Récupère les cadeaux d'un événement : boosters offerts (hors plafond), packs Légendaire et
 * Poussières, d'un seul coup. 404 si l'événement est fini ou inconnu ; 409 `event_claimed` la
 * deuxième fois (l'unicité de `TeamEventClaim` tient même si deux appareils cliquent ensemble).
 */
export async function claimEvent(userId: string, eventId: string, now = new Date()): Promise<{ boosters: BoosterStatus; stardust: number | null }> {
  const event = await prisma.teamEvent.findUnique({ where: { id: eventId } })
  if (!event || !isActive(event, now)) throw notFound('Cet événement est terminé.')
  let stardust: number | null = null
  try {
    await prisma.$transaction(async (tx) => {
      await tx.teamEventClaim.create({ data: { eventId, userId, claimedAt: now } })
      if (event.boosters > 0 || event.legendaryPacks > 0) {
        await tx.userBooster.upsert({
          where: { userId },
          create: { userId, giftedBoosters: event.boosters, legendaryPacks: event.legendaryPacks },
          update: { giftedBoosters: { increment: event.boosters }, legendaryPacks: { increment: event.legendaryPacks } },
        })
      }
      if (event.stardust > 0) stardust = await creditStardust(tx, userId, event.stardust, 'team_event', { eventId })
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Cadeaux déjà récupérés.', 'event_claimed')
    throw error
  }
  return { boosters: await boosterStatus(userId, now), stardust }
}

/* ---- Administration ------------------------------------------------------------------- */

/** Historique pour l'administration : les plus récents d'abord, avec le nombre de comptes servis. */
export async function listEvents(now = new Date()): Promise<AdminTeamEventDto[]> {
  const rows = await prisma.teamEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 30, include: { _count: { select: { claims: true } } } })
  return rows.map((row) => ({ ...toDto(row, now), claims: row._count.claims }))
}

export interface EventInput {
  title: string
  message: string
  boosters: number
  legendaryPacks: number
  stardust: number
  hours: number
}

/** Lance un événement, tout de suite. 400 `event_empty` s'il n'offre rien. */
export async function createEvent(admin: Admin, input: EventInput, now = new Date()): Promise<AdminTeamEventDto> {
  const gifts = {
    boosters: Math.min(EVENT_MAX.boosters, Math.max(0, Math.round(input.boosters))),
    legendaryPacks: Math.min(EVENT_MAX.legendaryPacks, Math.max(0, Math.round(input.legendaryPacks))),
    stardust: Math.min(EVENT_MAX.stardust, Math.max(0, Math.round(input.stardust))),
  }
  if (gifts.boosters + gifts.legendaryPacks + gifts.stardust === 0) throw badRequest('Un événement offre au moins un cadeau.', 'event_empty')
  const title = input.title.trim().slice(0, EVENT_TITLE_MAX)
  const message = input.message.trim().slice(0, EVENT_MESSAGE_MAX)
  if (!title || !message) throw badRequest('Un titre et un message sont nécessaires.', 'event_text')
  const hours = Math.min(EVENT_MAX_HOURS, Math.max(1, Math.round(input.hours)))
  const endsAt = new Date(now.getTime() + hours * 60 * 60 * 1000)
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.teamEvent.create({ data: { title, message, ...gifts, startsAt: now, endsAt, createdBy: admin.id } })
    await record(tx, admin, 'event', null, { title, ...gifts, hours })
    return created
  })
  return { ...toDto(row, now), claims: 0 }
}

/** Arrête un événement avant son terme : ceux qui n'ont pas récupéré leurs cadeaux ne les verront plus. */
export async function endEvent(admin: Admin, id: string, now = new Date()): Promise<AdminTeamEventDto> {
  const row = await prisma.teamEvent.findUnique({ where: { id }, include: { _count: { select: { claims: true } } } })
  if (!row) throw notFound('Événement introuvable.')
  if (!isActive(row, now)) return { ...toDto(row, now), claims: row._count.claims }
  const ended = await prisma.$transaction(async (tx) => {
    const updated = await tx.teamEvent.update({ where: { id }, data: { endedAt: now } })
    await record(tx, admin, 'event_end', null, { title: row.title, claims: row._count.claims })
    return updated
  })
  return { ...toDto(ended, now), claims: row._count.claims }
}
