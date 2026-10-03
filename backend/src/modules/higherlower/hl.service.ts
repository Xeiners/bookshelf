import { randomBytes } from 'node:crypto'
import { prisma } from '../../db.js'
import { HttpError, notFound } from '../../lib/errors.js'
import { characterImageUrl } from '../dle/dle.games.js'
import { isGuestId, signReceipt } from '../dle/dle.guests.js'
import { parisDay } from '../dle/dle.logic.js'
import { creditStardust } from '../stardust/stardust.service.js'
import { publicAvatarUrl } from '../users/publicProfile.service.js'
import { workCover } from './hl.covers.js'
import { HL_ENTRIES, HL_METRICS, isHlMetric, type HlEntry, type HlMetric } from './hl.data.js'
import { HL_DAILY_CAP, HL_LIVES, HL_TIERS, cappedReward, historyWindow, isCorrect, pickChallenger, pickOpening, recentWindow, remember } from './hl.logic.js'

/*
 * Higher or Lower (cf. `hl.logic.ts`) : le SERVEUR tire les cartes et garde la valeur
 * de la carte B jusqu'à la réponse — impossible de lire la solution dans le réseau.
 * Une partie en cours par compte, en mémoire (comme les salons du BookshelfDLE) : un
 * redémarrage la perd, sans rien coûter. La fin d'une partie (erreur ou abandon)
 * inscrit les records et crédite les Poussières, en une transaction.
 * Les cartes vues sont aussi retenues d'une partie à l'autre (en mémoire, par joueur
 * et par métrique) : la partie suivante tire d'abord parmi celles qu'on n'a pas vues.
 */

export interface HlCard {
  id: string
  name: string
  image: string | null
  /** Inconnue (`null`) tant que la carte est à deviner. */
  value: number | null
}

export interface HlRunView {
  id: string
  metric: HlMetric
  /** Bonnes réponses de la partie (une erreur pardonnée ne les efface pas). */
  streak: number
  /** Chances restantes. */
  lives: number
  current: HlCard
  next: HlCard
}

export interface HlResult {
  streak: number
  metric: HlMetric
  reward: number
  /** Solde après la partie. */
  balance: number
  best: number
  todayBest: number
  earnedToday: number
  /** Nouveau record de tous les temps / du jour. */
  record: boolean
  dayRecord: boolean
  /** Le plafond du jour a rogné (ou annulé) la récompense. */
  capped: boolean
  /** Invité : les Poussières gagnées, en reçus signés gardés sur l'appareil (vide pour un compte). */
  receipts: string[]
}

export interface HlGuessResult {
  correct: boolean
  /** Valeur de la carte devinée. */
  value: number
  streak: number
  /** Chances restantes après cette réponse. */
  lives: number
  /** La partie continue (juste, ou faux avec une chance en réserve) : la carte suivante à deviner. */
  next: HlCard | null
  /** La partie est finie (faux sans chance, ou plus de carte à tirer). */
  result: HlResult | null
}

interface Run {
  id: string
  userId: string
  metric: HlMetric
  pool: readonly HlEntry[]
  current: HlEntry
  next: HlEntry
  streak: number
  lives: number
  recent: string[]
  touchedAt: number
}

/** Une partie sans réponse depuis 30 min est oubliée. */
const RUN_TTL_MS = 30 * 60 * 1000
const runs = new Map<string, Run>()

/** Historique des cartes vues, d'une partie à l'autre ; oublié après une semaine sans jouer. */
const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const histories = new Map<string, { ids: string[]; touchedAt: number }>()
const historyKey = (userId: string, metric: HlMetric) => `${userId}:${metric}`

function sweep(now: number): void {
  for (const [userId, run] of runs) if (now - run.touchedAt > RUN_TTL_MS) runs.delete(userId)
  for (const [key, history] of histories) if (now - history.touchedAt > HISTORY_TTL_MS) histories.delete(key)
}

