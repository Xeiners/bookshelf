// i18n-ignore-file : identifiants et plans des leçons (données) ; leurs textes sont dans les dictionnaires (`gravity.tutorial`).
import { LEVEL_FORMAT, speedFor } from './constants'
import { buildWorld, cloneRun, startRun, stepRun, type GravityRun, type GravityWorld } from './engine'
import { buildLevel, type SectionKind } from './generator'
import { solveFrom, type Decision } from './solver'
import type { GravityLevel, LevelElement, ThemeId } from './types'

/*
 * Le tutoriel de Gravity Ninja : une leçon par mécanisme, sans exception, de l'inversion aux roues
 * de lames. Chaque leçon est un court niveau (bâti par le générateur, donc prouvé faisable, ou posé à
 * la main quand il faut forcer une situation : la bûche qui encaisse un piège). Pour guider le joueur,
 * le tutoriel calcule d'avance, avec le solveur, les instants où toucher réussit : chaque « fenêtre »
 * est l'intervalle de pas où un toucher (maintenu, sous la lune) mène à la suite du niveau. En jeu,
 * le temps ralentit pendant la fenêtre et l'invite « Touche ! » s'affiche. Fonctions pures, testées
 * (`frontend/test/gravity.test.ts`).
 */

export const LESSON_IDS = ['flip', 'edges', 'spikes', 'islands', 'seal', 'crumble', 'mover', 'shuriken', 'moon', 'mini', 'log', 'scrolls', 'warp', 'flames', 'ghost', 'orbit'] as const
export type LessonId = (typeof LESSON_IDS)[number]

interface LessonSpec {
  theme: ThemeId
  /** Les sections du générateur, douces ; ou des éléments posés à la main. */
  sections?: [SectionKind, number][]
  custom?: () => { length: number; elements: LevelElement[] }
  seed: number
  /** Les rouleaux restent (la leçon des rouleaux) ; ailleurs, on les retire pour ne pas distraire. */
  scrolls?: boolean
}

const SPECS: Record<LessonId, LessonSpec> = {
  flip: { theme: 'konoha', seed: 3, sections: [['runway', 1], ['switch', 1], ['runway', 1], ['switch', 1], ['switch', 1], ['runway', 1]] },
  edges: { theme: 'konoha', seed: 5, sections: [['switch', 1], ['wall', 1], ['runway', 1], ['wall', 1], ['switch', 1]] },
  spikes: { theme: 'night', seed: 7, sections: [['spikes', 1], ['runway', 1], ['spikes', 1], ['spikes', 2]] },
  islands: { theme: 'hunter', seed: 11, sections: [['islands', 1], ['runway', 1], ['islands', 2]] },
  seal: { theme: 'mist', seed: 13, sections: [['pad', 1], ['runway', 1], ['pad', 1], ['switch', 1]] },
  crumble: { theme: 'halloween', seed: 17, sections: [['switch', 1], ['crumble', 1], ['runway', 1], ['crumble', 2]] },
  mover: { theme: 'sand', seed: 19, sections: [['switch', 1], ['mover', 1], ['runway', 1], ['mover', 2]] },
  shuriken: { theme: 'konoha', seed: 23, sections: [['switch', 1], ['shuriken', 1], ['runway', 1], ['shuriken', 2]] },
  moon: { theme: 'night', seed: 29, sections: [['switch', 1], ['moon', 1], ['runway', 1], ['moon', 2]] },
  mini: { theme: 'mist', seed: 31, sections: [['runway', 1], ['mini', 1], ['runway', 1], ['mini', 2]] },
  log: { theme: 'hunter', seed: 37, custom: kawarimiLesson },
  scrolls: { theme: 'konoha', seed: 41, scrolls: true, sections: [['switch', 1], ['spikes', 1], ['islands', 1], ['switch', 1], ['spikes', 1], ['switch', 1], ['runway', 1]] },
  warp: { theme: 'konoha', seed: 43, sections: [['runway', 1], ['hiraishin', 1], ['runway', 1], ['hiraishin', 4], ['switch', 1]] },
  flames: { theme: 'sand', seed: 47, sections: [['switch', 1], ['flames', 1], ['runway', 1], ['flames', 2]] },
  ghost: { theme: 'mist', seed: 53, sections: [['switch', 1], ['ghost', 1], ['runway', 1], ['ghost', 2]] },
  orbit: { theme: 'hunter', seed: 59, sections: [['switch', 1], ['orbit', 1], ['runway', 1], ['orbit', 2]] },
}

