import {
  ANCHOR,
  CATCH_UP,
  COYOTE,
  CRUMBLE_DELAY,
  FLIP_BUFFER,
  FLIP_KICK,
  GRAVITY,
  KAWARIMI_SAFE,
  MAX_FALL,
  MINI_SCALE,
  MOON_GRAVITY,
  MOON_MAX_FALL,
  MOON_SECONDS,
  OUT_MARGIN,
  PICKUP_R,
  PLAYER_H,
  PLAYER_W,
  SHURIKEN_R,
  SPIKE_H,
  START_X,
  TICK,
  WORLD_HEIGHT,
} from './constants'
import type { Gravity, GravityLevel } from './types'

/*
 * Gravity Ninja : simulation pure, au pas fixe `TICK`, sans rendu ni hasard. Le ninja court seul ;
 * toucher l'écran inverse la gravité, mais seulement posé sur une surface (comme Gravity Guy) — un
 * toucher en l'air est gardé un instant (`FLIP_BUFFER`). Les plateformes mobiles et les shurikens ne
 * dépendent que du temps : rejouer une partie avec les mêmes touchers donne la même partie, ce qui
 * permet au solveur de prouver qu'un niveau se finit. Une chute renvoie au départ : pas de point de
 * reprise, chaque tentative se joue d'une traite. Testée dans `frontend/test/gravity.test.ts`.
 */

const EPS = 1e-6
/** Tolérance pour savoir si l'on arrive sur une surface (et non par son côté). */
const SURFACE_SLOP = 0.08
/** Largeur d'une case de la grille de recherche (unités). */
const CELL = 4

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type SolidKind = 'block' | 'crumble' | 'mover'

export interface Solid extends Box {
  kind: SolidKind
  /** Mobile : amplitude, durée du cycle, décalage. */
  dx: number
  dy: number
  period: number
  phase: number
}

export interface Spikes {
  x: number
  y: number
  w: number
  dir: 'up' | 'down'
}

export interface Shuriken {
  x: number
  y: number
  r: number
  dx: number
  dy: number
  period: number
  phase: number
}

export interface Pickup {
  kind: 'moon' | 'scroll' | 'log'
  x: number
  y: number
}

/** Porte de taille. */
export interface Gate extends Box {
  mini: boolean
}

/** Un niveau prêt à jouer : éléments rangés par nature et indexés par position. */
export interface GravityWorld {
  level: GravityLevel
  speed: number
  length: number
  solids: Solid[]
  spikes: Spikes[]
  shurikens: Shuriken[]
  flips: Box[]
  gates: Gate[]
  pickups: Pickup[]
  /** Nombre de rouleaux du niveau. */
  scrollCount: number
  grid: {
    solids: Map<number, number[]>
    spikes: Map<number, number[]>
    shurikens: Map<number, number[]>
    flips: Map<number, number[]>
    gates: Map<number, number[]>
    pickups: Map<number, number[]>
  }
}

export type DeathCause = 'fall' | 'spikes' | 'shuriken' | 'left' | 'crushed'

export type GravityEvent =
  | { kind: 'flip' }
  | { kind: 'pad' }
  | { kind: 'land'; speed: number }
  | { kind: 'crumble'; index: number }
  | { kind: 'moon' }
  | { kind: 'scroll'; index: number }
  | { kind: 'shrink' }
  | { kind: 'grow' }
  | { kind: 'log' }
  | { kind: 'substitute' }
  | { kind: 'die'; cause: DeathCause }
  | { kind: 'finish' }

export interface GravityInput {
  /** Toucher (front montant) pendant ce pas. */
  press: boolean
  /** Doigt (ou touche) maintenu : la gravité lunaire, si la lune est active. */
  hold: boolean
}