const seenBefore = (userId: string, metric: HlMetric): ReadonlySet<string> => new Set(histories.get(historyKey(userId, metric))?.ids)

function markSeen(run: Run, ids: readonly string[], now: number): void {
  const key = historyKey(run.userId, run.metric)
  histories.set(key, { ids: remember(histories.get(key)?.ids ?? [], ids, historyWindow(run.pool.length)), touchedAt: now })
}

export function cardOf(entry: HlEntry, revealed: boolean): HlCard {
  const image = entry.character ? characterImageUrl('onepiece', entry.character) : workCover(entry.id)
  return { id: entry.id, name: entry.name, image, value: revealed ? entry.value : null }
}

function viewOf(run: Run): HlRunView {
  return { id: run.id, metric: run.metric, streak: run.streak, lives: run.lives, current: cardOf(run.current, true), next: cardOf(run.next, false) }
}

const runOf = (userId: string, runId: string): Run => {
  sweep(Date.now())
  const run = runs.get(userId)
  if (!run || run.id !== runId) throw notFound('Partie terminée ou introuvable.')
  return run
}

/** Nouvelle partie dans une métrique. Une partie encore en cours se termine d'abord (records, Poussières). */
export async function startRun(userId: string, metric: HlMetric, random: () => number = Math.random, now = new Date()): Promise<HlRunView> {
  const previous = runs.get(userId)
  if (previous) await finishRun(previous, now)
  sweep(now.getTime())
  const pool = HL_ENTRIES[metric]
  const stale = seenBefore(userId, metric)
  const current = pickOpening(pool, random, stale)
  const next = current ? pickChallenger(pool, current, 0, new Set(), random, stale) : null
  if (!current || !next) throw new HttpError(503, 'hl_unavailable', 'Pas assez de cartes dans cette catégorie.')
  const run: Run = { id: randomBytes(9).toString('hex'), userId, metric, pool, current, next, streak: 0, lives: HL_LIVES, recent: [current.id], touchedAt: now.getTime() }
  runs.set(userId, run)
  markSeen(run, [current.id, next.id], now.getTime())
  return viewOf(run)
}

/**
 * Plus haut ou plus bas ? Juste : +1, la carte B devient la référence, une nouvelle
 * arrive. Faux avec une chance en réserve : la chance part, la partie continue de même
 * (la série n'est pas effacée). Faux sans chance : fin de partie.
 */
export async function guessRun(userId: string, runId: string, choice: 'higher' | 'lower', random: () => number = Math.random, now = new Date()): Promise<HlGuessResult> {
  const run = runOf(userId, runId)
  const guessed = run.next
  const correct = isCorrect(choice, run.current.value, guessed.value)
  if (!correct && run.lives === 0) {
    return { correct, value: guessed.value, streak: run.streak, lives: 0, next: null, result: await finishRun(run, now) }
  }
  if (correct) run.streak += 1
  else run.lives -= 1
  run.recent = [...run.recent, guessed.id].slice(-recentWindow(run.pool.length))
  const challenger = pickChallenger(run.pool, guessed, run.streak, new Set(run.recent), random, seenBefore(userId, run.metric))
  if (!challenger) return { correct, value: guessed.value, streak: run.streak, lives: run.lives, next: null, result: await finishRun(run, now) }
  run.current = guessed
  run.next = challenger
  run.touchedAt = now.getTime()
  markSeen(run, [challenger.id], now.getTime())
  return { correct, value: guessed.value, streak: run.streak, lives: run.lives, next: cardOf(challenger, false), result: null }
}

/** Arrêter en cours de route : la série compte comme si elle s'arrêtait là. */
export async function endRun(userId: string, runId: string, now = new Date()): Promise<HlResult> {
  return finishRun(runOf(userId, runId), now)
}

/* ---- Invités ----------------------------------------------------------------------- */

