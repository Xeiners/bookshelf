/**
 * Logique pure de l'Oracle, côté client : jour calendaire local, hasard
 * déterministe et série de tirages. Miroir de `backend/src/lib/seeded.ts` et
 * `backend/src/modules/oracle/streak.ts` (même algorithme, mêmes règles) : le
 * tirage hors-ligne et la série locale se comportent comme ceux du serveur.
 */

/** Jour local `YYYY-MM-DD` : la série suit le calendrier de l'utilisateur, pas l'UTC. */
export function localDay(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/** Millisecondes jusqu'à minuit local : le prochain tirage. */
export function msUntilNextDay(now = new Date()): number {
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  return midnight.getTime() - now.getTime()
}

/** 5 h 07 min 03 s → « 05:07:03 ». */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
  return parts.map((part) => String(part).padStart(2, '0')).join(':')
}

/* ---- Hasard déterministe (identique au serveur) ----------------------- */

export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function seededRandom(seed: string): () => number {
  let state = hashString(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

/* ---- Série ------------------------------------------------------------ */

export interface StreakState {
  lastDay: string | null
  streak: number
  best: number
}

/** Même règle que le serveur : +1 le lendemain, 1 après un trou, rien le même jour. */
export function applyDraw(state: StreakState, day: string, claimed = 0): StreakState {
  if (state.lastDay !== null && day < state.lastDay) return state
  const computed =
    state.lastDay === day ? state.streak : state.lastDay === previousDay(day) ? state.streak + 1 : 1
  const streak = Math.max(computed, claimed)
  return { lastDay: day, streak, best: Math.max(state.best, streak) }
}

/** Une série dont le dernier tirage date d'avant-hier est rompue, même avant le prochain tirage. */
export function liveStreak(state: StreakState, today: string): number {
  if (!state.lastDay) return 0
  return state.lastDay === today || state.lastDay === previousDay(today) ? state.streak : 0
}

/** Rang de la pépite selon sa note : un clin d'œil « gacha ». */
export function rankTier(rating: number | null): string {
  if (rating === null) return 'B'
  if (rating >= 4.6) return 'S'
  if (rating >= 4.3) return 'A'
  return 'B'
}
