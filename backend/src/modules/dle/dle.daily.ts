import { config } from '../../config.js'
import { prisma } from '../../db.js'
import { HttpError, badRequest, conflict } from '../../lib/errors.js'
import { hashString, seededRandom, shuffle } from '../../lib/seeded.js'
import { applyDraw } from '../oracle/streak.js'
import { creditStardust } from '../stardust/stardust.service.js'
import { gameOf, guessResult, poolFor, type DleEntity, type EntitySummary, type GuessResult } from './dle.games.js'
import { DLE_CATEGORIES, DLE_MODES, dailyReward, nextParisMidnight, parisDay, zoomFocus, type DleCategory, type DleMode } from './dle.logic.js'

/*
 * Énigme du jour : une par catégorie et par mode, la même pour tout le monde,
 * renouvelée à minuit (heure de Paris). Fixée en base au premier joueur du jour.
 * La réponse ne quitte jamais le serveur avant d'être trouvée — l'image du format
 * zoom est servie par une adresse qui ne la nomme pas (`/api/dle/daily/<catégorie>/zoom/image`).
 */

/** Une proposition ne revient pas comme énigme du jour avant ce délai. */
const NO_REPEAT_DAYS = 120

/** Graine secrète : sans elle, qui lit le code pourrait calculer les énigmes à venir. */
const seedOf = (day: string, category: DleCategory, mode: DleMode) =>
  `dle:${day}:${category === 'manga' ? '' : `${category}:`}${mode}:${hashString(config.jwtSecret)}`

/** Format zoom sans image (portraits indisponibles) : rien à montrer pour l'instant. */
const imagesUnavailable = () => new HttpError(503, 'dle_images_unavailable', 'Les images de cette énigme sont indisponibles, réessaie plus tard.')

/** Ce qu'il faut deviner aujourd'hui dans cette catégorie et ce mode, tiré au premier appel du jour. */
export async function puzzleEntity(day: string, category: DleCategory, mode: DleMode): Promise<DleEntity> {
  const pool = await poolFor(gameOf(category), mode)
  if (pool.length === 0) throw imagesUnavailable()
  const playable = new Map(pool.map((entity) => [entity.id, entity]))
  const where = { day_category_mode: { day, category, mode } }
  const stored = await prisma.dlePuzzle.findUnique({ where })
  const known = stored ? playable.get(stored.cardId) : undefined
  if (known) return known

  const recent = await prisma.dlePuzzle.findMany({ where: { category }, orderBy: { day: 'desc' }, take: NO_REPEAT_DAYS * 2, select: { cardId: true } })
  const used = new Set(recent.map((puzzle) => puzzle.cardId))
  const fresh = pool.filter((entity) => !used.has(entity.id))
  const chosen = shuffle(fresh.length > 0 ? fresh : pool, seededRandom(seedOf(day, category, mode)))[0] as DleEntity
  if (stored) {
    // Plus jouable (carte retirée, portrait disparu) : l'énigme est remplacée.
    await prisma.dlePuzzle.update({ where, data: { cardId: chosen.id } })
    return chosen
  }
  try {
    await prisma.dlePuzzle.create({ data: { day, category, mode, cardId: chosen.id } })
    return chosen
  } catch {
    // Deux premiers joueurs en même temps : l'énigme enregistrée par l'autre fait foi.
    const winner = await prisma.dlePuzzle.findUnique({ where })
    return (winner && playable.get(winner.cardId)) || chosen
  }
}

export interface DailyView {
  day: string
  category: DleCategory
  mode: DleMode
  /** Prochaine énigme (minuit à Paris). */
  nextAt: string
  guesses: GuessResult[]
  solved: boolean
  /** Poussières gagnées (0 tant que l'énigme n'est pas résolue). */
  reward: number
  /** Format zoom : point de l'image sur lequel on zoome (%). */
  focus: { x: number; y: number } | null
  /** La réponse, une fois trouvée. */
  answer: EntitySummary | null
}

