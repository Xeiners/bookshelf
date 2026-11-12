// i18n-ignore-file : identifiants et plan du parcours (données) ; les textes sont dans les dictionnaires (`gravity.tutorial`).
import { PLAYER_H, PLAYER_W } from './constants'
import { buildWorld, cloneRun, startRun, stepRun, type Checkpoint, type GravityRun, type GravityWorld } from './engine'
import { buildScripted, type ScriptStep, type SectionKind } from './generator'
import { solveFrom, type Decision } from './solver'
import type { GravityLevel } from './types'

/*
 * Le tutoriel de Gravity Ninja : un seul parcours, d'une traite, où chaque mécanisme arrive à son tour,
 * sans exception, de l'inversion aux roues de lames. À l'approche de chacun, une carte l'explique
 * (et le temps ralentit un instant pour la lire) ; une chute fait reprendre au début du mécanisme en
 * cours, pas au départ. Le parcours est bâti par le générateur (donc prouvé faisable), avec le piège
 * forcé du kawarimi. Pour guider le joueur, le solveur calcule d'avance les instants où toucher
 * réussit : chaque « fenêtre » est l'intervalle de pas où un toucher (maintenu, sous la lune) mène à la
 * suite. En jeu, le temps ralentit pendant la fenêtre et l'invite « Touche ! » s'affiche. Le calcul est
 * lourd : `npm run gravity:levels` le fait d'avance (`tutorial.data.ts`). Testé dans
 * `frontend/test/gravity.test.ts`.
 */

export const CHAPTER_IDS = ['flip', 'edges', 'spikes', 'islands', 'seal', 'crumble', 'mover', 'shuriken', 'moon', 'mini', 'log', 'scrolls', 'warp', 'flames', 'ghost', 'orbit'] as const
export type ChapterId = (typeof CHAPTER_IDS)[number]

const s = (kind: SectionKind, intensity = 1): ScriptStep => ({ kind, intensity })
/** Avant chaque mécanisme, une ligne droite : le temps de lire sa carte. */
const breath = [s('runway'), s('runway')]

/** Le parcours : chaque chapitre, ses étapes. */
const SCRIPT: [ChapterId, ScriptStep[]][] = [
  ['flip', [...breath, s('runway'), s('switch'), s('runway'), s('switch'), s('switch')]],
  ['edges', [...breath, s('wall'), s('runway'), s('wall')]],
  ['spikes', [...breath, s('spikes'), s('spikes')]],
  ['islands', [...breath, s('islands')]],
  ['seal', [...breath, s('pad'), s('runway')]],
  ['crumble', [...breath, s('crumble')]],
  ['mover', [...breath, s('mover')]],
  ['shuriken', [...breath, s('shuriken')]],
  ['moon', [...breath, s('moon')]],
  ['mini', [...breath, s('mini')]],
  ['log', [...breath, { kind: 'trap' }]],
  ['scrolls', [...breath, s('switch'), s('runway'), s('switch'), s('runway'), s('switch'), s('runway')]],
  ['warp', [...breath, s('hiraishin'), s('runway'), s('hiraishin', 4)]],
  ['flames', [...breath, s('flames')]],
  ['ghost', [...breath, s('ghost')]],
  ['orbit', [...breath, s('orbit'), s('runway'), s('switch'), s('runway')]],
]
const SEED = 7

/** Une invite : toucher (et maintenir, sous la lune, jusqu'à se poser) entre les pas `from` et `to`. */
export interface CoachCue {
  from: number
  to: number
  hold: boolean
}

export interface Chapter {
  id: ChapterId
  /** Où il commence (unités) : sa carte s'affiche à l'approche. */
  x: number
  /** Où l'on reprend après une chute pendant ce chapitre. */
  checkpoint: Checkpoint
}

export interface Tutorial {
  level: GravityLevel
  /** Les fenêtres où toucher, dans l'ordre. */
  cues: CoachCue[]
  chapters: Chapter[]
}

