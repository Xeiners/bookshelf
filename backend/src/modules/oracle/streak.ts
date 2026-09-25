/**
 * Série de tirages (logique pure, testée). Un « jour » est une date locale de
 * l'utilisateur, `YYYY-MM-DD` : la série suit son calendrier, pas l'UTC.
 */

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface StreakState {
  lastDay: string | null
  streak: number
  best: number
}

/** Veille d'un jour `YYYY-MM-DD` (arithmétique sur date civile, sans fuseau). */
export function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/**
 * État après un tirage le jour `day`.
 * - même jour : inchangé (un seul tirage par jour) ;
 * - lendemain du dernier tirage : série + 1 ;
 * - trou d'un jour ou plus : la série repart à 1 ;
 * - jour antérieur au dernier (horloge d'un autre appareil) : ignoré.
 *
 * `claimed` : série connue du client (invité qui se connecte, tirage fait hors
 * ligne). Elle ne peut que relever la série, jamais la baisser.
 */
export function applyDraw(state: StreakState, day: string, claimed = 0): StreakState {
  if (state.lastDay !== null && day < state.lastDay) return state

  const computed =
    state.lastDay === day ? state.streak : state.lastDay === previousDay(day) ? state.streak + 1 : 1
  const streak = Math.max(computed, claimed)
  return { lastDay: day, streak, best: Math.max(state.best, streak) }
}