const parseGuesses = (json: string): string[] => {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

interface DailyRow {
  guesses: string
  solvedAt: Date | null
  reward: number
}

async function viewOf(day: string, category: DleCategory, mode: DleMode, row: DailyRow | null, now: Date): Promise<DailyView> {
  const game = gameOf(category)
  const [{ byId }, answer] = await Promise.all([game.pool(), puzzleEntity(day, category, mode)])
  const guesses = parseGuesses(row?.guesses ?? '[]').flatMap((id) => {
    const entity = byId.get(id)
    return entity ? [guessResult(game, mode, entity, answer)] : []
  })
  const solved = row?.solvedAt != null
  return {
    day,
    category,
    mode,
    nextAt: nextParisMidnight(now).toISOString(),
    guesses,
    solved,
    reward: row?.reward ?? 0,
    focus: mode === 'zoom' ? zoomFocus(seededRandom(`${seedOf(day, category, mode)}:focus`)) : null,
    answer: solved ? game.summary(answer) : null,
  }
}

export async function dailyView(userId: string, category: DleCategory, mode: DleMode, now = new Date()): Promise<DailyView> {
  const day = parisDay(now)
  const row = await prisma.dleDaily.findUnique({ where: { userId_day_category_mode: { userId, day, category, mode } } })
  return viewOf(day, category, mode, row, now)
}

export interface DailyGuessResult {
  view: DailyView
  /** Poussières gagnées par cet essai (0 s'il n'a pas résolu l'énigme). */
  earned: number
  /** Solde après l'essai. */
  balance: number
  /** Série de jours après l'essai. */
  streak: number
}

/** Au-delà, ce n'est plus deviner : c'est tout essayer. */
export const DAILY_MAX_GUESSES = 60

/**
 * Propose une réponse à l'énigme du jour. Une victoire crédite les Poussières et
 * fait avancer la série (commune à toutes les catégories) dans la même transaction.
 * Verrou optimiste sur la liste des essais : deux essais simultanés ne s'écrasent jamais.
 */
export async function guessDaily(userId: string, category: DleCategory, mode: DleMode, cardId: string, now = new Date()): Promise<DailyGuessResult> {
  const day = parisDay(now)
  const [{ byId }, answer] = await Promise.all([gameOf(category).pool(), puzzleEntity(day, category, mode)])
  if (!byId.has(cardId)) throw badRequest('Cette proposition ne fait pas partie du jeu.', 'unknown_work')

  const key = { userId_day_category_mode: { userId, day, category, mode } }
  // La ligne du jour existe avant la transaction : une création concurrente qui échoue
  // annulerait sinon toute la transaction (PostgreSQL).
  await prisma.dleDaily.upsert({ where: key, create: { userId, day, category, mode }, update: {} }).catch(() => undefined)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await prisma.dleDaily.findUnique({ where: key })
    if (!row) continue
    if (row.solvedAt) throw conflict('Énigme déjà résolue : reviens demain !', 'already_solved')
    const guesses = parseGuesses(row.guesses)
    if (guesses.includes(cardId)) throw conflict('Déjà proposé.', 'already_guessed')
    if (guesses.length >= DAILY_MAX_GUESSES) throw new HttpError(409, 'too_many_guesses', 'Plus d’essais possibles aujourd’hui.')

    const next = [...guesses, cardId]
    const correct = cardId === answer.id
    const outcome = await prisma.$transaction(async (tx) => {
      const { count } = await tx.dleDaily.updateMany({ where: { userId, day, category, mode, guesses: row.guesses, solvedAt: null }, data: { guesses: JSON.stringify(next) } })
      if (count === 0) return null

      const stats = await tx.dleStats.findUnique({ where: { userId } })
      let streak = stats?.dailyStreak ?? 0
      let earned = 0
      if (correct) {
        const state = applyDraw({ lastDay: stats?.dailyLastDay ?? null, streak, best: stats?.dailyBest ?? 0 }, day)
        streak = state.streak
        earned = dailyReward(next.length, streak)
        await tx.dleDaily.update({ where: key, data: { solvedAt: now, reward: earned } })
        await tx.dleStats.upsert({
          where: { userId },
          create: { userId, dailyStreak: state.streak, dailyBest: state.best, dailyLastDay: state.lastDay, dailySolved: 1 },
          update: { dailyStreak: state.streak, dailyBest: state.best, dailyLastDay: state.lastDay, dailySolved: { increment: 1 } },
        })
        const balance = await creditStardust(tx, userId, earned, 'dle_daily', { day, category, mode, attempts: next.length })
        return { earned, balance, streak }
      }
      const user = await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } })
      return { earned, balance: user?.stardust ?? 0, streak }
    })
    if (!outcome) continue

    const fresh = await prisma.dleDaily.findUnique({ where: key })
    return { view: await viewOf(day, category, mode, fresh, now), ...outcome }
  }
  throw conflict('Essai déjà en cours, réessaie.', 'guess_busy')
}