/**
 * Un invité (pseudo du BookshelfDLE, cf. `dle.guests.ts`) joue comme un compte, mais
 * rien n'est écrit en base : ses records vivent en mémoire (perdus au redémarrage) et
 * il n'entre pas au classement. Ses Poussières lui reviennent en reçus signés, que
 * l'inscription (ou la connexion) échange contre de vraies Poussières.
 */
interface GuestStats {
  best: number
  day: string
  dayBest: number
  dayEarned: number
  games: number
  touchedAt: number
}

const GUEST_STATS_TTL_MS = 7 * 24 * 60 * 60 * 1000
const guestStats = new Map<string, GuestStats>()

function guestStatsOf(id: string, now: Date): GuestStats {
  for (const [key, stats] of guestStats) if (now.getTime() - stats.touchedAt > GUEST_STATS_TTL_MS) guestStats.delete(key)
  const day = parisDay(now)
  const stats = guestStats.get(id) ?? { best: 0, day, dayBest: 0, dayEarned: 0, games: 0, touchedAt: now.getTime() }
  if (stats.day !== day) Object.assign(stats, { day, dayBest: 0, dayEarned: 0 })
  stats.touchedAt = now.getTime()
  guestStats.set(id, stats)
  return stats
}

/** Un reçu ne dépasse pas 100 Poussières (cf. `readReceipt`) : au-delà, plusieurs reçus. */
export function receiptsFor(amount: number, now = Date.now()): string[] {
  const receipts: string[] = []
  for (let left = amount; left > 0; left -= 100) receipts.push(signReceipt(Math.min(100, left), now))
  return receipts
}

/** Fin de partie d'un invité : mêmes paliers et même plafond du jour qu'un compte. */
function finishGuest(run: Run, now: Date): HlResult {
  const { streak, metric } = run
  const stats = guestStatsOf(run.userId, now)
  const reward = cappedReward(streak, stats.dayEarned)
  const record = streak > stats.best
  const dayRecord = streak > stats.dayBest
  stats.games += 1
  stats.dayEarned += reward
  if (record) stats.best = streak
  if (dayRecord) stats.dayBest = streak
  return {
    streak,
    metric,
    reward,
    balance: 0,
    best: stats.best,
    todayBest: stats.dayBest,
    earnedToday: stats.dayEarned,
    record: record && streak > 0,
    dayRecord: dayRecord && streak > 0,
    capped: reward < cappedReward(streak, 0),
    receipts: receiptsFor(reward, now.getTime()),
  }
}

async function finishRun(run: Run, now: Date): Promise<HlResult> {
  if (runs.get(run.userId) === run) runs.delete(run.userId)
  if (isGuestId(run.userId)) return finishGuest(run, now)
  const { userId, streak, metric } = run
  const day = parisDay(now)
  // Ligne créée HORS transaction : sous PostgreSQL, un échec de création (deux fins
  // simultanées) annulerait toute la transaction.
  await prisma.higherLowerStats.upsert({ where: { userId }, create: { userId }, update: {} }).catch(() => undefined)
  return prisma.$transaction(async (tx) => {
    const stats = await tx.higherLowerStats.findUniqueOrThrow({ where: { userId } })
    const sameDay = stats.day === day
    const earnedBefore = sameDay ? stats.dayEarned : 0
    const dayBestBefore = sameDay ? stats.dayBest : 0
    const reward = cappedReward(streak, earnedBefore)
    const record = streak > stats.best
    const dayRecord = streak > dayBestBefore
    const saved = await tx.higherLowerStats.update({
      where: { userId },
      data: {
        games: { increment: 1 },
        day,
        dayEarned: earnedBefore + reward,
        ...(dayRecord ? { dayBest: streak, dayMetric: metric } : sameDay ? {} : { dayBest: 0, dayMetric: null }),
        ...(record ? { best: streak, bestMetric: metric, bestAt: now } : {}),
      },
    })
    const balance =
      reward > 0
        ? await creditStardust(tx, userId, reward, 'higher_lower', { streak, metric })
        : ((await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } }))?.stardust ?? 0)
    return {
      streak,
      metric,
      reward,
      balance,
      best: saved.best,
      todayBest: saved.dayBest,
      earnedToday: saved.dayEarned,
      record: record && streak > 0,
      dayRecord: dayRecord && streak > 0,
      capped: reward < cappedReward(streak, 0),
      receipts: [],
    }
  })
}

