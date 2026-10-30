/**
 * Page Jump (arcade) — règles pures (testées, `backend/test/jump.test.ts`). La partie se joue dans
 * le navigateur ; le serveur ne la rejoue pas, il vérifie qu'elle est PLAUSIBLE : jamais plus haut
 * que le temps écoulé ne le permet (même en envol), jamais plus d'éclats ✦ ni d'onis que cette
 * hauteur n'en contient, et le score recalculé à partir de là. Le front reprend les mêmes
 * constantes (`frontend/src/lib/jump/constants.ts`).
 */

/** Points : un par `HEIGHT_PER_POINT` unités grimpées, un éclat ✦, un oni écrasé. */
export const HEIGHT_PER_POINT = 10
export const STAR_POINTS = 10
export const STOMP_POINTS = 50
/** Montée au plus rapide (unités/s, l'envol) et marge du départ. */
export const MAX_CLIMB_PER_SECOND = 1200
export const CLIMB_ALLOWANCE = 800
/** Un éclat au plus tous les `MIN_STAR_SPACING` unités, un oni tous les `MIN_ENEMY_SPACING`. */
export const MIN_STAR_SPACING = 90
export const MIN_ENEMY_SPACING = 260
/** Poussières créditées par jour au plus (parties cumulées), et une Poussière tous les `POINTS_PER_STARDUST` points. */
export const JUMP_DAILY_CAP = 1000
export const POINTS_PER_STARDUST = 20

export interface JumpClaim {
  score: number
  height: number
  stars: number
  stomps: number
}

export const scoreOf = (height: number, stars: number, stomps: number): number =>
  Math.floor(Math.max(0, height) / HEIGHT_PER_POINT) + Math.max(0, stars) * STAR_POINTS + Math.max(0, stomps) * STOMP_POINTS

const whole = (value: number) => Math.max(0, Math.floor(value))

/** Ce que la partie déclarée peut valoir au plus, vu le temps écoulé depuis son départ. */
export function plausible(claim: JumpClaim, elapsedMs: number): JumpClaim {
  const height = Math.min(whole(claim.height), Math.floor(MAX_CLIMB_PER_SECOND * Math.max(0, elapsedMs) / 1000 + CLIMB_ALLOWANCE))
  const stars = Math.min(whole(claim.stars), Math.floor(height / MIN_STAR_SPACING) + 2)
  const stomps = Math.min(whole(claim.stomps), Math.floor(height / MIN_ENEMY_SPACING) + 1)
  return { height, stars, stomps, score: Math.min(whole(claim.score), scoreOf(height, stars, stomps)) }
}

/** Poussières d'une partie, rognées par ce qui reste du plafond du jour. */
export const cappedReward = (score: number, earnedToday: number): number =>
  Math.min(Math.floor(Math.max(0, score) / POINTS_PER_STARDUST), Math.max(0, JUMP_DAILY_CAP - earnedToday))