export interface DleOverview {
  day: string
  nextAt: string
  stardust: number
  boosterPrice: number
  stats: {
    dailyStreak: number
    dailyBest: number
    dailySolved: number
    roomsPlayed: number
    roomsWon: number
  }
  /** Où en est chaque énigme du jour, par catégorie et par mode. */
  daily: Record<DleCategory, Record<DleMode, { attempts: number; solved: boolean; reward: number }>>
}

const emptyDaily = () =>
  Object.fromEntries(
    DLE_CATEGORIES.map((category) => [category, Object.fromEntries(DLE_MODES.map((mode) => [mode, { attempts: 0, solved: false, reward: 0 }]))]),
  ) as DleOverview['daily']

/** Accueil d'un invité : rien d'enregistré sur le serveur (ses Poussières sont des reçus sur l'appareil). */
export function emptyOverview(boosterPrice: number, now = new Date()): DleOverview {
  return {
    day: parisDay(now),
    nextAt: nextParisMidnight(now).toISOString(),
    stardust: 0,
    boosterPrice,
    stats: { dailyStreak: 0, dailyBest: 0, dailySolved: 0, roomsPlayed: 0, roomsWon: 0 },
    daily: emptyDaily(),
  }
}

/** Accueil du jeu : solde, palmarès, et où en sont les énigmes du jour de chaque catégorie. */
export async function dleOverview(userId: string, boosterPrice: number, now = new Date()): Promise<DleOverview> {
  const day = parisDay(now)
  const [user, stats, rows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { stardust: true } }),
    prisma.dleStats.findUnique({ where: { userId } }),
    prisma.dleDaily.findMany({ where: { userId, day } }),
  ])
  const progress = (category: DleCategory, mode: DleMode) => {
    const row = rows.find((entry) => entry.category === category && entry.mode === mode)
    return { attempts: parseGuesses(row?.guesses ?? '[]').length, solved: row?.solvedAt != null, reward: row?.reward ?? 0 }
  }
  const daily = Object.fromEntries(
    DLE_CATEGORIES.map((category) => [category, Object.fromEntries(DLE_MODES.map((mode) => [mode, progress(category, mode)]))]),
  ) as DleOverview['daily']
  // Série interrompue (dernier jour résolu avant hier) : affichée à zéro, sans attendre le prochain essai.
  const lastDay = stats?.dailyLastDay ?? null
  const alive = lastDay !== null && (lastDay === day || applyDraw({ lastDay, streak: 1, best: 1 }, day).streak === 2)
  return {
    day,
    nextAt: nextParisMidnight(now).toISOString(),
    stardust: user?.stardust ?? 0,
    boosterPrice,
    stats: {
      dailyStreak: alive ? (stats?.dailyStreak ?? 0) : 0,
      dailyBest: stats?.dailyBest ?? 0,
      dailySolved: stats?.dailySolved ?? 0,
      roomsPlayed: stats?.roomsPlayed ?? 0,
      roomsWon: stats?.roomsWon ?? 0,
    },
    daily,
  }
}