/**
 * Le kawarimi, posé à la main : la bûche, puis des pics qu'on ne peut pas éviter (elle les encaisse) ;
 * plus loin, d'autres pics à éviter soi-même, la bûche étant partie.
 */
function kawarimiLesson(): { length: number; elements: LevelElement[] } {
  return {
    length: 78,
    elements: [
      { type: 'block', x: -4, y: 11, w: 90, h: 6 },
      { type: 'log', x: 14, y: 10.35 },
      { type: 'spikes', x: 30, y: 11, w: 1.6, dir: 'up' },
      { type: 'block', x: 40, y: -3, w: 60, h: 7 },
      { type: 'spikes', x: 56, y: 11, w: 8, dir: 'up' },
    ],
  }
}

/** Une invite : toucher (et maintenir, sous la lune, jusqu'à se poser) entre les pas `from` et `to`. */
export interface CoachCue {
  from: number
  to: number
  hold: boolean
}

export interface Lesson {
  id: LessonId
  level: GravityLevel
  /** Les fenêtres où toucher, dans l'ordre, sur le chemin du milieu des fenêtres. */
  cues: CoachCue[]
  /** La démonstration : toucher au milieu de chaque fenêtre (pour l'aperçu animé). */
  demo: Decision[]
}

const IDLE = { press: false, hold: false }
/** Fenêtre au plus large, avant le toucher du solveur (pas) ; après (le solveur touche tard, à 3 pas près). */
const WINDOW_BEFORE = 50
const WINDOW_AFTER = 8

/** Avance sans toucher jusqu'au pas `tick` ; faux si la partie s'arrête avant. */
function advanceTo(world: GravityWorld, run: GravityRun, tick: number): boolean {
  while (run.tick < tick && run.status === 'running') stepRun(world, run, IDLE)
  return run.status === 'running' && run.tick === tick
}

/** Touche ; avec `hold`, garde le doigt posé jusqu'à se poser (la lune fait planer). */
function pressNow(world: GravityWorld, run: GravityRun, hold: boolean): void {
  stepRun(world, run, { press: true, hold })
  for (let guard = 0; hold && guard < 600 && run.status === 'running' && !run.grounded; guard += 1) stepRun(world, run, { press: false, hold: true })
}

/** La partie continue-t-elle encore un moment (trois secondes de course) sans faute ? */
function survives(world: GravityWorld, run: GravityRun): boolean {
  if (run.status === 'finished') return true
  if (run.status !== 'running') return false
  return solveFrom(world, cloneRun(run), Math.min(world.length, run.x + world.speed * 3), 6000).ok
}

/**
 * La plus large suite de pas, entre `first` et `last`, où toucher réussit depuis chacun des états
 * `pool` ; à largeur égale, la plus proche du toucher du solveur (`near`).
 */
