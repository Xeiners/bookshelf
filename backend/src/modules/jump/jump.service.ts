import { randomBytes } from 'node:crypto'
import { prisma } from '../../core/db.js'
import { notFound } from '../../core/http/errors.js'
import { isGuestId } from '../dle/dle.guests.js'
import { parisDay } from '../dle/dle.logic.js'
import { receiptsFor } from '../higherlower/hl.service.js'
import { awardRecord, recordOf, type RecordRewardDto } from '../rewards/rewards.service.js'
import { creditStardust } from '../stardust/stardust.service.js'
import { publicAvatarUrl } from '../users/publicProfile.service.js'
import { JUMP_DAILY_CAP, cappedReward, plausible, type JumpClaim } from './jump.logic.js'
import { charactersOf, type CharactersView } from './jump.characters.js'

/*
 * Page Jump : le serveur ouvre une partie (identifiant), puis en reçoit le bilan. Une partie en
 * cours par joueur, en mémoire : un redémarrage la perd sans rien coûter. La fin inscrit les
 * records et crédite les Poussières, en une transaction ; un invité reçoit des reçus signés.
 */

interface Run {
  id: string
  startedAt: number
}

const runs = new Map<string, Run>()

export function startJumpRun(userId: string, now = Date.now()): { id: string } {
  const run: Run = { id: randomBytes(9).toString('hex'), startedAt: now }
  runs.set(userId, run)
  return { id: run.id }
}

export interface JumpResult {
  score: number
  height: number
  stars: number
  stomps: number
  /** Poussières créditées, après plafond du jour. */
  reward: number
  capped: boolean
  balance: number
  best: number
  bestHeight: number
  earnedToday: number
  record: boolean
  /** Invité : les Poussières gagnées, en reçus signés gardés sur l'appareil. */
  receipts: string[]
  /** Record de tous les temps battu : la récompense à choisir (un compte). */
  recordReward?: RecordRewardDto | null
}

interface GuestStats {
  best: number
  bestHeight: number
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
  const stats = guests.get(id) ?? { best: 0, bestHeight: 0, day, dayEarned: 0, games: 0, touchedAt: now.getTime() }
  if (stats.day !== day) Object.assign(stats, { day, dayEarned: 0 })
  stats.touchedAt = now.getTime()
  guests.set(id, stats)
  return stats
}

/** Bilan d'une partie : borné par le plausible, puis records et Poussières. 404 si la partie n'est pas (ou plus) la sienne. */
export async function finishJumpRun(userId: string, runId: string, claim: JumpClaim, now = new Date()): Promise<JumpResult> {
  const run = runs.get(userId)
  if (!run || run.id !== runId) throw notFound('Partie introuvable.')
  runs.delete(userId)
  const { score, height, stars, stomps } = plausible(claim, now.getTime() - run.startedAt)

  if (isGuestId(userId)) {
    const stats = guestStatsOf(userId, now)
    const reward = cappedReward(score, stats.dayEarned)
    const record = score > stats.best
    stats.games += 1
    stats.dayEarned += reward
    stats.best = Math.max(stats.best, score)
    stats.bestHeight = Math.max(stats.bestHeight, height)
    return {
      score, height, stars, stomps, reward, capped: reward < cappedReward(score, 0), balance: 0, best: stats.best, bestHeight: stats.bestHeight,
      earnedToday: stats.dayEarned, record: record && score > 0, receipts: receiptsFor(reward, now.getTime()),
    }
  }

  const day = parisDay(now)
  // Ligne créée HORS transaction : sous PostgreSQL, un échec de création annulerait la transaction.
  await prisma.jumpStats.upsert({ where: { userId }, create: { userId }, update: {} }).catch(() => undefined)
  return prisma.$transaction(async (tx) => {
    const stats = await tx.jumpStats.findUniqueOrThrow({ where: { userId } })
    const earnedBefore = stats.day === day ? stats.dayEarned : 0
    const reward = cappedReward(score, earnedBefore)
    const record = score > stats.best
    // Record de tous les temps battu : une récompense à choisir.
    const recordReward = record ? await awardRecord(tx, userId, 'jump', score, await recordOf.jump(tx)) : null
    const saved = await tx.jumpStats.update({
      where: { userId },
      data: {
        games: { increment: 1 },
        stars: { increment: stars },
        stomps: { increment: stomps },
        day,
        dayEarned: earnedBefore + reward,
        ...(record ? { best: score, bestAt: now } : {}),
        ...(height > stats.bestHeight ? { bestHeight: height } : {}),
      },
    })
    const balance =
      reward > 0
        ? await creditStardust(tx, userId, reward, 'page_jump', { score, height, stars, stomps })
        : ((await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } }))?.stardust ?? 0)
    return {
      score, height, stars, stomps, reward, capped: reward < cappedReward(score, 0), balance, best: saved.best, bestHeight: saved.bestHeight,
      earnedToday: saved.dayEarned, record: record && score > 0, receipts: [], recordReward,
    }
  })
}

export interface JumpStanding {
  rank: number
  userId: string
  name: string | null
  avatarUrl: string | null
  score: number
  me: boolean
}

export interface JumpOverview {
  dailyCap: number
  me: { best: number; bestHeight: number; earnedToday: number; games: number }
  leaderboard: JumpStanding[]
  myRank: number | null
  /** Personnages possédés et choisi. */
  characters: CharactersView
}

export const JUMP_LEADERBOARD_SIZE = 10

export async function jumpOverview(userId: string, now = new Date()): Promise<JumpOverview> {
  const day = parisDay(now)
  const [stats, top, characters] = await Promise.all([
    isGuestId(userId) ? null : prisma.jumpStats.findUnique({ where: { userId } }),
    prisma.jumpStats.findMany({
      where: { best: { gt: 0 } },
      orderBy: [{ best: 'desc' }, { bestAt: 'asc' }],
      take: JUMP_LEADERBOARD_SIZE,
      select: { userId: true, best: true, user: { select: { displayName: true, avatarUrl: true } } },
    }),
    charactersOf(userId),
  ])
  const guest = isGuestId(userId) ? guestStatsOf(userId, now) : null
  const best = guest?.best ?? stats?.best ?? 0
  const ahead = !guest && best > 0 ? await prisma.jumpStats.count({ where: { best: { gt: best } } }) : null
  return {
    dailyCap: JUMP_DAILY_CAP,
    me: guest
      ? { best: guest.best, bestHeight: guest.bestHeight, earnedToday: guest.dayEarned, games: guest.games }
      : { best, bestHeight: stats?.bestHeight ?? 0, earnedToday: stats?.day === day ? stats.dayEarned : 0, games: stats?.games ?? 0 },
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
    characters,
  }
}