/**
 * Fin d'une partie COOP (cf. `hl.coop.ts`) pour un joueur : la série de l'équipe rapporte
 * ses Poussières (même paliers, même plafond du jour que le solo), sans toucher aux
 * records ni aux classements, qui restent ceux du solo.
 */
export async function creditCoop(
  userId: string,
  streak: number,
  metric: HlMetric,
  now = new Date(),
): Promise<{ reward: number; balance: number; capped: boolean; receipts: string[] }> {
  if (isGuestId(userId)) {
    const stats = guestStatsOf(userId, now)
    const reward = cappedReward(streak, stats.dayEarned)
    stats.games += 1
    stats.dayEarned += reward
    return { reward, balance: 0, capped: reward < cappedReward(streak, 0), receipts: receiptsFor(reward, now.getTime()) }
  }
  const day = parisDay(now)
  await prisma.higherLowerStats.upsert({ where: { userId }, create: { userId }, update: {} }).catch(() => undefined)
  return prisma.$transaction(async (tx) => {
    const stats = await tx.higherLowerStats.findUniqueOrThrow({ where: { userId } })
    const sameDay = stats.day === day
    const earnedBefore = sameDay ? stats.dayEarned : 0
    const reward = cappedReward(streak, earnedBefore)
    await tx.higherLowerStats.update({
      where: { userId },
      data: { games: { increment: 1 }, day, dayEarned: earnedBefore + reward, ...(sameDay ? {} : { dayBest: 0, dayMetric: null }) },
    })
    const balance =
      reward > 0
        ? await creditStardust(tx, userId, reward, 'higher_lower', { streak, metric, coop: true })
        : ((await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } }))?.stardust ?? 0)
    return { reward, balance, capped: reward < cappedReward(streak, 0), receipts: [] }
  })
}

/* ---- Accueil : records et classements ------------------------------------------------ */

export interface HlStanding {
  rank: number
  userId: string
  name: string | null
  avatarUrl: string | null
  streak: number
  metric: HlMetric | null
  me: boolean
}

export interface HlOverview {
  day: string
  /** Chances au départ d'une partie. */
  lives: number
  metrics: { metric: HlMetric; count: number }[]
  /** Duel d'exemple de chaque terrain, pour la vitrine de l'accueil (B sans valeur, comme en jeu). */
  samples: Record<HlMetric, { current: HlCard; next: HlCard }>
  tiers: typeof HL_TIERS
  dailyCap: number
  me: { best: number; bestMetric: HlMetric | null; todayBest: number; earnedToday: number; games: number }
  leaderboard: {
    today: HlStanding[]
    allTime: HlStanding[]
    /** Mon rang (série du jour / de tous les temps), même hors du top. `null` : pas encore classé. */
    myToday: number | null
    myAllTime: number | null
  }
}

export const LEADERBOARD_SIZE = 10

/** Duels de la vitrine : deux cartes connues de tous, la réponse n'est pas évidente pour autant. */
const SAMPLES: Record<HlMetric, [string, string]> = {
  bounty: ['zoro', 'luffy'],
  sales: ['naruto', 'one-piece'],
  chapters: ['death-note', 'naruto'],
  score: ['naruto', 'berserk'],
}

function samples(): HlOverview['samples'] {
  const entries = HL_METRICS.map((metric) => {
    const pool = HL_ENTRIES[metric]
    const [a, b] = SAMPLES[metric].map((id) => pool.find((entry) => entry.id === id) ?? pool[0]!) as [HlEntry, HlEntry]
    return [metric, { current: cardOf(a, true), next: cardOf(b, false) }] as const
  })
  return Object.fromEntries(entries) as HlOverview['samples']
}

