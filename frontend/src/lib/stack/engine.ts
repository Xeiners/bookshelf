import { GROW_AFTER, GROW_BY, INITIAL_WIDTH, MIN_OVERLAP, OVERSHOOT, PERFECT_TOLERANCE, placePoints, speedFor } from './constants'

/*
 * Page Stack : simulation pure (aucun rendu, aucun hasard). Une page glisse d'un bord à l'autre
 * de la scène ; `tap` la pose sur la pile : ce qui dépasse est coupé et tombe, une pose parfaite
 * garde toute la largeur (et, en série, en redonne). Plus de chevauchement : la page tombe et la
 * partie est finie. Testée dans `frontend/test/stack.test.ts`.
 */

export interface PlacedPage {
  /** Centre, en largeurs de scène. */
  x: number
  w: number
  perfect: boolean
}

export interface MovingPage {
  x: number
  w: number
  dir: 1 | -1
  speed: number
}

/** Ce que le rendu doit mettre en scène (sons, éclats, morceau qui tombe). Vidé par `drain`. */
export type StackEvent =
  | { type: 'place'; index: number; x: number; w: number; perfect: boolean; combo: number; points: number; grown: boolean; cut: { x: number; w: number } | null }
  | { type: 'over'; x: number; w: number }

export interface StackState {
  /** La pile, de bas en haut ; `pages[0]` est la base. */
  pages: PlacedPage[]
  moving: MovingPage | null
  score: number
  /** Parfaites d'affilée. */
  combo: number
  bestCombo: number
  perfects: number
  over: boolean
  events: StackEvent[]
}

/** Pages posées par le joueur (la base ne compte pas). */
export const pageCount = (state: StackState): number => state.pages.length - 1

/** Bornes de la glissade d'une page de largeur `w` (centre). */
export const limits = (w: number): [number, number] => [w / 2 - OVERSHOOT, 1 - w / 2 + OVERSHOOT]

/** Nouvelle page : elle part d'un bord, en alternance. */
function spawn(state: StackState, w: number): MovingPage {
  const [low, high] = limits(w)
  const fromLeft = pageCount(state) % 2 === 0
  return { x: fromLeft ? low : high, w, dir: fromLeft ? 1 : -1, speed: speedFor(pageCount(state)) }
}

export function createStack(): StackState {
  const state: StackState = { pages: [{ x: 0.5, w: INITIAL_WIDTH, perfect: false }], moving: null, score: 0, combo: 0, bestCombo: 0, perfects: 0, over: false, events: [] }
  state.moving = spawn(state, INITIAL_WIDTH)
  return state
}

/** Fait glisser la page ; elle rebondit sur les bornes. */
export function step(state: StackState, dt: number): void {
  const page = state.moving
  if (state.over || !page) return
  const [low, high] = limits(page.w)
  page.x += page.dir * page.speed * dt
  if (page.x > high) {
    page.x = high - (page.x - high)
    page.dir = -1
  } else if (page.x < low) {
    page.x = low + (low - page.x)
    page.dir = 1
  }
}

/** Pose la page. Sans effet une fois la partie finie. */
export function tap(state: StackState): void {
  const page = state.moving
  const top = state.pages[state.pages.length - 1]!
  if (state.over || !page) return
  const offset = page.x - top.x

  if (Math.abs(offset) <= PERFECT_TOLERANCE) {
    state.combo += 1
    state.perfects += 1
    state.bestCombo = Math.max(state.bestCombo, state.combo)
    const grown = state.combo >= GROW_AFTER && page.w < INITIAL_WIDTH
    const w = grown ? Math.min(INITIAL_WIDTH, page.w + GROW_BY) : page.w
    land(state, { x: top.x, w, perfect: true }, null, grown)
    return
  }

  const left = Math.max(page.x - page.w / 2, top.x - top.w / 2)
  const right = Math.min(page.x + page.w / 2, top.x + top.w / 2)
  if (right - left <= MIN_OVERLAP) {
    state.over = true
    state.moving = null
    state.combo = 0
    state.events.push({ type: 'over', x: page.x, w: page.w })
    return
  }
  state.combo = 0
  // Ce qui dépasse : du côté où la page a glissé.
  const cut =
    offset > 0
      ? { x: (right + (page.x + page.w / 2)) / 2, w: page.x + page.w / 2 - right }
      : { x: (page.x - page.w / 2 + left) / 2, w: left - (page.x - page.w / 2) }
  land(state, { x: (left + right) / 2, w: right - left, perfect: false }, cut, false)
}

function land(state: StackState, placed: PlacedPage, cut: { x: number; w: number } | null, grown: boolean): void {
  const points = placePoints(placed.perfect, state.combo)
  state.pages.push(placed)
  state.score += points
  state.events.push({ type: 'place', index: pageCount(state), x: placed.x, w: placed.w, perfect: placed.perfect, combo: state.combo, points, grown, cut })
  state.moving = spawn(state, placed.w)
}

/** Événements à mettre en scène, une seule fois chacun. */
export function drain(state: StackState): StackEvent[] {
  const events = state.events
  state.events = []
  return events
}

export interface StackOutcome {
  score: number
  pages: number
  perfects: number
  bestCombo: number
}

export const outcomeOf = (state: StackState): StackOutcome => ({ score: state.score, pages: pageCount(state), perfects: state.perfects, bestCombo: state.bestCombo })
