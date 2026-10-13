import { randomBytes } from 'node:crypto'
import { prisma } from '../../db.js'
import { HttpError, notFound } from '../../lib/errors.js'
import { isGuestId } from '../dle/dle.guests.js'
import { parisDay } from '../dle/dle.logic.js'
import { receiptsFor } from '../higherlower/hl.service.js'
import { creditStardust } from '../stardust/stardust.service.js'
import { publicAvatarUrl } from '../users/publicProfile.service.js'
import { QUIZ_REWARD, RUNNER_DAILY_CAP, cappedReward, plausible, reviveCost, scoreFor, type RunClaim } from './runner.logic.js'

/*
 * Manga Runner 3D (cf. `runner.logic.ts`) : le serveur ouvre une course (identifiant et
 * graine de la piste), puis en reçoit le bilan. Une course en cours par joueur, en
 * mémoire : un redémarrage la perd sans rien coûter. La fin inscrit les records et
 * crédite les Poussières, en une transaction ; un invité reçoit des reçus signés.
 */

interface Run {
  id: string
  userId: string
  seed: number
  startedAt: number
  /** Résurrections déjà payées pendant cette course. */
  revives: number
}

const runs = new Map<string, Run>()

export interface RunnerRunStart {
  id: string
  seed: number
}

export function startRunnerRun(userId: string, now = Date.now()): RunnerRunStart {
  const run: Run = { id: randomBytes(9).toString('hex'), userId, seed: randomBytes(4).readUInt32BE(0), startedAt: now, revives: 0 }
  runs.set(userId, run)
  return { id: run.id, seed: run.seed }
}

export interface RunnerRevive {
  /** Poussières payées pour cette résurrection, et le solde qui reste. */
  cost: number
  balance: number
  revives: number
  /** Prix de la suivante ; `null` : plus aucune possible pendant cette course. */
  nextCost: number | null
}

/**
 * Revivre après un choc fatal : la course continue, contre des Poussières du compte.
 * Débit atomique (comme l'achat d'un booster) : 409 `not_enough_stardust` si le solde ne
 * suffit pas, 409 `revive_limit` au-delà de trois résurrections. Les invités n'ont pas
 * de solde sur le serveur : 403.
 */
export async function reviveRunnerRun(userId: string, runId: string): Promise<RunnerRevive> {
  const run = runs.get(userId)
  if (!run || run.id !== runId) throw notFound('Course introuvable.')
  if (isGuestId(userId)) throw new HttpError(403, 'revive_account_only', 'Revivre demande un compte.')
  const cost = reviveCost(run.revives)
  if (cost === null) throw new HttpError(409, 'revive_limit', 'Plus de résurrection possible pendant cette course.')
  const balance = await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({ where: { id: userId, stardust: { gte: cost } }, data: { stardust: { decrement: cost } } })
    if (count === 0) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } })
      throw new HttpError(409, 'not_enough_stardust', 'Pas assez de Poussières d’Étoile.', { balance: user?.stardust ?? 0, price: cost })
    }
    await tx.stardustEntry.create({ data: { userId, amount: -cost, reason: 'runner_revive', data: JSON.stringify({ revive: run.revives + 1 }) } })
    return (await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } }))?.stardust ?? 0
  })
  run.revives += 1
  return { cost, balance, revives: run.revives, nextCost: reviveCost(run.revives) }
}

export interface RunnerResult {
  distance: number
  stardust: number
  quiz: number
  score: number
  /** Poussières créditées (✦ ramassées + bonus des quiz), après plafond du jour. */
  reward: number
  quizReward: number
  capped: boolean
  balance: number
  best: number
  bestDistance: number
  earnedToday: number
  record: boolean
  /** Invité : les Poussières gagnées, en reçus signés gardés sur l'appareil. */
  receipts: string[]
}

interface GuestStats {
  best: number
  bestDistance: number
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
  const stats = guests.get(id) ?? { best: 0, bestDistance: 0, day, dayEarned: 0, games: 0, touchedAt: now.getTime() }
  if (stats.day !== day) Object.assign(stats, { day, dayEarned: 0 })
  stats.touchedAt = now.getTime()
  guests.set(id, stats)
  return stats
}