export interface GravityRun {
  tick: number
  x: number
  y: number
  vy: number
  g: Gravity
  grounded: boolean
  /** Solide sous les pieds (ou au-dessus de la tête), sinon -1. */
  support: number
  coyote: number
  buffer: number
  moonLeft: number
  /** En train de flotter (lune + doigt maintenu, en l'air). */
  lunar: boolean
  cameraX: number
  /** Dans un sceau d'inversion (pour ne l'appliquer qu'une fois). */
  inFlip: boolean
  /** Fragiles touchées : indice du solide → pas où l'on s'y est posé. */
  crumbles: Map<number, number>
  /** Bonus de lune déjà pris (indices de `pickups`). */
  moons: number[]
  /** Rouleaux pris (masque sur leur rang). */
  scrolls: number
  /** Minuscule (porte de taille). */
  mini: boolean
  /** Une bûche de substitution en réserve (kawarimi). */
  shield: boolean
  /** Intouchable par les pièges encore tant de secondes (après une substitution). */
  safe: number
  /** Bûches déjà prises (indices de `pickups`). */
  logs: number[]
  status: 'running' | 'dead' | 'finished'
  cause: DeathCause | null
  deaths: number
  /** Plus loin atteint (unités), toutes tentatives confondues. */
  maxX: number
  /** Pas de la dernière inversion (rendu : la rotation du ninja). */
  flippedAt: number
  events: GravityEvent[]
}

/* ---- Préparation --------------------------------------------------------------------------- */

const cellsOf = (x0: number, x1: number) => {
  const cells: number[] = []
  for (let cell = Math.floor(x0 / CELL); cell <= Math.floor(x1 / CELL); cell += 1) cells.push(cell)
  return cells
}

function indexBy<T>(items: T[], span: (item: T) => [number, number]): Map<number, number[]> {
  const grid = new Map<number, number[]>()
  items.forEach((item, index) => {
    const [x0, x1] = span(item)
    for (const cell of cellsOf(x0, x1)) {
      const list = grid.get(cell)
      if (list) list.push(index)
      else grid.set(cell, [index])
    }
  })
  return grid
}

/** Prépare un niveau : les mêmes éléments, rangés pour la simulation. */
export function buildWorld(level: GravityLevel): GravityWorld {
  const solids: Solid[] = []
  const spikes: Spikes[] = []
  const shurikens: Shuriken[] = []
  const flips: Box[] = []
  const gates: Gate[] = []
  const pickups: Pickup[] = []
  for (const element of level.elements) {
    switch (element.type) {
      case 'block':
      case 'crumble':
        solids.push({ kind: element.type, x: element.x, y: element.y, w: element.w, h: element.h, dx: 0, dy: 0, period: 1, phase: 0 })
        break
      case 'mover':
        solids.push({ kind: 'mover', x: element.x, y: element.y, w: element.w, h: element.h, dx: element.dx, dy: element.dy, period: Math.max(0.5, element.period), phase: element.phase ?? 0 })
        break
      case 'spikes':
        spikes.push({ x: element.x, y: element.y, w: element.w, dir: element.dir })
        break
      case 'shuriken':
        shurikens.push({ x: element.x, y: element.y, r: element.r ?? SHURIKEN_R, dx: element.dx ?? 0, dy: element.dy ?? 0, period: Math.max(0.5, element.period ?? 2), phase: element.phase ?? 0 })
        break
      case 'flip':
        flips.push({ x: element.x, y: element.y, w: element.w, h: element.h })
        break
      case 'size':
        gates.push({ x: element.x, y: element.y, w: element.w, h: element.h, mini: element.mini })
        break
      case 'moon':
      case 'scroll':
      case 'log':
        pickups.push({ kind: element.type, x: element.x, y: element.y })
        break
    }
  }
  return {
    level,
    speed: level.speed,
    length: level.length,
    solids,
    spikes,
    shurikens,
    flips,
    gates,
    pickups,
    scrollCount: pickups.filter((pickup) => pickup.kind === 'scroll').length,
    grid: {
      solids: indexBy(solids, (solid) => [Math.min(solid.x, solid.x + solid.dx), Math.max(solid.x, solid.x + solid.dx) + solid.w]),
      spikes: indexBy(spikes, (spike) => [spike.x, spike.x + spike.w]),
      shurikens: indexBy(shurikens, (shuriken) => [Math.min(shuriken.x, shuriken.x + shuriken.dx) - shuriken.r, Math.max(shuriken.x, shuriken.x + shuriken.dx) + shuriken.r]),
      flips: indexBy(flips, (flip) => [flip.x, flip.x + flip.w]),
      gates: indexBy(gates, (gate) => [gate.x, gate.x + gate.w]),
      pickups: indexBy(pickups, (pickup) => [pickup.x - PICKUP_R, pickup.x + PICKUP_R]),
    },
  }
}

