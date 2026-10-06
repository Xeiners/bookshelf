import { prisma } from '../../db.js'
import { isGuestId } from '../dle/dle.guests.js'
import { parisDay } from '../dle/dle.logic.js'
import { receiptsFor } from '../higherlower/hl.service.js'
import { creditStardust } from '../stardust/stardust.service.js'
import type { BombMode } from './bomb.dictionary.js'
import { BOMB_DAILY_CAP, cappedReward } from './bomb.logic.js'

/*
 * Records et Poussières de l'Anime Bomb Party. Un compte : en base (`BombStats`), crédité
 * dans une transaction. Un invité : en mémoire, Poussières en reçus signés (comme le
 * Higher or Lower), que l'inscription échange contre de vraies Poussières.
 */

export interface BombRecords {
  bestClassic: number
  bestManga: number
  games: number
  wins: number
  earnedToday: number
  dailyCap: number
}

export interface BombReward {
  reward: number
  /** Le plafond du jour a rogné (ou annulé) la récompense. */
  capped: boolean
  /** Solde après la partie (0 pour un invité). */
  balance: number
  /** Invité : ses Poussières, en reçus signés. */
  receipts: string[]
  /** Nouveau record solo pour ce mode. */
  record: boolean
  best: number
}

interface GuestStats {
  bestClassic: number
  bestManga: number
  games: number
  wins: number
  day: string
  dayEarned: number
  touchedAt: number
}

const GUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000
const guests = new Map<string, GuestStats>()

function guestStatsOf(id: string, now: Date): GuestStats {
  for (const [key, stats] of guests) if (now.getTime() - stats.touchedAt > GUEST_TTL_MS) guests.delete(key)
  const day = parisDay(now)
  const stats = guests.get(id) ?? { bestClassic: 0, bestManga: 0, games: 0, wins: 0, day, dayEarned: 0, touchedAt: now.getTime() }
  if (stats.day !== day) Object.assign(stats, { day, dayEarned: 0 })
  stats.touchedAt = now.getTime()
  guests.set(id, stats)
  return stats
}

export async function bombRecords(playerId: string, now = new Date()): Promise<BombRecords> {
  if (isGuestId(playerId)) {
    const stats = guestStatsOf(playerId, now)
    return { bestClassic: stats.bestClassic, bestManga: stats.bestManga, games: stats.games, wins: stats.wins, earnedToday: stats.dayEarned, dailyCap: BOMB_DAILY_CAP }
  }
  const stats = await prisma.bombStats.findUnique({ where: { userId: playerId } })
  const sameDay = stats?.day === parisDay(now)
  return {
    bestClassic: stats?.bestClassic ?? 0,
    bestManga: stats?.bestManga ?? 0,
    games: stats?.games ?? 0,
    wins: stats?.wins ?? 0,
    earnedToday: sameDay ? (stats?.dayEarned ?? 0) : 0,
    dailyCap: BOMB_DAILY_CAP,
  }
}

/**
 * Fin de partie d'un joueur : `amount` Poussières visées (plafonnées au jour), et pour le
 * solo, le nombre de mots trouvés (record du mode) ; pour un salon, la victoire.
 */
export async function settleGame(
  playerId: string,
  game: { mode: BombMode; amount: number; solo?: number; won?: boolean },
  now = new Date(),
): Promise<BombReward> {
  const bestKey = game.mode === 'classic' ? 'bestClassic' : 'bestManga'
  if (isGuestId(playerId)) {
    const stats = guestStatsOf(playerId, now)
    const reward = cappedReward(game.amount, stats.dayEarned)
    const record = game.solo !== undefined && game.solo > stats[bestKey]
    stats.games += 1
    stats.dayEarned += reward
    if (game.won) stats.wins += 1
    if (record) stats[bestKey] = game.solo ?? 0
    return { reward, capped: reward < game.amount, balance: 0, receipts: receiptsFor(reward, now.getTime()), record, best: stats[bestKey] }
  }
  const day = parisDay(now)
  // Ligne créée hors transaction : sous PostgreSQL, un échec de création annulerait tout.
  await prisma.bombStats.upsert({ where: { userId: playerId }, create: { userId: playerId }, update: {} }).catch(() => undefined)
  return prisma.$transaction(async (tx) => {
    const stats = await tx.bombStats.findUniqueOrThrow({ where: { userId: playerId } })
    const earnedBefore = stats.day === day ? stats.dayEarned : 0
    const reward = cappedReward(game.amount, earnedBefore)
    const record = game.solo !== undefined && game.solo > stats[bestKey]
    const saved = await tx.bombStats.update({
      where: { userId: playerId },
      data: {
        games: { increment: 1 },
        ...(game.won ? { wins: { increment: 1 } } : {}),
        day,
        dayEarned: earnedBefore + reward,
        ...(record ? { [bestKey]: game.solo } : {}),
      },
    })
    const balance =
      reward > 0
        ? await creditStardust(tx, playerId, reward, 'bomb_party', { mode: game.mode, ...(game.solo !== undefined ? { words: game.solo } : { won: Boolean(game.won) }) })
        : ((await tx.user.findUnique({ where: { id: playerId }, select: { stardust: true } }))?.stardust ?? 0)
    return { reward, capped: reward < game.amount, balance, receipts: [], record, best: saved[bestKey] }
  })
}
