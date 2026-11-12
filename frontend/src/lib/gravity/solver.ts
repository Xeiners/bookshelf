import { TICK } from './constants'
import { cloneRun, startRun, stepRun, type GravityRun, type GravityWorld } from './engine'

/*
 * Le solveur : un joueur parfait qui essaie les touchers possibles (recherche en profondeur, sans
 * repasser par un état déjà vu) jusqu'à franchir l'objectif. La simulation étant déterministe, une
 * suite de touchers qui réussit ici réussit en jeu : c'est la preuve qu'un niveau se finit. Comme
 * une chute renvoie au départ (pas de point de reprise), la preuve se fait d'une traite, sans
 * faute, du départ à l'arrivée.
 */

/** Un toucher n'est essayé qu'un pas sur `STRIDE` (50 ms) : assez fin pour les fenêtres du générateur. */
const STRIDE = 3
/** États explorés au plus pour un niveau entier (les niveaux intégrés en demandent quelques milliers). */
const MAX_NODES = 600_000

/** Une décision du solveur : au pas `tick`, toucher (ou non) et maintenir (ou non). */
export interface Decision {
  tick: number
  press: boolean
  hold: boolean
}

export interface PathPoint {
  x: number
  y: number
  airborne: boolean
}

export interface SolveReport {
  ok: boolean
  /** Abscisse à franchir (l'arrivée, pour un niveau entier). */
  target: number
  /** Le plus loin atteint sans faute (unités) : là où le niveau coince, s'il coince. */
  reached: number
  /** Les changements de geste du parcours trouvé (toucher, maintenir, lâcher), dans l'ordre. */
  decisions: Decision[]
  /** Le parcours, pas à pas. */
  path: PathPoint[]
  nodes: number
}

interface Node {
  run: GravityRun
  parent: Node | null
  decision: Decision
}

const keyOf = (run: GravityRun, hold: boolean) =>
  `${run.tick}|${Math.round(run.x * 10)}|${Math.round(run.y * 10)}|${run.g}|${Math.round(run.vy)}|${hold ? 1 : 0}|${run.moonLeft > 0 ? 1 : 0}|${run.mini ? 1 : 0}|${run.shield ? 1 : 0}|${run.safe > 0 ? 1 : 0}`

const canDecide = (run: GravityRun) => run.tick % STRIDE === 0 && (run.grounded || run.coyote > 0 || run.moonLeft > 0)

/** Cherche une suite de touchers qui mène de `start` au-delà de `targetX`. */
export function solveFrom(world: GravityWorld, start: GravityRun, targetX: number, maxNodes = MAX_NODES): SolveReport {
  const visited = new Set<string>()
  const stack: Node[] = [{ run: cloneRun(start), parent: null, decision: { tick: start.tick, press: false, hold: false } }]
  let reached = start.x
  let nodes = 0
  while (stack.length > 0 && nodes < maxNodes) {
    const node = stack.pop()!
    nodes += 1
    const { run, decision } = node
    let press = decision.press
    let steps = 0
    // Avance jusqu'à la prochaine décision possible (ou la fin).
    for (;;) {
      stepRun(world, run, { press, hold: decision.hold })
      press = false
      steps += 1
      reached = Math.max(reached, Math.min(run.x, targetX))
      if (run.status !== 'running' || run.x >= targetX) break
      if (steps >= 2 && canDecide(run)) break
    }
    if (run.status === 'dead') continue
    if (run.status === 'finished' || run.x >= targetX) return { target: targetX, ok: true, reached: targetX, ...replay(world, start, chainOf(node), targetX), nodes }
    const key = keyOf(run, decision.hold)
    if (visited.has(key)) continue
    visited.add(key)

    const tick = run.tick
    const moon = run.moonLeft > 0
    const canPress = run.grounded || run.coyote > 0
    // Pile : le dernier empilé est exploré d'abord. On préfère continuer sans toucher.
    const children: Decision[] = []
    if (canPress) {
      children.push({ tick, press: true, hold: moon })
      if (moon) children.push({ tick, press: true, hold: false })
    }
    if (moon) children.push({ tick, press: false, hold: !decision.hold })
    children.push({ tick, press: false, hold: decision.hold })
    for (const child of children) stack.push({ run: cloneRun(run), parent: node, decision: child })
  }
  return { target: targetX, ok: false, reached, decisions: [], path: [], nodes }
}

function chainOf(node: Node): Decision[] {
  const decisions: Decision[] = []
  for (let current: Node | null = node; current; current = current.parent) decisions.push(current.decision)
  return decisions.reverse()
}

/** Rejoue des décisions depuis `start` : le chemin pas à pas, et les seuls changements de geste. */
function replay(world: GravityWorld, start: GravityRun, decisions: Decision[], targetX: number): { decisions: Decision[]; path: PathPoint[] } {
  const run = cloneRun(start)
  const byTick = new Map(decisions.map((decision) => [decision.tick, decision]))
  const path: PathPoint[] = []
  let hold = false
  for (let guard = 0; guard < 200_000 && run.status === 'running' && run.x < targetX; guard += 1) {
    const decision = byTick.get(run.tick)
    if (decision) hold = decision.hold
    stepRun(world, run, { press: decision?.press ?? false, hold })
    path.push({ x: run.x, y: run.y, airborne: !run.grounded })
  }
  // Un lâcher compte autant qu'un toucher : sans lui, une démonstration planerait trop longtemps.
  let held = false
  const changes = decisions.filter((decision) => {
    const keep = decision.press || decision.hold !== held
    held = decision.hold
    return keep
  })
  return { decisions: changes, path }
}

/** Prouve qu'un niveau se finit d'une traite, du départ à l'arrivée. */
export function solveLevel(world: GravityWorld, maxNodes = MAX_NODES): SolveReport {
  return solveFrom(world, startRun(world), world.length, maxNodes)
}

/** Durée (s) d'un parcours sans faute du solveur. */
export const pathSeconds = (report: SolveReport) => report.path.length * TICK