/** Avancement (0 → 1) d'un aller-retour au temps `t`. */
const swing = (t: number, period: number, phase: number) => (1 - Math.cos(2 * Math.PI * (t / period + phase))) / 2

/** Position d'un solide au temps `t` (les mobiles vont et viennent, les autres ne bougent pas). */
export function solidAt(solid: Solid, t: number): { x: number; y: number } {
  if (solid.kind !== 'mover') return solid
  const f = swing(t, solid.period, solid.phase)
  return { x: solid.x + solid.dx * f, y: solid.y + solid.dy * f }
}

/** Centre d'un shuriken au temps `t`. */
export function shurikenAt(shuriken: Shuriken, t: number): { x: number; y: number } {
  if (shuriken.dx === 0 && shuriken.dy === 0) return shuriken
  const f = swing(t, shuriken.period, shuriken.phase)
  return { x: shuriken.x + shuriken.dx * f, y: shuriken.y + shuriken.dy * f }
}

/** Une fragile est-elle encore là au pas `tick` ? */
export function crumbleStanding(run: GravityRun, index: number, tick = run.tick): boolean {
  const touched = run.crumbles.get(index)
  return touched === undefined || (tick - touched) * TICK < CRUMBLE_DELAY
}

const near = (grid: Map<number, number[]>, x0: number, x1: number): number[] => {
  const first = Math.floor(x0 / CELL)
  const last = Math.floor(x1 / CELL)
  if (first === last) return grid.get(first) ?? []
  const seen = new Set<number>()
  for (let cell = first; cell <= last; cell += 1) for (const index of grid.get(cell) ?? []) seen.add(index)
  return [...seen]
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS

/* ---- Partie --------------------------------------------------------------------------------- */

const FULL_SIZE = { w: PLAYER_W, h: PLAYER_H }
const MINI_SIZE = { w: PLAYER_W * MINI_SCALE, h: PLAYER_H * MINI_SCALE }

/** La boîte du ninja : normale, ou minuscule après une porte de taille. */
export const sizeOf = (run: { mini: boolean }) => (run.mini ? MINI_SIZE : FULL_SIZE)

/** La boîte qui touche les pièges : un peu plus petite que le ninja (ils se frôlent, mais pas au pixel). */
function bodyOf(run: GravityRun): Box {
  const { w, h } = sizeOf(run)
  return { x: run.x + w * 0.15, y: run.y + h * 0.077, w: w * 0.7, h: h * 0.846 }
}

/** Le pas où le ninja passe en `x` en courant sans encombre depuis le départ (les mobiles s'y calent). */
export const tickAt = (world: GravityWorld, x: number) => Math.max(0, Math.round((x - START_X) / world.speed / TICK))

/** Le ninja posé sur sa surface, en `x`, au pas où il y passerait sans encombre. */
export function spawnAt(world: GravityWorld, x: number, y: number, g: Gravity): GravityRun {
  return {
    tick: tickAt(world, x),
    x,
    y: g === 1 ? y - PLAYER_H : y,
    vy: 0,
    g,
    grounded: false,
    support: -1,
    coyote: 0,
    buffer: 0,
    moonLeft: 0,
    lunar: false,
    cameraX: x - ANCHOR,
    inFlip: false,
    crumbles: new Map(),
    moons: [],
    scrolls: 0,
    mini: false,
    shield: false,
    safe: 0,
    logs: [],
    status: 'running',
    cause: null,
    deaths: 0,
    maxX: x,
    flippedAt: -1000,
    events: [],
  }
}

/** Une nouvelle partie (une tentative), au départ du niveau. */
export function startRun(world: GravityWorld): GravityRun {
  const run = spawnAt(world, START_X, world.level.start.y, world.level.start.g)
  settle(world, run)
  return run
}

/** Copie indépendante (le solveur explore plusieurs suites à partir d'un même état). */
export function cloneRun(run: GravityRun): GravityRun {
  return { ...run, crumbles: new Map(run.crumbles), moons: run.moons.slice(), logs: run.logs.slice(), events: [] }
}

/**
 * Après une chute, tout recommence au départ, comme une nouvelle tentative : pas de point de
 * reprise. Dalles fragiles, lunes, bûches et rouleaux sont remis en place (un rouleau ne compte que pris
 * dans la tentative qui finit le niveau) ; restent le compte des chutes et l'avancement record.
 */
export function restartRun(world: GravityWorld, run: GravityRun): void {
  Object.assign(run, { ...startRun(world), deaths: run.deaths, maxX: run.maxX })
}

/** Pose le ninja sur sa surface (contact), sans bouger. */
function settle(world: GravityWorld, run: GravityRun): void {
  const contact = supportOf(world, run)
  run.grounded = contact >= 0
  run.support = contact
}

/** Le solide sur lequel le ninja est posé (dans le sens de la gravité), ou -1. */
function supportOf(world: GravityWorld, run: GravityRun): number {
  const { w, h } = sizeOf(run)
  const probe: Box = { x: run.x, y: run.y + run.g * 0.03, w, h }
  let best = -1
  for (const index of near(world.grid.solids, run.x - 0.5, run.x + w + 0.5)) {
    const solid = world.solids[index]!
    if (solid.kind === 'crumble' && !crumbleStanding(run, index)) continue
    const at = solidAt(solid, run.tick * TICK)
    if (overlaps(probe, { x: at.x, y: at.y, w: solid.w, h: solid.h })) {
      best = index
      if (solid.kind !== 'crumble') return index
    }
  }
  return best
}

function flip(run: GravityRun, event: GravityEvent): void {
  run.g = run.g === 1 ? -1 : 1
  run.vy = run.g * FLIP_KICK
  run.grounded = false
  run.support = -1
  run.coyote = 0
  run.buffer = 0
  run.flippedAt = run.tick
  run.events.push(event)
}

/** Porte de taille : le ninja rapetisse (ou grandit), les pieds sur sa surface (ou la tête sous son plafond). */
function resize(run: GravityRun, mini: boolean): void {
  const before = sizeOf(run).h
  run.mini = mini
  if (run.g === 1) run.y += before - sizeOf(run).h
  run.events.push({ kind: mini ? 'shrink' : 'grow' })
}

function die(run: GravityRun, cause: DeathCause): void {
  run.status = 'dead'
  run.cause = cause
  run.deaths += 1
  run.events.push({ kind: 'die', cause })
}

/** Les solides présents au pas courant, autour d'une plage horizontale (positions du moment). */
function solidsNear(world: GravityWorld, run: GravityRun, x0: number, x1: number): { index: number; box: Box }[] {
  const t = run.tick * TICK
  const list: { index: number; box: Box }[] = []
  for (const index of near(world.grid.solids, x0, x1)) {
    const solid = world.solids[index]!
    if (solid.kind === 'crumble' && !crumbleStanding(run, index)) continue
    const at = solidAt(solid, t)
    list.push({ index, box: { x: at.x, y: at.y, w: solid.w, h: solid.h } })
  }
  return list
}

/** Avance la partie d'un pas. Les événements du pas sont dans `run.events` (vidés à chaque pas). */
export function stepRun(world: GravityWorld, run: GravityRun, input: GravityInput): void {
  run.events = []
  if (run.status !== 'running') return
  const { w: pw, h: ph } = sizeOf(run)
  const before = run.tick * TICK
  run.tick += 1
  const now = run.tick * TICK

  // Porté par une plateforme mobile.
  if (run.grounded && run.support >= 0) {
    const solid = world.solids[run.support]!
    if (solid.kind === 'mover') {
      const from = solidAt(solid, before)
      const to = solidAt(solid, now)
      run.x += Math.max(0, to.x - from.x)
      run.y += to.y - from.y
    }
  }

  if (input.press) run.buffer = FLIP_BUFFER
  if (run.buffer > 0 && (run.grounded || run.coyote > 0)) flip(run, { kind: 'flip' })
  run.buffer = Math.max(0, run.buffer - TICK)
  run.coyote = Math.max(0, run.coyote - TICK)
  run.moonLeft = Math.max(0, run.moonLeft - TICK)
  run.safe = Math.max(0, run.safe - TICK)
  run.lunar = run.moonLeft > 0 && input.hold && !run.grounded

  // Course : à la vitesse du niveau, un peu plus vite tant qu'on a du retard sur la caméra.
  const anchor = run.cameraX + ANCHOR
  let nextX = run.x + world.speed * TICK
  if (run.x < anchor - EPS) nextX = Math.min(run.x + world.speed * CATCH_UP * TICK, Math.max(anchor, nextX))
  const right = run.x + pw
  for (const { box } of solidsNear(world, run, run.x, nextX + pw)) {
    const vertical = run.y < box.y + box.h - EPS && run.y + ph > box.y + EPS
    // Un mur devant (son côté gauche, atteint pendant ce pas) arrête la course.
    if (vertical && box.x >= right - SURFACE_SLOP && box.x < nextX + pw) nextX = Math.min(nextX, box.x - pw - EPS)
  }
  run.x = Math.max(run.x, nextX)

  // Chute (vers le bas ou le haut selon la gravité).
  const lunar = run.lunar
  const maxFall = lunar ? MOON_MAX_FALL : MAX_FALL
  run.vy += run.g * GRAVITY * (lunar ? MOON_GRAVITY : 1) * TICK
  run.vy = Math.max(-maxFall, Math.min(maxFall, run.vy))
  const fromTop = run.y
  let nextY = run.y + run.vy * TICK
  const wasGrounded = run.grounded
  let landed = -1
  for (const { index, box } of solidsNear(world, run, run.x, run.x + pw)) {
    const horizontal = run.x < box.x + box.w - EPS && run.x + pw > box.x + EPS
    if (!horizontal) continue
    if (nextY + ph > box.y + EPS && nextY < box.y + box.h - EPS) {
      if (run.vy >= 0 && fromTop + ph <= box.y + SURFACE_SLOP) {
        // Arrivée sur le dessus.
        nextY = box.y - ph
        if (run.g === 1) landed = index
      } else if (run.vy <= 0 && fromTop >= box.y + box.h - SURFACE_SLOP) {
        // Arrivée par-dessous.
        nextY = box.y + box.h
        if (run.g === -1) landed = index
      }
    }
  }
  const impact = Math.abs(run.vy)
  run.y = nextY
  if (landed >= 0) run.vy = 0

  // Encore pris dans un solide (une plateforme mobile s'est refermée) : écrasé.
  for (const { box } of solidsNear(world, run, run.x, run.x + pw)) {
    if (overlaps({ x: run.x + 0.1, y: run.y + 0.1, w: pw - 0.2, h: ph - 0.2 }, box)) {
      die(run, 'crushed')
      return
    }
  }

  const support = supportOf(world, run)
  run.grounded = support >= 0
  run.support = support
  if (run.grounded) {
    if (run.vy * run.g > 0) run.vy = 0
    if (!wasGrounded) run.events.push({ kind: 'land', speed: impact })
    const solid = world.solids[support]!
    if (solid.kind === 'crumble' && !run.crumbles.has(support)) {
      run.crumbles.set(support, run.tick)
      run.events.push({ kind: 'crumble', index: support })
    }
    // Un toucher gardé en l'air part dès l'atterrissage.
    if (run.buffer > 0) flip(run, { kind: 'flip' })
  } else if (wasGrounded && run.flippedAt !== run.tick) {
    run.coyote = COYOTE
  }

  interact(world, run)
  run.cameraX += world.speed * TICK
  if (run.status !== 'running') return

  const size = sizeOf(run)
  if (run.y > WORLD_HEIGHT + OUT_MARGIN || run.y + size.h < -OUT_MARGIN) die(run, 'fall')
  else if (run.x + size.w < run.cameraX) die(run, 'left')
  else if (run.x >= world.length) {
    run.status = 'finished'
    run.events.push({ kind: 'finish' })
  }
  run.maxX = Math.max(run.maxX, Math.min(run.x, world.length))
}

/** Portes, pièges, sceaux et bonus touchés à ce pas. */
function interact(world: GravityWorld, run: GravityRun): void {
  const t = run.tick * TICK
  const x0 = run.x - 1
  const x1 = run.x + PLAYER_W + 1

  for (const index of near(world.grid.gates, x0, x1)) {
    const gate = world.gates[index]!
    if (gate.mini !== run.mini && overlaps(bodyOf(run), gate)) resize(run, gate.mini)
  }

  const body = bodyOf(run)
  const { w, h } = sizeOf(run)
  if (run.safe <= 0) {
    let hit: DeathCause | null = null
    for (const index of near(world.grid.spikes, x0, x1)) {
      const spike = world.spikes[index]!
      const tall = SPIKE_H * 0.75
      const box: Box = { x: spike.x + 0.1, y: spike.dir === 'up' ? spike.y - tall : spike.y, w: spike.w - 0.2, h: tall }
      if (overlaps(body, box)) {
        hit = 'spikes'
        break
      }
    }
    if (!hit) {
      for (const index of near(world.grid.shurikens, x0, x1)) {
        const shuriken = world.shurikens[index]!
        const at = shurikenAt(shuriken, t)
        const nearestX = Math.max(body.x, Math.min(at.x, body.x + body.w))
        const nearestY = Math.max(body.y, Math.min(at.y, body.y + body.h))
        if ((nearestX - at.x) ** 2 + (nearestY - at.y) ** 2 < (shuriken.r * 0.8) ** 2) {
          hit = 'shuriken'
          break
        }
      }
    }
    if (hit) {
      if (!run.shield) return die(run, hit)
      // Kawarimi : la bûche prend le coup à sa place, et le ninja file, intouchable un instant.
      run.shield = false
      run.safe = KAWARIMI_SAFE
      run.events.push({ kind: 'substitute' })
    }
  }

  let inFlip = false
  for (const index of near(world.grid.flips, x0, x1)) if (overlaps(body, world.flips[index]!)) inFlip = true
  if (inFlip && !run.inFlip) flip(run, { kind: 'pad' })
  run.inFlip = inFlip

  for (const index of near(world.grid.pickups, x0, x1)) {
    const pickup = world.pickups[index]!
    const touches = pickup.x + PICKUP_R > run.x && pickup.x - PICKUP_R < run.x + w && pickup.y + PICKUP_R > run.y && pickup.y - PICKUP_R < run.y + h
    if (!touches) continue
    if (pickup.kind === 'moon' && !run.moons.includes(index)) {
      run.moons.push(index)
      run.moonLeft = MOON_SECONDS
      run.events.push({ kind: 'moon' })
    } else if (pickup.kind === 'log' && !run.logs.includes(index)) {
      run.logs.push(index)
      run.shield = true
      run.events.push({ kind: 'log' })
    } else if (pickup.kind === 'scroll') {
      const rank = scrollRank(world, index)
      if (!(run.scrolls & (1 << rank))) {
        run.scrolls |= 1 << rank
        run.events.push({ kind: 'scroll', index })
      }
    }
  }
}

/** Rang d'un rouleau parmi les rouleaux du niveau (0, 1, 2…). */
export function scrollRank(world: GravityWorld, pickupIndex: number): number {
  let rank = 0
  for (let index = 0; index < pickupIndex; index += 1) if (world.pickups[index]!.kind === 'scroll') rank += 1
  return rank
}

/** Nombre de rouleaux d'un masque. */
export const scrollsIn = (mask: number) => {
  let count = 0
  for (let value = mask; value; value >>= 1) count += value & 1
  return count
}

/** Avancement affiché (0 → 100). */
export const progressOf = (world: GravityWorld, x: number) => Math.max(0, Math.min(100, Math.floor(((x - START_X) / (world.length - START_X)) * 100)))
