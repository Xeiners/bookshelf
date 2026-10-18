import { randomBytes } from 'node:crypto'
import { prisma } from '../../db.js'
import { notFound } from '../../lib/errors.js'
import { isGuestId } from '../dle/dle.guests.js'
import { parisDay } from '../dle/dle.logic.js'
import { receiptsFor } from '../higherlower/hl.service.js'
import { awardRecord, recordOf, type RecordRewardDto } from '../rewards/rewards.service.js'
import { creditStardust } from '../stardust/stardust.service.js'
import { publicAvatarUrl } from '../users/publicProfile.service.js'
import { STACK_DAILY_CAP, cappedReward, plausible, type StackClaim } from './stack.logic.js'

/*
 * Page Stack : le serveur ouvre une partie (identifiant), puis en reçoit le bilan. Une partie en
 * cours par joueur, en mémoire : un redémarrage la perd sans rien coûter. La fin inscrit les
 * records et crédite les Poussières, en une transaction ; un invité reçoit des reçus signés.
 */

interface Run {
  id: string
  startedAt: number
}

const runs = new Map<string, Run>()

export function startStackRun(userId: string, now = Date.now()): { id: string } {
  const run: Run = { id: randomBytes(9).toString('hex'), startedAt: now }
  runs.set(userId, run)
  return { id: run.id }
}

export interface StackResult {
  score: number
  pages: number
  perfects: number
  /** Poussières créditées, après plafond du jour. */
  reward: number
  capped: boolean
  balance: number
  best: number
  bestPages: number
  earnedToday: number
  record: boolean
  /** Invité : les Poussières gagnées, en reçus signés gardés sur l'appareil. */
  receipts: string[]
  /** Record de tous les temps battu : la récompense à choisir (un compte). */
  recordReward?: RecordRewardDto | null
}

interface GuestStats {
  best: number
  bestPages: number
  day: string
  dayEarned: number
  games: number
  touchedAt: number
}

const GUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000
const guests = new Map<string, GuestStats>()

function guestStatsOf(id: string, now: Date): GuestStats {
  for (const [key, stats] of guests) if (now.getTime() - stats.touchedAt > GUEST_TTL_MS) guests.delete(key)
  const day = parisDay(now)
  const stats = guests.get(id) ?? { best: 0, bestPages: 0, day, dayEarned: 0, games: 0, touchedAt: now.getTime() }
  if (stats.day !== day) Object.assign(stats, { day, dayEarned: 0 })
  stats.touchedAt = now.getTime()
  guests.set(id, stats)
  return stats
}

/** Bilan d'une partie : borné par le plausible, puis records et Poussières. 404 si la partie n'est pas (ou plus) la sienne. */
export async function finishStackRun(userId: string, runId: string, claim: StackClaim, now = new Date()): Promise<StackResult> {
  const run = runs.get(userId)
  if (!run || run.id !== runId) throw notFound('Partie introuvable.')
  runs.delete(userId)
  const { score, pages, perfects } = plausible(claim, now.getTime() - run.startedAt)

  if (isGuestId(userId)) {
    const stats = guestStatsOf(userId, now)
    const reward = cappedReward(score, stats.dayEarned)
    const record = score > stats.best
    stats.games += 1
    stats.dayEarned += reward
    stats.best = Math.max(stats.best, score)
    stats.bestPages = Math.max(stats.bestPages, pages)
    return {
      score, pages, perfects, reward, capped: reward < cappedReward(score, 0), balance: 0, best: stats.best, bestPages: stats.bestPages,
      earnedToday: stats.dayEarned, record: record && score > 0, receipts: receiptsFor(reward, now.getTime()),
    }
  }

  const day = parisDay(now)
  // Ligne créée HORS transaction : sous PostgreSQL, un échec de création annulerait la transaction.
  await prisma.stackStats.upsert({ where: { userId }, create: { userId }, update: {} }).catch(() => undefined)
  return prisma.$transaction(async (tx) => {
    const stats = await tx.stackStats.findUniqueOrThrow({ where: { userId } })
    const earnedBefore = stats.day === day ? stats.dayEarned : 0
    const reward = cappedReward(score, earnedBefore)
    const record = score > stats.best
    // Record de tous les temps battu : une récompense à choisir.
    const recordReward = record ? await awardRecord(tx, userId, 'stack', score, await recordOf.stack(tx)) : null
    const saved = await tx.stackStats.update({
      where: { userId },
      data: {
        games: { increment: 1 },
        totalPages: { increment: pages },
        perfects: { increment: perfects },
        day,
        dayEarned: earnedBefore + reward,
        ...(record ? { best: score, bestAt: now } : {}),
        ...(pages > stats.bestPages ? { bestPages: pages } : {}),
      },
    })
    const balance =
      reward > 0
        ? await creditStardust(tx, userId, reward, 'page_stack', { score, pages, perfects })
        : ((await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } }))?.stardust ?? 0)
    return {
      score, pages, perfects, reward, capped: reward < cappedReward(score, 0), balance, best: saved.best, bestPages: saved.bestPages,
      earnedToday: saved.dayEarned, record: record && score > 0, receipts: [], recordReward,
    }
  })
}

export interface StackStanding {
  rank: number
  userId: string
  name: string | null
  avatarUrl: string | null
  score: number
  me: boolean
}

export interface StackOverview {
  dailyCap: number
  me: { best: number; bestPages: number; earnedToday: number; games: number; totalPages: number; perfects: number }
  leaderboard: StackStanding[]
  myRank: number | null
}

export const STACK_LEADERBOARD_SIZE = 10

export async function stackOverview(userId: string, now = new Date()): Promise<StackOverview> {
  const day = parisDay(now)
  const [stats, top] = await Promise.all([
    isGuestId(userId) ? null : prisma.stackStats.findUnique({ where: { userId } }),
    prisma.stackStats.findMany({
      where: { best: { gt: 0 } },
      orderBy: [{ best: 'desc' }, { bestAt: 'asc' }],
      take: STACK_LEADERBOARD_SIZE,
      select: { userId: true, best: true, user: { select: { displayName: true, avatarUrl: true } } },
    }),
  ])
  const guest = isGuestId(userId) ? guestStatsOf(userId, now) : null
  const best = guest?.best ?? stats?.best ?? 0
  const ahead = !guest && best > 0 ? await prisma.stackStats.count({ where: { best: { gt: best } } }) : null
  return {
    dailyCap: STACK_DAILY_CAP,
    me: guest
      ? { best: guest.best, bestPages: guest.bestPages, earnedToday: guest.dayEarned, games: guest.games, totalPages: 0, perfects: 0 }
      : {
          best,
          bestPages: stats?.bestPages ?? 0,
          earnedToday: stats?.day === day ? stats.dayEarned : 0,
          games: stats?.games ?? 0,
          totalPages: stats?.totalPages ?? 0,
          perfects: stats?.perfects ?? 0,
        },
    // Rangs « olympiques » : deux scores égaux partagent le rang.
    leaderboard: top.map((row) => ({
      rank: top.findIndex((other) => other.best === row.best) + 1,
      userId: row.userId,
      name: row.user.displayName,
      avatarUrl: publicAvatarUrl(row.user.avatarUrl, row.userId),
      score: row.best,
      me: row.userId === userId,
    })),
    myRank: ahead === null ? null : ahead + 1,
  }
}
