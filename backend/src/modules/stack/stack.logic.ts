/**
 * Page Stack (arcade) — règles pures (testées, `backend/test/stack.test.ts`). La partie se
 * joue dans le navigateur ; le serveur ne la rejoue pas, il vérifie qu'elle est PLAUSIBLE :
 * jamais plus de pages que le temps écoulé ne le permet, jamais plus de points que ces pages
 * (et leurs poses parfaites) n'en rapportent. Le front reprend les mêmes constantes
 * (`frontend/src/lib/stack/constants.ts`).
 */

/** Points d'une page posée ; bonus d'une pose parfaite ; bonus par parfaite d'affilée (jusqu'à `COMBO_CAP`). */
export const PAGE_POINTS = 10
export const PERFECT_BONUS = 10
export const COMBO_STEP = 5
export const COMBO_CAP = 10
/** Temps minimal entre deux pages (s) : une page met au moins ce temps à traverser l'écran. */
export const MIN_DROP_SECONDS = 0.3
/** Poussières créditées par jour au plus (parties cumulées), et une Poussière tous les `POINTS_PER_STARDUST` points. */
export const STACK_DAILY_CAP = 1000
export const POINTS_PER_STARDUST = 20

/** Points d'une page posée ; `combo` : parfaites d'affilée, cette page comprise (0 si elle n'est pas parfaite). */
export const placePoints = (perfect: boolean, combo: number): number =>
  perfect ? PAGE_POINTS + PERFECT_BONUS + COMBO_STEP * Math.min(Math.max(1, combo) - 1, COMBO_CAP - 1) : PAGE_POINTS

/** Pages posées au plus en `seconds` secondes. */
export const maxPages = (seconds: number): number => Math.floor(Math.max(0, seconds) / MIN_DROP_SECONDS) + 1

/** Score maximal de `pages` pages dont `perfects` parfaites. */
export const maxScore = (pages: number, perfects: number): number =>
  Math.max(0, pages) * PAGE_POINTS + Math.min(Math.max(0, perfects), Math.max(0, pages)) * (PERFECT_BONUS + COMBO_STEP * (COMBO_CAP - 1))

export interface StackClaim {
  score: number
  pages: number
  perfects: number
}

/** Ce que la partie déclarée peut valoir au plus, vu le temps écoulé depuis son départ. */
export function plausible(claim: StackClaim, elapsedMs: number): StackClaim {
  const pages = Math.min(Math.max(0, Math.floor(claim.pages)), maxPages(elapsedMs / 1000))
  const perfects = Math.min(Math.max(0, Math.floor(claim.perfects)), pages)
  return { pages, perfects, score: Math.min(Math.max(0, Math.floor(claim.score)), maxScore(pages, perfects)) }
}

/** Poussières d'une partie, rognées par ce qui reste du plafond du jour. */
export const cappedReward = (score: number, earnedToday: number): number =>
  Math.min(Math.floor(Math.max(0, score) / POINTS_PER_STARDUST), Math.max(0, STACK_DAILY_CAP - earnedToday))