function widestWindow(world: GravityWorld, pool: GravityRun[], hold: boolean, first: number, last: number, near: number): CoachCue | null {
  const works = (tick: number) =>
    pool.every((state) => {
      const probe = cloneRun(state)
      if (!advanceTo(world, probe, tick) || !(probe.grounded || probe.coyote > 0)) return false
      pressNow(world, probe, hold)
      return survives(world, probe)
    })
  let best: CoachCue | null = null
  let start = -1
  for (let tick = first; tick <= last + 1; tick += 1) {
    if (tick <= last && works(tick)) {
      if (start < 0) start = tick
      continue
    }
    if (start >= 0) {
      const candidate = { from: start, to: tick - 1, hold }
      const width = candidate.to - candidate.from
      const distance = (cue: CoachCue) => (near >= cue.from && near <= cue.to ? 0 : Math.min(Math.abs(near - cue.from), Math.abs(near - cue.to)))
      if (!best || width > best.to - best.from || (width === best.to - best.from && distance(candidate) < distance(best))) best = candidate
      start = -1
    }
  }
  return best
}

/** Une fenêtre au plus large (pas) : au ralenti, plus d'une seconde pour toucher. */
const MAX_WIDTH = 24
/** Au plus étroit : resserrer une fenêtre s'arrête là. */
const MIN_WIDTH = 8

const middle = (cue: CoachCue) => Math.round((cue.from + cue.to) / 2)

/** Les états du joueur après une invite, selon qu'il a touché au début, au milieu ou à la fin de la fenêtre. */
function variantsAfter(world: GravityWorld, before: GravityRun, cue: CoachCue): GravityRun[] {
  return [cue.from, middle(cue), cue.to].map((tick) => {
    const variant = cloneRun(before)
    advanceTo(world, variant, tick)
    pressNow(world, variant, cue.hold)
    return variant
  })
}

/** La fenêtre du prochain toucher, valable depuis chacun des états `pool`, rognée à `MAX_WIDTH` autour de son milieu. */
function cueFor(world: GravityWorld, pool: GravityRun[], run: GravityRun, next: Decision): CoachCue | null {
  const at = cloneRun(run)
  advanceTo(world, at, next.tick)
  const earliest = Math.max(...pool.map((state) => state.tick))
  // Sous la lune, on apprend à maintenir ; sinon (ou si maintenir ne passe pas), un simple toucher.
  for (const hold of at.moonLeft > 0 ? [true, false] : [false]) {
    const cue = widestWindow(world, pool, hold, Math.max(earliest, next.tick - WINDOW_BEFORE), next.tick + WINDOW_AFTER, next.tick)
    if (!cue || cue.to - cue.from + 1 < MIN_WIDTH) continue
    if (cue.to - cue.from + 1 <= MAX_WIDTH) return cue
    const from = middle(cue) - Math.floor(MAX_WIDTH / 2)
    return { from, to: from + MAX_WIDTH - 1, hold }
  }
  return null
}

/**
 * Les invites d'une leçon. Pas à pas : le solveur trouve le prochain toucher ; on prend autour de lui
 * la fenêtre des pas où toucher (posé sur une surface) mène encore à la suite, et ce quel que soit
 * l'instant où l'on a touché dans la fenêtre d'avant (début, milieu ou fin). Si aucune fenêtre ne
 * convient à tous (se poser plus tôt sur une dalle fissurée la fait tomber plus tôt), on resserre la
 * fenêtre d'avant. La démonstration touche au milieu de chaque fenêtre. `null` si la leçon ne se guide
 * pas jusqu'au bout.
 */
