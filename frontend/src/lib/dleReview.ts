/*
 * Revue des images d'énigme (administration) : l'issue d'un geste sur la carte, en fonctions pures
 * (testées dans `frontend/test/dleReview.test.ts`).
 */

export type Verdict = 'approve' | 'ban'

/** Distance (px) à partir de laquelle un glissement vaut décision, au plus. */
const MAX_THRESHOLD = 140
/** Vitesse (px/ms) à partir de laquelle un coup de doigt vaut décision, même court. */
const FLICK_VELOCITY = 0.6
/** Un coup de doigt doit tout de même avoir quitté le centre d'au moins ça (px). */
const FLICK_MIN_DISTANCE = 40

/**
 * Décision d'un geste : à droite on valide, à gauche on bannit ; `null` : la carte revient au centre.
 * `dx` : déplacement horizontal (px), `velocity` : vitesse au relâchement (px/ms, signée), `width` : largeur de la carte.
 */
export function verdictOf(dx: number, velocity: number, width: number): Verdict | null {
  const threshold = Math.min(MAX_THRESHOLD, Math.max(60, width * 0.28))
  if (dx > threshold || (dx > FLICK_MIN_DISTANCE && velocity > FLICK_VELOCITY)) return 'approve'
  if (dx < -threshold || (dx < -FLICK_MIN_DISTANCE && velocity < -FLICK_VELOCITY)) return 'ban'
  return null
}

/** Opacité (0 → 1) du tampon d'une direction pendant le glissement. */
export const stampOpacity = (dx: number, verdict: Verdict): number => {
  const signed = verdict === 'approve' ? dx : -dx
  return Math.min(1, Math.max(0, (signed - 16) / 90))
}