const IDLE = { press: false, hold: false }
/** Fenêtre au plus large, avant le toucher du solveur (pas) ; après (le solveur touche tard, à 3 pas près). */
const WINDOW_BEFORE = 50
const WINDOW_AFTER = 8
/** Une fenêtre au plus large (pas) : au ralenti, plus d'une seconde pour toucher. */
const MAX_WIDTH = 24
/** Au plus étroit : resserrer une fenêtre s'arrête là. */
const MIN_WIDTH = 8

const middle = (cue: CoachCue) => Math.round((cue.from + cue.to) / 2)

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
 * Les invites d'un parcours. Pas à pas : le solveur trouve le prochain toucher ; on prend autour de lui
 * la fenêtre des pas où toucher (posé sur une surface) mène encore à la suite, et ce quel que soit
 * l'instant où l'on a touché dans la fenêtre d'avant (début, milieu ou fin). Si aucune fenêtre ne
 * convient à tous (se poser plus tôt sur une dalle fissurée la fait tomber plus tôt), on resserre la
 * fenêtre d'avant. `null` si le parcours ne se guide pas jusqu'au bout.
 */
export function coachOf(world: GravityWorld): CoachCue[] | null {
  const steps: { before: GravityRun; cue: CoachCue }[] = []
  for (let guard = 0; guard < 400; guard += 1) {
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
    // Le prochain toucher : le solveur regarde d'abord un peu plus loin que la suite immédiate, puis
    // jusqu'à l'arrivée s'il n'y a rien à toucher sur ce bout.
    let next: Decision | undefined
    for (const horizon of [Math.min(world.length, run.x + world.speed * 8), world.length]) {
      const report = solveFrom(world, cloneRun(run), horizon, 80_000)
      if (!report.ok) return null
      next = report.decisions.find((decision) => decision.press && decision.tick >= run.tick)
      if (next || horizon >= world.length) break
    }
    if (!next) {
      // Plus rien à toucher : chacun doit filer jusqu'à l'arrivée.
      for (const variant of variants) for (let step = 0; step < 20_000 && variant.status === 'running'; step += 1) stepRun(world, variant, IDLE)
      if (variants.every((variant) => variant.status === 'finished')) return steps.map((step) => step.cue)
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

/** Le parcours joué en suivant les invites (toucher au début, au milieu ou à la fin de chacune), pas à pas. */
export function followCues(world: GravityWorld, cues: readonly CoachCue[], where: 'from' | 'middle' | 'to', visit?: (run: GravityRun) => void): GravityRun {
  const run = startRun(world)
  let cue = 0
  let holding = false
  for (let index = 0; index < 100_000 && run.status === 'running'; index += 1) {
    const current = cues[cue]
    const at = current ? (where === 'middle' ? middle(current) : current[where]) : -1
    const press = run.tick === at
    if (press) {
      holding = current!.hold
      cue += 1
    }
    if (holding && run.grounded && !press) holding = false
    stepRun(world, run, { press, hold: holding })
    visit?.(run)
  }
  return run
}

/**
 * Le tutoriel : le parcours, ses invites, ses chapitres (où chacun commence, où l'on y reprend) et les
 * trois rouleaux, posés dans leur chapitre là où tout joueur qui suit les invites passe forcément (au
 * sol, sur la même surface quel que soit l'instant de ses touchers). `null` s'il ne se guide pas.
 */
export function buildTutorial(): Tutorial | null {
  const steps = SCRIPT.flatMap(([, chapterSteps]) => chapterSteps)
  const result = buildScripted(steps, SEED, { id: 'tutoriel', name: 'Tutoriel', theme: 'konoha', difficulty: 1 })
  if (!result.report.ok) return null
  // Les rouleaux du générateur sont retirés : ceux du tutoriel ont leur chapitre.
  const level: GravityLevel = { ...result.level, elements: result.level.elements.filter((element) => element.type !== 'scroll') }
  const world = buildWorld(level)
  const cues = coachOf(world)
  if (!cues) return null

  // Le début de chaque chapitre : l'abscisse de sa première étape.
  const starts: { id: ChapterId; x: number }[] = []
  let index = 0
  for (const [id, chapterSteps] of SCRIPT) {
    starts.push({ id, x: result.marks[index]! })
    index += chapterSteps.length
  }

  // Les trois parcours (touchers au début, au milieu, à la fin des fenêtres) : où chacun est posé.
  const grounded = (where: 'from' | 'middle' | 'to') => {
    const states: (Checkpoint & { solid: boolean; plain: boolean })[] = []
    followCues(world, cues, where, (run) => {
      if (!run.grounded) return
      states.push({
        x: run.x,
        y: run.g === 1 ? run.y + PLAYER_H : run.y,
        g: run.g,
        tick: run.tick,
        cameraX: run.cameraX,
        // Sur un bloc ordinaire (ni fragile, ni mobile, ni spectral) : on peut y reprendre.
        solid: world.solids[run.support]?.kind === 'block',
        // Rien en cours : taille normale, pas de bûche (la lune, elle, est simplement oubliée à la reprise).
        plain: !run.mini && !run.shield,
      })
    })
    return states
  }
  const paths = { from: grounded('from'), middle: grounded('middle'), to: grounded('to') }
  const sameSurface = (x: number, y: number, g: number) =>
    [paths.from, paths.to].every((path) => path.some((state) => Math.abs(state.x - x) < 0.3 && state.g === g && Math.abs(state.y - y) < 0.01))

  const chapters: Chapter[] = starts.map(({ id, x }) => {
    // Reprise : le premier instant, à partir du début du chapitre, où le joueur est posé sur un bloc, sans rien en cours.
    const at = paths.middle.find((state) => state.x >= x && state.solid && state.plain) ?? paths.middle.find((state) => state.x >= x) ?? paths.middle[0]!
    return { id, x, checkpoint: { x: at.x, y: at.y, g: at.g, tick: at.tick, cameraX: at.cameraX } }
  })

  // Les rouleaux : dans leur chapitre, sur trois bouts de surface partagés par les trois parcours.
  const scrollChapter = starts.findIndex((start) => start.id === 'scrolls')
  const from = starts[scrollChapter]!.x
  const to = starts[scrollChapter + 1]?.x ?? level.length
  const spots = paths.middle.filter((state) => state.x > from + 4 && state.x < to - 2 && state.plain && sameSurface(state.x, state.y, state.g))
  const picks = spots.length >= 3 ? [0.2, 0.55, 0.9].map((mark) => spots[Math.min(spots.length - 1, Math.floor(mark * spots.length))]!) : []
  const scrolls = picks.map((state) => ({ type: 'scroll' as const, x: Math.round((state.x + PLAYER_W / 2) * 100) / 100, y: Math.round((state.g === 1 ? state.y - PLAYER_H / 2 : state.y + PLAYER_H / 2) * 100) / 100 }))
  return { level: { ...level, elements: [...level.elements, ...scrolls] }, cues, chapters }
}

/* ---- Progression du tutoriel (sur l'appareil) ---------------------------------------------- */

const KEY = 'bookshelf:gravity:tutorial'

export interface TutorialProgress {
  /** Le tutoriel a été proposé (au premier « Jouer ») : on ne le propose plus. */
  offered: boolean
  /** Le parcours a été fini au moins une fois. */
  done: boolean
}

export function readTutorial(): TutorialProgress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TutorialProgress> | null
    return { offered: raw?.offered === true, done: raw?.done === true }
  } catch {
    // Stockage indisponible : le tutoriel reste proposé, sans mémoire.
    return { offered: false, done: false }
  }
}

export function writeTutorial(progress: TutorialProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress))
  } catch {
    // Sans stockage, la progression vaut pour cette visite seulement.
  }
}
