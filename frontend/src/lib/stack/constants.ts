/**
 * Page Stack : constantes partagées avec le serveur (`backend/src/modules/stack/stack.logic.ts`).
 * Le serveur vérifie qu'une partie est plausible avec ces mêmes barèmes. Les coordonnées
 * horizontales sont normalisées : la scène fait 1 de large, quelle que soit sa taille à l'écran.
 */

/** Points d'une page posée ; bonus d'une pose parfaite ; bonus par parfaite d'affilée (jusqu'à `COMBO_CAP`). */
export const PAGE_POINTS = 10
export const PERFECT_BONUS = 10
export const COMBO_STEP = 5
export const COMBO_CAP = 10

/** Largeur de la première page (et plafond de la largeur regagnée), hauteur d'une page, en largeurs de scène. */
export const INITIAL_WIDTH = 0.5
export const PAGE_HEIGHT = 0.085
/** Une pose est « parfaite » si le décalage est au plus de ça (largeurs de scène). */
export const PERFECT_TOLERANCE = 0.014
/** Chevauchement sous lequel la page est ratée. */
export const MIN_OVERLAP = 0.012
/** Parfaites d'affilée à partir desquelles chaque parfaite redonne de la largeur, et combien. */
export const GROW_AFTER = 3
export const GROW_BY = 0.025
/** La page glisse un peu au-delà du bord de la scène avant de repartir. */
export const OVERSHOOT = 0.1
/** Vitesse de glissade (largeurs de scène par seconde) : au départ, gain par page, plafond. */
export const BASE_SPEED = 0.55
export const SPEED_PER_PAGE = 0.012
export const MAX_SPEED = 1.7

/** Points d'une page posée ; `combo` : parfaites d'affilée, cette page comprise. */
export const placePoints = (perfect: boolean, combo: number): number =>
  perfect ? PAGE_POINTS + PERFECT_BONUS + COMBO_STEP * Math.min(Math.max(1, combo) - 1, COMBO_CAP - 1) : PAGE_POINTS

export const speedFor = (pages: number): number => Math.min(MAX_SPEED, BASE_SPEED + SPEED_PER_PAGE * pages)
