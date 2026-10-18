import { pick, seededRandom } from '../../lib/seeded.js'

/*
 * Récompense quotidienne : un calendrier de 30 jours. Chaque jour (de minuit à 23 h 59, heure
 * de Paris) la première connexion ouvre le calendrier et donne la case du jour. Les jours
 * doivent s'enchaîner : en manquer un repart du premier. Le 30e jour offre un pack avec une
 * Légendaire garantie, puis un nouveau calendrier commence.
 *
 * Le contenu des cases se déduit de (compte, cycle) : même calendrier sur tous les appareils,
 * visible en entier d'avance, et rien à stocker.
 */

export const CYCLE_DAYS = 30
export const MILESTONE_DAYS = [7, 14, 21] as const

export type DayTier = 'common' | 'milestone' | 'grand'

/** Ce que contient une case. `pack` : le pack du 30e jour (quatre cartes dont une Légendaire au moins). */
export interface DailyBundle {
  stardust: number
  boosters: number
  /** Boîtes mystère de la garde-robe (cosmétiques). */
  boxes: number
  pack: boolean
}

export interface DailyDay {
  day: number
  tier: DayTier
  reward: DailyBundle
}

const bundle = (part: Partial<DailyBundle>): DailyBundle => ({ stardust: 0, boosters: 0, boxes: 0, pack: false, ...part })

/** Jour ordinaire : une seule récompense, tirée selon ces poids (Poussières le plus souvent). */
const COMMON: { weight: number; make: (random: () => number) => DailyBundle }[] = [
  { weight: 50, make: (random) => bundle({ stardust: pick([40, 60, 80, 100, 150], random) }) },
  { weight: 30, make: () => bundle({ boosters: 1 }) },
  { weight: 20, make: () => bundle({ boxes: 1 }) },
]

/** Jours 7, 14 et 21 : une belle récompense, toujours. */
const MILESTONE: DailyBundle[] = [
  bundle({ boosters: 2 }),
  bundle({ boxes: 2 }),
  bundle({ stardust: 400 }),
  bundle({ boosters: 1, boxes: 1 }),
  bundle({ boosters: 1, stardust: 150 }),
]

/** Jour 30 : le pack à Légendaire garantie, avec une boîte mystère et des Poussières en plus. */
export const GRAND_REWARD: DailyBundle = bundle({ pack: true, boxes: 1, stardust: 250 })

export const tierOf = (day: number): DayTier => (day === CYCLE_DAYS ? 'grand' : (MILESTONE_DAYS as readonly number[]).includes(day) ? 'milestone' : 'common')

function drawCommon(random: () => number): DailyBundle {
  const total = COMMON.reduce((sum, entry) => sum + entry.weight, 0)
  let roll = random() * total
  for (const entry of COMMON) {
    roll -= entry.weight
    if (roll < 0) return entry.make(random)
  }
  return COMMON[0]!.make(random)
}

/** Les 30 cases d'un cycle : toujours les mêmes pour un (compte, cycle) donné. */
export function calendarFor(userId: string, cycle: number): DailyDay[] {
  const random = seededRandom(`daily:${userId}:${cycle}`)
  return Array.from({ length: CYCLE_DAYS }, (_, index) => {
    const day = index + 1
    const tier = tierOf(day)
    return { day, tier, reward: tier === 'grand' ? GRAND_REWARD : tier === 'milestone' ? pick(MILESTONE, random) : drawCommon(random) }
  })
}

/* ---- Jours ---------------------------------------------------------------------- */

/** Jour `YYYY-MM-DD` décalé de `delta` jours (calendrier civil, sans fuseau). */
export function shiftDay(day: string, delta: number): string {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10)
}

export interface DailyRow {
  streak: number
  cycle: number
  lastDay: string | null
}

export interface DailyPlan {
  /** La case du jour n'a pas encore été prise. */
  claimable: boolean
  /** Case du jour (à prendre) ou dernière case prise. */
  day: number
  /** Cycle auquel appartient cette case. */
  cycle: number
  /** Jours déjà pris dans ce cycle (la case du jour non comprise tant qu'elle n'est pas prise). */
  streak: number
  /** Une série entamée vient d'être perdue (jour manqué) : le calendrier repart de zéro. */
  broken: boolean
}

/** Où en est le joueur à `today` (jour de Paris), d'après sa dernière case prise. */
export function planDaily(row: DailyRow | null, today: string): DailyPlan {
  if (!row || row.lastDay === null) return { claimable: true, day: 1, cycle: row?.cycle ?? 0, streak: 0, broken: false }
  if (row.lastDay === today) return { claimable: false, day: row.streak, cycle: row.cycle, streak: row.streak, broken: false }
  const finished = row.streak >= CYCLE_DAYS
  if (row.lastDay === shiftDay(today, -1) && !finished) {
    return { claimable: true, day: row.streak + 1, cycle: row.cycle, streak: row.streak, broken: false }
  }
  // Calendrier terminé, ou jour manqué : un nouveau calendrier, un autre tirage.
  return { claimable: true, day: 1, cycle: row.cycle + 1, streak: 0, broken: !finished && row.streak > 0 }
}

export type DayState = 'claimed' | 'today' | 'upcoming'

export const stateOf = (plan: DailyPlan, day: number): DayState =>
  day <= plan.streak ? 'claimed' : plan.claimable && day === plan.day ? 'today' : 'upcoming'