const metricOrNull = (value: string | null): HlMetric | null => (value && isHlMetric(value) ? value : null)

/** Rangs « olympiques » : deux séries égales partagent le rang. */
function standings(
  rows: { userId: string; streak: number; metric: string | null; user: { displayName: string | null; avatarUrl: string | null } }[],
  me: string,
): HlStanding[] {
  return rows.map((row) => ({
    rank: rows.findIndex((other) => other.streak === row.streak) + 1,
    userId: row.userId,
    name: row.user.displayName,
    avatarUrl: publicAvatarUrl(row.user.avatarUrl, row.userId),
    streak: row.streak,
    metric: metricOrNull(row.metric),
    me: row.userId === me,
  }))
}

export async function hlOverview(userId: string, now = new Date()): Promise<HlOverview> {
  const day = parisDay(now)
  const user = { select: { displayName: true, avatarUrl: true } } as const
  const showcase = samples()
  const [stats, today, allTime] = await Promise.all([
    prisma.higherLowerStats.findUnique({ where: { userId } }),
    prisma.higherLowerStats.findMany({
      where: { day, dayBest: { gt: 0 } },
      orderBy: [{ dayBest: 'desc' }, { updatedAt: 'asc' }],
      take: LEADERBOARD_SIZE,
      select: { userId: true, dayBest: true, dayMetric: true, user },
    }),
    prisma.higherLowerStats.findMany({
      where: { best: { gt: 0 } },
      orderBy: [{ best: 'desc' }, { bestAt: 'asc' }],
      take: LEADERBOARD_SIZE,
      select: { userId: true, best: true, bestMetric: true, user },
    }),
  ])
  const guest = isGuestId(userId) ? guestStatsOf(userId, now) : null
  const sameDay = stats?.day === day
  const todayBest = sameDay ? stats.dayBest : 0
  const best = stats?.best ?? 0
  const [aheadToday, aheadAllTime] = await Promise.all([
    todayBest > 0 ? prisma.higherLowerStats.count({ where: { day, dayBest: { gt: todayBest } } }) : null,
    best > 0 ? prisma.higherLowerStats.count({ where: { best: { gt: best } } }) : null,
  ])
  return {
    day,
    lives: HL_LIVES,
    metrics: HL_METRICS.map((metric) => ({ metric, count: HL_ENTRIES[metric].length })),
    samples: showcase,
    tiers: HL_TIERS,
    dailyCap: HL_DAILY_CAP,
    // Invité : ses records en mémoire (il n'est jamais classé).
    me: guest
      ? { best: guest.best, bestMetric: null, todayBest: guest.dayBest, earnedToday: guest.dayEarned, games: guest.games }
      : {
          best,
          bestMetric: metricOrNull(stats?.bestMetric ?? null),
          todayBest,
          earnedToday: sameDay ? stats.dayEarned : 0,
          games: stats?.games ?? 0,
        },
    leaderboard: {
      today: standings(
        today.map((row) => ({ userId: row.userId, streak: row.dayBest, metric: row.dayMetric, user: row.user })),
        userId,
      ),
      allTime: standings(
        allTime.map((row) => ({ userId: row.userId, streak: row.best, metric: row.bestMetric, user: row.user })),
        userId,
      ),
      myToday: aheadToday === null ? null : aheadToday + 1,
      myAllTime: aheadAllTime === null ? null : aheadAllTime + 1,
    },
  }
}

/** Records d'un compte, pour son profil. */
export async function hlRecords(userId: string, now = new Date()): Promise<{ best: number; todayBest: number }> {
  const stats = await prisma.higherLowerStats.findUnique({ where: { userId }, select: { best: true, day: true, dayBest: true } })
  return { best: stats?.best ?? 0, todayBest: stats && stats.day === parisDay(now) ? stats.dayBest : 0 }
}

/** Tests : repartir sans partie en cours ni historique. */
export const forgetRuns = () => {
  runs.clear()
  histories.clear()
}