/** Bilan d'une course : bornée par le plausible, puis records et Poussières. 404 si la course n'est pas (ou plus) la sienne. */
export async function finishRunnerRun(userId: string, runId: string, claim: RunClaim, now = new Date()): Promise<RunnerResult> {
  const run = runs.get(userId)
  if (!run || run.id !== runId) throw notFound('Course introuvable.')
  runs.delete(userId)
  const { distance, stardust, quiz } = plausible(claim, now.getTime() - run.startedAt)
  const score = scoreFor(distance, stardust, quiz)

  if (isGuestId(userId)) {
    const stats = guestStatsOf(userId, now)
    const reward = cappedReward(stardust, quiz, stats.dayEarned)
    const record = score > stats.best
    stats.games += 1
    stats.dayEarned += reward
    stats.best = Math.max(stats.best, score)
    stats.bestDistance = Math.max(stats.bestDistance, distance)
    return {
      distance, stardust, quiz, score, reward, quizReward: quiz * QUIZ_REWARD, capped: reward < cappedReward(stardust, quiz, 0),
      balance: 0, best: stats.best, bestDistance: stats.bestDistance, earnedToday: stats.dayEarned, record: record && score > 0,
      receipts: receiptsFor(reward, now.getTime()),
    }
  }

  const day = parisDay(now)
  // Ligne créée HORS transaction : sous PostgreSQL, un échec de création annulerait la transaction.
  await prisma.runnerStats.upsert({ where: { userId }, create: { userId }, update: {} }).catch(() => undefined)
  return prisma.$transaction(async (tx) => {
    const stats = await tx.runnerStats.findUniqueOrThrow({ where: { userId } })
    const earnedBefore = stats.day === day ? stats.dayEarned : 0
    const reward = cappedReward(stardust, quiz, earnedBefore)
    const record = score > stats.best
    const saved = await tx.runnerStats.update({
      where: { userId },
      data: {
        games: { increment: 1 },
        totalDistance: { increment: distance },
        day,
        dayEarned: earnedBefore + reward,
        ...(record ? { best: score, bestAt: now } : {}),
        ...(distance > stats.bestDistance ? { bestDistance: distance } : {}),
      },
    })
    const balance =
      reward > 0
        ? await creditStardust(tx, userId, reward, 'manga_runner', { distance, score, quiz })
        : ((await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } }))?.stardust ?? 0)
    return {
      distance, stardust, quiz, score, reward, quizReward: quiz * QUIZ_REWARD, capped: reward < cappedReward(stardust, quiz, 0),
      balance, best: saved.best, bestDistance: saved.bestDistance, earnedToday: saved.dayEarned, record: record && score > 0, receipts: [],
    }
  })
}

export interface RunnerStanding {
  rank: number
  userId: string
  name: string | null
  avatarUrl: string | null
  score: number
  me: boolean
}

export interface RunnerOverview {
  dailyCap: number
  quizReward: number
  me: { best: number; bestDistance: number; earnedToday: number; games: number; totalDistance: number }
  leaderboard: RunnerStanding[]
  myRank: number | null
}

export const RUNNER_LEADERBOARD_SIZE = 10

export async function runnerOverview(userId: string, now = new Date()): Promise<RunnerOverview> {
  const day = parisDay(now)
  const [stats, top] = await Promise.all([
    isGuestId(userId) ? null : prisma.runnerStats.findUnique({ where: { userId } }),
    prisma.runnerStats.findMany({
      where: { best: { gt: 0 } },
      orderBy: [{ best: 'desc' }, { bestAt: 'asc' }],
      take: RUNNER_LEADERBOARD_SIZE,
      select: { userId: true, best: true, user: { select: { displayName: true, avatarUrl: true } } },
    }),
  ])
  const guest = isGuestId(userId) ? guestStatsOf(userId, now) : null
  const best = guest?.best ?? stats?.best ?? 0
  const ahead = !guest && best > 0 ? await prisma.runnerStats.count({ where: { best: { gt: best } } }) : null
  return {
    dailyCap: RUNNER_DAILY_CAP,
    quizReward: QUIZ_REWARD,
    me: guest
      ? { best: guest.best, bestDistance: guest.bestDistance, earnedToday: guest.dayEarned, games: guest.games, totalDistance: 0 }
      : {
          best,
          bestDistance: stats?.bestDistance ?? 0,
          earnedToday: stats?.day === day ? stats.dayEarned : 0,
          games: stats?.games ?? 0,
          totalDistance: stats?.totalDistance ?? 0,
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
