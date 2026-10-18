import { prisma } from '../../db.js'
import { HttpError } from '../../lib/errors.js'
import { grantLegendaryPack, rewardPackPool, type PulledCard } from '../cards/cards.service.js'
import { nextParisMidnight, parisDay } from '../dle/dle.logic.js'
import { WELCOME_GIFT_BOXES } from '../runner/runner.wardrobe.js'
import { creditStardust } from '../stardust/stardust.service.js'
import { CYCLE_DAYS, calendarFor, planDaily, stateOf, type DailyBundle, type DailyDay, type DayState, type DailyRow } from './daily.logic.js'

export interface DailyDayDto extends DailyDay {
  state: DayState
}

export interface DailyStatus {
  /** Jour de Paris (`YYYY-MM-DD`). */
  today: string
  /** La case du jour n'est pas prise : le calendrier s'ouvre. */
  claimable: boolean
  /** Case du jour (à prendre) ou dernière prise. */
  day: number
  cycle: number
  /** Jours pris dans ce cycle. */
  streak: number
  bestStreak: number
  totalClaims: number
  /** Une série vient d'être perdue : le calendrier repart du jour 1. */
  broken: boolean
  /** Secondes avant minuit à Paris : la case suivante (ou la série perdue) se joue là. */
  secondsUntilReset: number
  calendar: DailyDayDto[]
}

const rowOf = (row: { streak: number; cycle: number; lastDay: string | null } | null): DailyRow | null => row

export async function dailyStatus(userId: string, now = new Date()): Promise<DailyStatus> {
  const today = parisDay(now)
  const row = await prisma.dailyReward.findUnique({ where: { userId } })
  const plan = planDaily(rowOf(row), today)
  return {
    today,
    claimable: plan.claimable,
    day: plan.day,
    cycle: plan.cycle,
    streak: plan.streak,
    bestStreak: row?.bestStreak ?? 0,
    totalClaims: row?.totalClaims ?? 0,
    broken: plan.broken,
    secondsUntilReset: Math.max(1, Math.ceil((nextParisMidnight(now).getTime() - now.getTime()) / 1000)),
    calendar: calendarFor(userId, plan.cycle).map((entry) => ({ ...entry, state: stateOf(plan, entry.day) })),
  }
}

export interface DailyClaim {
  day: number
  reward: DailyBundle
  /** Cartes du pack du 30e jour. */
  cards: PulledCard[]
  /** Solde de Poussières après la prise. */
  balance: number
  status: DailyStatus
}

/**
 * Prend la case du jour : crédite la récompense et avance la série, en une transaction. Une
 * seule fois par jour de Paris (deux appels simultanés ne la donnent pas deux fois) : 409
 * `daily_claimed` sinon.
 */
export async function claimDaily(userId: string, options: { now?: Date; random?: () => number } = {}): Promise<DailyClaim> {
  const now = options.now ?? new Date()
  const random = options.random ?? Math.random
  const today = parisDay(now)
  const row = await prisma.dailyReward.findUnique({ where: { userId } })
  const plan = planDaily(rowOf(row), today)
  if (!plan.claimable) throw new HttpError(409, 'daily_claimed', 'Récompense du jour déjà récupérée.')
  const entry = calendarFor(userId, plan.cycle)[plan.day - 1]!
  const { reward } = entry

  // Avant la transaction : le pack lit (et au besoin prépare) la collection de cartes ; la ligne des
  // statistiques du Runner se crée hors transaction (PostgreSQL), pour les boîtes.
  const pool = reward.pack ? await rewardPackPool(random) : null
  if (reward.boxes > 0) await prisma.runnerStats.upsert({ where: { userId }, create: { userId }, update: {} }).catch(() => undefined)

  const cards = await prisma.$transaction(async (tx) => {
    const progress = { streak: plan.day, cycle: plan.cycle, lastDay: today, totalClaims: (row?.totalClaims ?? 0) + 1, bestStreak: Math.max(row?.bestStreak ?? 0, plan.day) }
    if (!row) {
      try {
        await tx.dailyReward.create({ data: { userId, ...progress } })
      } catch {
        throw new HttpError(409, 'daily_claimed', 'Récompense du jour déjà récupérée.')
      }
    } else {
      // Verrou optimiste : la ligne doit être celle qu'on a lue.
      const { count } = await tx.dailyReward.updateMany({ where: { userId, lastDay: row.lastDay, streak: row.streak, cycle: row.cycle }, data: progress })
      if (count === 0) throw new HttpError(409, 'daily_claimed', 'Récompense du jour déjà récupérée.')
    }
    if (reward.stardust > 0) await creditStardust(tx, userId, reward.stardust, 'daily_reward', { day: plan.day, cycle: plan.cycle })
    if (reward.boosters > 0) {
      await tx.userBooster.upsert({ where: { userId }, create: { userId, giftedBoosters: reward.boosters }, update: { giftedBoosters: { increment: reward.boosters } } })
    }
    if (reward.boxes > 0) {
      await tx.runnerStats.upsert({ where: { userId }, create: { userId, giftBoxes: WELCOME_GIFT_BOXES + reward.boxes }, update: { giftBoxes: { increment: reward.boxes } } })
    }
    return pool ? grantLegendaryPack(tx, userId, pool.cards, { now, random }) : []
  })
  const { stardust: balance } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { stardust: true } })
  return { day: plan.day, reward, cards, balance, status: await dailyStatus(userId, now) }
}

export { CYCLE_DAYS }
