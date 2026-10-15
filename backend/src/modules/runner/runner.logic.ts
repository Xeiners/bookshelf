/**
 * Manga Runner 3D — règles pures (testées, `backend/test/runner.test.ts`). La course se
 * joue dans le navigateur ; le serveur ne la rejoue pas, il vérifie qu'elle est
 * PLAUSIBLE : jamais plus de mètres que la vitesse maximale ne le permet depuis le
 * départ, jamais plus de ✦ que la piste n'en pose sur cette distance. Le front reprend
 * les mêmes constantes (`frontend/src/lib/runner/constants.ts`).
 */

/** Vitesse au départ, accélération et plafond (m/s, m/s²). */
export const RUNNER_START_SPEED = 13
export const RUNNER_ACCEL = 0.18
export const RUNNER_MAX_SPEED = 30
/** Poussières créditées par jour au plus (courses cumulées). */
export const RUNNER_DAILY_CAP = 1000
/** Poussières de bonus par bonne réponse à un quiz. */
export const QUIZ_REWARD = 10
/** Points par bonne réponse à un quiz. */
export const QUIZ_POINTS = 250

/** Revivre après un choc : 50 ✦, puis le double à chaque fois ; trois fois au plus par course. */
export const REVIVE_BASE_COST = 50
export const MAX_REVIVES = 3
export const reviveCost = (revivesSoFar: number): number | null => (revivesSoFar >= MAX_REVIVES ? null : REVIVE_BASE_COST * 2 ** revivesSoFar)

/** Distance maximale atteignable en `seconds` (accélération puis plafond), avec une marge. */
export function maxDistance(seconds: number): number {
  const t = Math.max(0, seconds)
  const rampTime = (RUNNER_MAX_SPEED - RUNNER_START_SPEED) / RUNNER_ACCEL
  const ramp = Math.min(t, rampTime)
  const distance = RUNNER_START_SPEED * ramp + (RUNNER_ACCEL * ramp * ramp) / 2 + RUNNER_MAX_SPEED * Math.max(0, t - rampTime)
  return Math.floor(distance * 1.15 + 30)
}

/** ✦ posées au plus sur `distance` mètres (une ligne de ✦ tous les ~2,5 m au mieux). */
export const maxStardust = (distance: number): number => Math.floor(Math.max(0, distance) / 2.5) + 20

/** Quiz possibles au plus sur `distance` mètres (un jeton tous les 250 m au mieux). */
export const maxQuiz = (distance: number): number => Math.floor(Math.max(0, distance) / 250) + 2

/** Multiplicateur de score : +0,1 par tranche de 20 ✦. */
export const multiplierFor = (stardust: number): number => 1 + Math.floor(Math.max(0, stardust) / 20) / 10

/** Score : distance × multiplicateur, plus les quiz réussis. */
export const scoreFor = (distance: number, stardust: number, quiz: number): number =>
  Math.floor(Math.max(0, distance) * multiplierFor(stardust)) + Math.max(0, quiz) * QUIZ_POINTS

export interface RunClaim {
  distance: number
  stardust: number
  quiz: number
}

/** Ce que la course déclarée peut valoir au plus, vu le temps écoulé depuis son départ. */
export function plausible(claim: RunClaim, elapsedMs: number): RunClaim {
  const distance = Math.min(Math.max(0, Math.floor(claim.distance)), maxDistance(elapsedMs / 1000))
  return {
    distance,
    stardust: Math.min(Math.max(0, Math.floor(claim.stardust)), maxStardust(distance)),
    quiz: Math.min(Math.max(0, Math.floor(claim.quiz)), maxQuiz(distance)),
  }
}

/** Récompense de la course, rognée par ce qui reste du plafond du jour. */
export const cappedReward = (stardust: number, quiz: number, earnedToday: number): number =>
  Math.min(stardust + quiz * QUIZ_REWARD, Math.max(0, RUNNER_DAILY_CAP - earnedToday))