export function coachOf(world: GravityWorld): { cues: CoachCue[]; demo: Decision[] } | null {
  const steps: { before: GravityRun; cue: CoachCue }[] = []
  for (let guard = 0; guard < 200; guard += 1) {
    const last = steps[steps.length - 1]
    const variants = last ? variantsAfter(world, last.before, last.cue) : [startRun(world)]
    const run = variants[last ? 1 : 0]!
    // Resserre la dernière fenêtre ; faux si elle est déjà au plus étroit.
    const narrow = () => {
      if (!last || last.cue.to - last.cue.from + 1 <= MIN_WIDTH) return false
      const width = Math.max(MIN_WIDTH, Math.floor((last.cue.to - last.cue.from + 1) * 0.6))
      const from = middle(last.cue) - Math.floor(width / 2)
      last.cue = { ...last.cue, from, to: from + width - 1 }
      return true
    }
    if (variants.some((variant) => variant.status === 'dead')) {
      if (narrow()) continue
      return null
    }
    const report = solveFrom(world, cloneRun(run), world.length, 80_000)
    if (!report.ok) return null
    const next = report.decisions.find((decision) => decision.press && decision.tick >= run.tick)
    if (!next) {
      // Plus rien à toucher : chacun doit filer jusqu'à l'arrivée.
      for (const variant of variants) for (let step = 0; step < 20_000 && variant.status === 'running'; step += 1) stepRun(world, variant, IDLE)
      if (variants.every((variant) => variant.status === 'finished')) return finish(world, steps)
      if (narrow()) continue
      return null
    }
    const cue = cueFor(world, variants, run, next)
    if (cue) {
      steps.push({ before: cloneRun(run), cue })
      continue
    }
    if (narrow()) continue
    // En dernier recours, une fenêtre pour le seul toucher du milieu.
    const alone = cueFor(world, [run], run, next)
    if (!alone) return null
    steps.push({ before: cloneRun(run), cue: alone })
  }
  return null
}

/** Les invites, et la démonstration qui touche au milieu de chacune (en lâchant, sous la lune, une fois posé). */
function finish(world: GravityWorld, steps: { before: GravityRun; cue: CoachCue }[]): { cues: CoachCue[]; demo: Decision[] } {
  const run = startRun(world)
  const demo: Decision[] = []
  for (const { cue } of steps) {
    const tick = middle(cue)
    advanceTo(world, run, tick)
    demo.push({ tick, press: true, hold: cue.hold })
    pressNow(world, run, cue.hold)
    if (cue.hold) demo.push({ tick: run.tick, press: false, hold: false })
  }
  return { cues: steps.map((step) => step.cue), demo }
}

/**
 * Une leçon prête : son niveau et ses invites. `null` : la leçon ne se guide pas. Le calcul est
 * lourd (des centaines de parties simulées) : `npm run gravity:levels` le fait d'avance et l'écrit dans
 * `tutorial.lessons.ts`, que le jeu lit tel quel.
 */
export function buildLesson(id: LessonId): Lesson | null {
  const spec = SPECS[id]
  let level: GravityLevel
  if (spec.custom) {
    const { length, elements } = spec.custom()
    level = { format: LEVEL_FORMAT, id: `tuto-${id}`, name: id, theme: spec.theme, difficulty: 1, speed: speedFor(1), length, start: { y: 11, g: 1 }, elements }
  } else {
    const built = buildLevel({ name: id, theme: spec.theme, difficulty: 1, sections: spec.sections!.map(([kind, intensity]) => ({ kind, intensity })) }, spec.seed, `tuto-${id}`).level
    level = spec.scrolls ? built : { ...built, elements: built.elements.filter((element) => element.type !== 'scroll') }
  }
  const coach = coachOf(buildWorld(level))
  return coach ? { id, level, ...coach } : null
}

/* ---- Progression du tutoriel (sur l'appareil) ---------------------------------------------- */

const KEY = 'bookshelf:gravity:tutorial'

export interface TutorialProgress {
  /** Le tutoriel a été proposé (au premier « Jouer ») : on ne le propose plus. */
  offered: boolean
  /** Leçons réussies. */
  done: LessonId[]
}

export function readTutorial(): TutorialProgress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TutorialProgress> | null
    const done = Array.isArray(raw?.done) ? raw.done.filter((id): id is LessonId => (LESSON_IDS as readonly string[]).includes(id as string)) : []
    return { offered: raw?.offered === true, done }
  } catch {
    // Stockage indisponible : le tutoriel reste proposé, sans mémoire des leçons.
    return { offered: false, done: [] }
  }
}

export function writeTutorial(progress: TutorialProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress))
  } catch {
    // Sans stockage, la progression vaut pour cette visite seulement.
  }
}
