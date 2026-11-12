import { seededRandom } from '../runner/random'
import {
  FLIP_KICK,
  GRAVITY,
  LEVEL_FORMAT,
  MAX_FALL,
  MINI_SCALE,
  MOON_GRAVITY,
  MOON_MAX_FALL,
  PLAYER_H,
  PLAYER_W,
  SCROLLS_PER_LEVEL,
  START_X,
  TICK,
  WORLD_HEIGHT,
  speedFor,
} from './constants'
import { buildWorld, spawnAt } from './engine'
import { solveFrom, solveLevel, type SolveReport } from './solver'
import type { Gravity, GravityLevel, LevelElement, ThemeId } from './types'

/*
 * Le générateur de niveaux : une suite de « sections » (inverser au-dessus d'un vide, éviter des
 * pics, sauter d'îlot en îlot…) posées l'une après l'autre. Chaque section est calculée à partir de
 * la physique (durée d'une chute, fenêtre où l'on peut inverser) et vérifiée aussitôt par le
 * solveur ; une section impossible est refaite plus douce. À la fin, tout le niveau est prouvé
 * d'une traite, du départ à l'arrivée (une chute renvoie au départ : pas de point de reprise), puis
 * les rouleaux sont posés sur le chemin du solveur. Même graine, même plan : même niveau.
 *
 * Deux entrées : `generateLevel` (sections tirées au hasard selon la difficulté) et `buildLevel`
 * (sections imposées : le plan d'une IA, ou écrit à la main).
 */

export const SECTION_KINDS = ['runway', 'switch', 'spikes', 'wall', 'zigzag', 'islands', 'crumble', 'mover', 'pad', 'shuriken', 'moon', 'mini', 'kawarimi', 'hiraishin', 'flames', 'ghost', 'orbit'] as const
export type SectionKind = (typeof SECTION_KINDS)[number]

/**
 * Sections réglées sur l'horloge : le générateur y cale les flammes et les dalles spectrales sur
 * l'instant où le ninja passera. Dans un niveau qui en compte, les plateformes mobiles ne vont que de
 * haut en bas : une mobile horizontale pousse le ninja en avant et décalerait ce rendez-vous.
 */
const TIMED_SECTIONS: ReadonlySet<SectionKind> = new Set(['flames', 'ghost'])

export interface PlanSection {
  kind: SectionKind
  /** 1 (doux) → 10 (redoutable). */
  intensity: number
}

export interface LevelPlan {
  name: string
  theme: ThemeId
  difficulty: number
  sections: PlanSection[]
}

export const LENGTH_PRESETS = { short: 220, medium: 380, long: 560 } as const
export type LengthPreset = keyof typeof LENGTH_PRESETS

export interface GenerateOptions {
  difficulty: number
  theme: ThemeId
  seed: number
  /** Longueur visée (unités), ou un préréglage. */
  length?: LengthPreset | number
  name?: string
  id?: string
}

export interface BuildResult {
  level: GravityLevel
  report: SolveReport
  /** Essais complets (graines voisines) avant un niveau prouvé. */
  attempts: number
  /** Sections posées, et celles qu'il a fallu adoucir (trop dures pour être prouvées telles quelles). */
  sections: number
  softened: number
}

/** Hauteur libre d'un tunnel de mini-ninja : trop basse pour le ninja à sa taille normale. */
const TUNNEL_H = 1.25
/** Hauteur des portes de taille, depuis la surface. */
const GATE_H = 2.4

/** Hauteur des sceaux de téléportation, depuis la surface. */
const WARP_H = 2.4
/** Épaisseur des dalles spectrales. */
const GHOST_H = 0.8

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1)
const round = (value: number) => Math.round(value * 100) / 100
/** Au millième : les rendez-vous (cycles, décalages) se jouent au centième de seconde. */
const round3 = (value: number) => Math.round(value * 1000) / 1000
const frac = (value: number) => value - Math.floor(value)

/** Un jet de flammes : portée, cycle, part du cycle où il crache. */
interface FlameSpec {
  reach: number
  period: number
  on: number
}

/** Pas nécessaires pour franchir `distance` après une inversion (même intégration que le moteur). */
export function flightTicks(distance: number, lunar = false): number {
  let vy = FLIP_KICK
  let y = 0
  let ticks = 0
  while (y < distance && ticks < 2000) {
    vy = Math.min(lunar ? MOON_MAX_FALL : MAX_FALL, vy + GRAVITY * (lunar ? MOON_GRAVITY : 1) * TICK)
    y += vy * TICK
    ticks += 1
  }
  return ticks
}

/** Une voie : la surface où court le ninja. */
interface Lane {
  /** Ligne de la surface (dessus d'un sol, dessous d'un plafond). */
  y: number
  g: Gravity
  /** Début du bloc de la voie. */
  start: number
  kind: 'block' | 'crumble' | 'mover' | 'ghost'
  /** Spectrale : la part du cycle où elle est là. */
  ghostOn?: number
}

interface Snapshot {
  elements: number
  lane: Lane
  cursor: number
  landed: number
  lastBreather: number
  shift: number
}

/** Fenêtres et respirations d'une section, selon son intensité. */
function tuning(intensity: number, speed: number) {
  const k = (clamp(intensity, 1, 10) - 1) / 9
  return {
    k,
    /** Fenêtre où l'inversion réussit (unités). */
    window: lerp(0.55, 0.15, k) * speed,
    /** Temps de lecture après un atterrissage avant la prochaine action (unités). */
    react: lerp(0.36, 0.14, k) * speed,
  }
}

class Builder {
  elements: LevelElement[] = []
  lane: Lane
  /** Première abscisse où la prochaine action peut commencer (le ninja y est posé sur `lane`). */
  cursor: number
  /** Atterrissage le plus tardif de la dernière inversion. */
  landed: number
  /** Dernière respiration (abscisse). */
  lastBreather: number
  sections = 0
  softened = 0
  readonly speed: number
  /** Distance entre deux respirations (plus longue à haute difficulté). */
  readonly breathEvery: number

  readonly difficulty: number
  readonly rand: () => number
  /** Le niveau a des sections réglées sur l'horloge (cf. `TIMED_SECTIONS`). */
  readonly timed: boolean
  /**
   * Avance prise par les téléportations (unités) : le ninja passe en `x` plus tôt d'autant que la
   * course pure ne le dirait (cf. `timeAt`).
   */
  shift = 0

  constructor(difficulty: number, rand: () => number, timed = false) {
    this.difficulty = difficulty
    this.rand = rand
    this.timed = timed
    this.speed = speedFor(difficulty)
    this.breathEvery = lerp(70, 140, (difficulty - 1) / 9)
    this.lane = { y: 11, g: 1, start: -4, kind: 'block' }
    this.cursor = START_X + this.speed * 1.1
    this.landed = START_X
    this.lastBreather = START_X
  }

  between = (min: number, max: number) => min + (max - min) * this.rand()
  chance = (p: number) => this.rand() < p

  /** L'instant (s) où le ninja passe en `x` : il court à vitesse fixe, et les téléportations l'avancent. */
  timeAt(x: number): number {
    return (x - START_X - this.shift) / this.speed
  }

  snapshot(): Snapshot {
    return { elements: this.elements.length, lane: { ...this.lane }, cursor: this.cursor, landed: this.landed, lastBreather: this.lastBreather, shift: this.shift }
  }

  restore(snapshot: Snapshot): void {
    this.elements.length = snapshot.elements
    this.lane = { ...snapshot.lane }
    this.cursor = snapshot.cursor
    this.landed = snapshot.landed
    this.lastBreather = snapshot.lastBreather
    this.shift = snapshot.shift
  }

  /** Le bloc d'une voie, de `x0` à `x1` : sol ou plafond prolongé hors champ, ou dalle suspendue. */
  laneBlock(lane: Lane, x0: number, x1: number, thickness = 1.2): LevelElement {
    const w = round(x1 - x0)
    const x = round(x0)
    let y: number
    let h: number
    if (lane.g === 1 && lane.y >= 8.5) [y, h] = [lane.y, WORLD_HEIGHT + 3 - lane.y]
    else if (lane.g === -1 && lane.y <= 5.5) [y, h] = [-3, lane.y + 3]
    else if (lane.g === 1) [y, h] = [lane.y, thickness]
    else [y, h] = [lane.y - thickness, thickness]
    return { type: lane.kind === 'crumble' ? 'crumble' : 'block', x, y: round(y), w, h: round(h) }
  }

  /**
   * La voie de `x0` à `x1`. Une spectrale déborde un peu de part et d'autre, mais n'est là que du
   * moment où l'on peut s'y poser (en `x0`) à celui où il faut l'avoir quittée (en `x1`) ; avant, elle
   * clignote à ce rythme.
   */
  laneElement(lane: Lane, x0: number, x1: number): LevelElement {
    if (lane.kind !== 'ghost') return this.laneBlock(lane, x0, x1)
    const from = x0 - this.speed * 0.3
    const to = x1 + this.speed * 0.25
    const appear = this.timeAt(x0) - 0.08
    const vanish = this.timeAt(x1) + 0.04
    const on = lane.ghostOn ?? 0.5
    const period = round3(Math.max(0.6, (vanish - appear) / on))
    return { type: 'ghost', x: round(from), y: round(lane.g === 1 ? lane.y : lane.y - GHOST_H), w: round(to - from), h: GHOST_H, period, on: round3((vanish - appear) / period), phase: round3(frac(-appear / period)) }
  }

  /** Ferme la voie courante en `end`. */
  closeLane(end: number): void {
    if (this.lane.kind === 'mover') return
    this.elements.push(this.laneElement(this.lane, this.lane.start, end))
  }

  /**
   * Un jet de flammes sur la voie `lane`, en `x` : `lethal`, il crache à l'instant où le ninja y
   * passerait (il faut avoir quitté la voie) ; sinon, il dort à cet instant précis et crache avant et
   * après (il impressionne, sans danger pour qui garde le rythme).
   */
  flame(x: number, lane: Lane, spec: FlameSpec, lethal: boolean): void {
    const passing = this.timeAt(x + 0.5)
    const target = lethal ? spec.on / 2 : spec.on + (1 - spec.on) / 2
    this.elements.push({ type: 'flame', x: round(x), y: round(lane.y), w: 1, reach: spec.reach, dir: lane.g === 1 ? 'up' : 'down', period: spec.period, on: spec.on, phase: round3(frac(target - passing / spec.period)) })
  }

  flameSpec(k: number): FlameSpec {
    return { reach: round(lerp(1.6, 2.6, k)), period: round(lerp(1.9, 1.3, k)), on: round(lerp(0.42, 0.55, k)) }
  }

  /** Distance de vol (unités) d'une surface à l'autre. */
  flight(fromY: number, g: Gravity, toY: number, lunar = false): number {
    const distance = g === 1 ? fromY - PLAYER_H - toY : toY - PLAYER_H - fromY
    return flightTicks(Math.max(0.2, distance), lunar) * TICK * this.speed
  }

  /** Une cible pour la prochaine inversion : le grand plafond/sol d'en face, ou une dalle à mi-hauteur. */
  pickTarget(preferSlab: boolean): number {
    const { y, g } = this.lane
    if (g === 1) {
      const slabMax = y - PLAYER_H - 2.2
      if (preferSlab && slabMax >= 5) return round(this.between(5, Math.min(slabMax, 7.5)))
      return round(this.between(2, 4.2))
    }
    const slabMin = y + PLAYER_H + 2.2
    if (preferSlab && slabMin <= 9) return round(this.between(Math.max(slabMin, 6.5), 9))
    return round(this.between(10, 12))
  }

  /**
   * Inverser vers la surface `targetY` : la voie courante s'arrête (ou se prolonge sous un danger),
   * la nouvelle commence de façon que toute inversion faite dans la fenêtre y atterrisse.
   */
  switchTo(
    targetY: number,
    options: {
      window: number
      react: number
      filler?: 'void' | 'spikes' | 'wall' | 'pad' | 'flames'
      kind?: Lane['kind']
      lunar?: boolean
      landRun?: number
      mover?: { dx: number; dy: number; period: number }
      /** Flammes : celles de la voie quittée (`filler`), et les leurres de la nouvelle voie. */
      flames?: FlameSpec
      ghostOn?: number
    },
  ): void {
    const from = this.lane
    const window = Math.max(0.6, options.window)
    const end = this.cursor + window
    const flight = this.flight(from.y, from.g, targetY, options.lunar)
    // Toute inversion entre `end − window` et `end` atterrit sur la nouvelle voie.
    const start = end + flight + PLAYER_W - window
    const filler = options.filler ?? 'void'
    if (filler === 'void') this.closeLane(end)
    else if (filler === 'pad') {
      // Sceau d'inversion au bout de la voie : il retourne le ninja de lui-même.
      this.closeLane(end + 1.5)
      const height = 2.4
      this.elements.push({ type: 'flip', x: round(end - 0.2), y: round(from.g === 1 ? from.y - height : from.y), w: 1, h: height })
    } else if (filler === 'spikes') {
      // La voie continue, mais hérissée de pics : il faut l'avoir quittée avant.
      const hazardEnd = end + flight + 2.5
      this.closeLane(hazardEnd)
      this.elements.push({ type: 'spikes', x: round(end + 0.15), y: from.y, w: round(hazardEnd - end - 0.15), dir: from.g === 1 ? 'up' : 'down' })
    } else if (filler === 'flames') {
      // La voie continue, mais ses bouches crachent juste quand le ninja y passerait : il faut l'avoir
      // quittée, assez tôt pour que le jet ne le rattrape pas en plein vol.
      const spec = options.flames ?? this.flameSpec(0.5)
      const first = end + flightTicks(spec.reach + 0.3) * TICK * this.speed + PLAYER_W + 0.1
      const hazardEnd = Math.max(end + flight + 2.5, first + 2.2)
      this.closeLane(hazardEnd)
      for (let x = first; x < hazardEnd - 1; x += 1.9) this.flame(x, from, spec, true)
    } else {
      // Un mur sur la voie, assez loin pour qu'une inversion faite au dernier moment passe au-dessus.
      const height = this.between(2.6, 3.6)
      const clearance = flightTicks(height + 0.3) * TICK * this.speed + PLAYER_W + 0.1
      const width = this.between(1.2, 2.2)
      this.closeLane(end + clearance + width + 1.5)
      this.elements.push({ type: 'block', x: round(end + clearance), y: round(from.g === 1 ? from.y - height : from.y), w: round(width), h: round(height) })
    }
    const kind = options.kind ?? 'block'
    this.lane = { y: targetY, g: from.g === 1 ? -1 : 1, start, kind, ...(kind === 'ghost' ? { ghostOn: options.ghostOn ?? 0.5 } : {}) }
    const latest = end + flight
    this.landed = latest
    if (kind === 'mover' && options.mover) {
      const length = Math.max(window + 2, 4)
      const thickness = 0.8
      const lane = this.lane
      const y = lane.g === 1 ? lane.y : lane.y - thickness
      this.elements.push({ type: 'mover', x: round(start), y: round(y), w: round(length), h: thickness, dx: options.mover.dx, dy: options.mover.dy, period: options.mover.period, phase: round(this.rand()) })
      this.cursor = start + length - window
    } else {
      this.cursor = latest + Math.max(options.react, options.landRun ?? 0)
    }
    // Des leurres sur la nouvelle voie : ils dorment à l'instant où le ninja passe dessus.
    if (filler === 'flames' && kind === 'block') {
      for (let x = start + 0.6; x < this.cursor - 0.8; x += 2.6) this.flame(x, this.lane, options.flames ?? this.flameSpec(0.5), false)
    }
  }

  /** Une respiration si la dernière est loin : après l'atterrissage, un bout de course tranquille avant la suite. */
  maybeBreather(): void {
    if (this.lane.kind !== 'block' || this.cursor - this.lastBreather < this.breathEvery) return
    const x = round(Math.max(this.lane.start + 0.5, this.landed + 0.6))
    this.lastBreather = x
    this.cursor = Math.max(this.cursor, x + this.speed * 0.55)
  }

  /**
   * Mini-ninja : une porte le rend minuscule, puis un tunnel trop bas pour sa taille normale, hérissé
   * de pics tantôt sur la voie, tantôt au plafond du tunnel : il faut y basculer en rythme. Un nombre
   * pair de rangées ramène le ninja sur sa voie ; une porte lui rend alors sa taille.
   */
  miniTunnel(intensity: number): void {
    const { k } = tuning(intensity, this.speed)
    const lane = this.lane
    const g = lane.g
    const gateX = this.cursor + 0.4
    const gate = (x: number, mini: boolean): LevelElement => ({ type: 'size', x: round(x), y: round(g === 1 ? lane.y - GATE_H : lane.y), w: 0.8, h: GATE_H, mini })
    this.elements.push(gate(gateX, true))
    const roof = lane.y - g * TUNNEL_H
    const t0 = gateX + 0.8 + this.speed * 0.3
    const rows = 2 * clamp(Math.round(lerp(1, 3, k + this.rand() * 0.25)), 1, 3)
    const rowLength = lerp(0.5, 0.3, k) * this.speed
    const gap = lerp(0.45, 0.22, k) * this.speed
    let x = t0 + lerp(0.4, 0.24, k) * this.speed
    for (let row = 0; row < rows; row += 1) {
      // Rangées paires : sur la voie (le ninja doit être au plafond du tunnel) ; impaires : au plafond.
      const onLane = row % 2 === 0
      const floorSide = onLane ? g === 1 : g === -1
      this.elements.push({ type: 'spikes', x: round(x), y: round(onLane ? lane.y : roof), w: round(rowLength), dir: floorSide ? 'up' : 'down' })
      x += rowLength + gap
    }
    const t1 = x - gap + this.speed * 0.2
    const thickness = 1
    this.elements.push({ type: 'block', x: round(t0), y: round(g === 1 ? roof - thickness : roof), w: round(t1 - t0), h: thickness })
    this.elements.push(gate(t1 + 0.6, false))
    this.cursor = t1 + 1.4 + PLAYER_W * MINI_SCALE + this.speed * 0.25
  }

  /** Une section, à l'intensité donnée. */
  section(kind: SectionKind, intensity: number): void {
    const { window, react, k } = tuning(intensity, this.speed)
    switch (kind) {
      case 'runway':
        this.cursor += this.speed * this.between(0.35, 0.75)
        break
      case 'switch':
        this.switchTo(this.pickTarget(false), { window, react })
        break
      case 'spikes':
        this.switchTo(this.pickTarget(false), { window, react, filler: 'spikes' })
        break
      case 'wall':
        this.switchTo(this.pickTarget(false), { window, react, filler: 'wall' })
        break
      case 'pad':
        this.switchTo(this.pickTarget(false), { window: 1.2, react: react * 1.2, filler: 'pad' })
        break
      case 'zigzag': {
        const count = Math.round(lerp(2, 4, k + this.rand() * 0.2))
        for (let index = 0; index < count; index += 1) this.switchTo(this.pickTarget(false), { window, react: react * 0.7 })
        break
      }
      case 'islands': {
        const count = Math.round(lerp(2, 4, k))
        for (let index = 0; index < count; index += 1) this.switchTo(this.pickTarget(index < count - 1 || this.chance(0.5)), { window, react: react * 0.85 })
        break
      }
      case 'crumble': {
        // Atterrir sur une dalle fragile, et en repartir aussitôt.
        this.switchTo(this.pickTarget(true), { window, react: 0, kind: 'crumble' })
        const crumbleEnd = this.landed + this.speed * 0.32
        const back = this.pickTarget(false)
        const flight = this.flight(this.lane.y, this.lane.g, back)
        const earliest = this.lane.start - PLAYER_W
        this.closeLane(crumbleEnd)
        this.lane = { y: back, g: this.lane.g === 1 ? -1 : 1, start: earliest + flight + 0.2, kind: 'block' }
        this.landed = crumbleEnd + flight
        this.cursor = this.landed + react
        break
      }
      case 'mover': {
        // Un niveau réglé sur l'horloge garde ses mobiles verticales (cf. `TIMED_SECTIONS`).
        const vertical = this.chance(0.5) || this.timed
        const target = this.pickTarget(true)
        const amplitude = lerp(1.2, 2.6, k)
        this.switchTo(target, {
          window: window * 1.6,
          react,
          kind: 'mover',
          mover: vertical ? { dx: 0, dy: round((this.lane.g === 1 ? 1 : -1) * amplitude * (this.chance(0.5) ? 1 : -1)), period: round(lerp(3, 1.8, k)) } : { dx: round(lerp(2, 4, k)), dy: 0, period: round(lerp(3.2, 2, k)) },
        })
        // Quitter la plateforme mobile pour une voie fixe, longue et bienveillante.
        const back = this.pickTarget(false)
        this.switchTo(back, { window: window * 1.3, react })
        break
      }
      case 'shuriken': {
        // Un shuriken dans la trajectoire : inverser tôt ou tard, pas au milieu.
        const from = this.lane
        const target = this.pickTarget(false)
        const wide = window * 1.8 + 1.5
        const end = this.cursor + wide
        const flight = this.flight(from.y, from.g, target)
        this.switchTo(target, { window: wide, react })
        const middle = (from.y + target) / 2
        this.elements.push({ type: 'shuriken', x: round(end - wide / 2 + flight / 2 + PLAYER_W / 2), y: round(middle), r: 0.75, dx: 0, dy: round(lerp(0, 2.2, k) * (this.chance(0.5) ? 1 : -1)), period: round(lerp(2.6, 1.6, k)), phase: round(this.rand()) })
        break
      }
      case 'mini':
        if (this.lane.kind === 'block') this.miniTunnel(intensity)
        else this.switchTo(this.pickTarget(false), { window, react })
        break
      case 'kawarimi': {
        // Une bûche de substitution, puis un passage plus rude : elle y pardonne une erreur.
        const lane = this.lane
        this.elements.push({ type: 'log', x: round(this.cursor + 0.5), y: round(lane.g === 1 ? lane.y - PLAYER_H / 2 : lane.y + PLAYER_H / 2) })
        this.cursor += this.speed * 0.3
        this.section(this.chance(0.5) ? 'zigzag' : 'spikes', Math.min(10, intensity + 2))
        break
      }
      case 'moon': {
        // La lune, puis un vide trop long pour un vol normal : maintenir pour planer jusqu'en face.
        const from = this.lane
        const target = this.pickTarget(false)
        const normal = this.flight(from.y, from.g, target)
        const lunar = this.flight(from.y, from.g, target, true)
        const lunarWindow = clamp(lunar - normal - 1.2, 0.8, window * 1.4)
        this.elements.push({ type: 'moon', x: round(this.cursor + 0.5), y: round(from.g === 1 ? from.y - PLAYER_H / 2 : from.y + PLAYER_H / 2) })
        this.cursor += this.speed * 0.6
        this.switchTo(target, { window: lunarWindow, react, lunar: true })
        break
      }
      case 'hiraishin':
        this.hiraishin(intensity)
        break
      case 'flames': {
        // Des bouches sur les deux surfaces : quitter chaque voie avant qu'elle ne crache.
        const spec = this.flameSpec(k)
        const count = Math.round(lerp(2, 4, k + this.rand() * 0.2))
        for (let index = 0; index < count; index += 1) this.switchTo(this.pickTarget(false), { window, react: Math.max(react, this.speed * 0.3), filler: 'flames', flames: spec })
        break
      }
      case 'ghost': {
        // D'une dalle spectrale à l'autre : chacune apparaît pour qu'on s'y pose et s'efface peu après.
        const hops = Math.round(lerp(1, 3, k + this.rand() * 0.25))
        const ghostOn = round(lerp(0.55, 0.45, k))
        for (let index = 0; index < hops; index += 1) this.switchTo(this.pickTarget(true), { window, react: this.speed * lerp(0.14, 0.05, k), kind: 'ghost', ghostOn })
        this.switchTo(this.pickTarget(false), { window, react })
        break
      }
      case 'orbit': {
        // Une roue de lames tourne au milieu de la trajectoire : inverser quand elle laisse passer.
        const from = this.lane
        const target = this.pickTarget(false)
        const wide = window * 2 + 2
        const end = this.cursor + wide
        const flight = this.flight(from.y, from.g, target)
        this.switchTo(target, { window: wide, react })
        const gap = Math.abs(from.y - target)
        const radius = round(clamp(Math.min(lerp(1.4, 2.1, k), gap / 2 - PLAYER_H - 0.8), 0.9, 2.1))
        const blades = k > 0.55 ? 3 : 2
        const base = this.rand()
        const center = { x: round(end - wide / 2 + flight / 2 + PLAYER_W / 2), y: round((from.y + target) / 2) }
        for (let blade = 0; blade < blades; blade += 1) {
          this.elements.push({ type: 'shuriken', ...center, r: 0.7, orbit: radius, period: round(lerp(2.6, 1.7, k)), phase: round3(frac(base + blade / blades)) })
        }
        break
      }
    }
  }

  /**
   * Hiraishin : une barrière sur toute la hauteur du couloir, que seul un sceau de téléportation
   * franchit. Le sceau est sur la voie où l'on arrive (dès l'intensité 4, il faut d'abord inverser
   * pour l'atteindre ; à partir de 7, il est sur une dalle suspendue) ; sa jumelle, de l'autre côté,
   * pose le ninja sur une voie à une autre hauteur, avec la même gravité.
   */
  hiraishin(intensity: number): void {
    const { window, react, k } = tuning(intensity, this.speed)
    if (intensity >= 4 || this.lane.kind !== 'block') this.switchTo(this.pickTarget(intensity >= 7), { window, react: Math.max(react, this.speed * 0.45) })
    const lane = this.lane
    const g = lane.g
    const sealX = this.cursor + this.speed * 0.2
    const wallX = sealX + 1.6
    const wallW = 1.4
    const exitX = wallX + wallW + 1
    // La voie d'arrivée : même gravité, une autre hauteur.
    const heights = g === 1 ? [7.5, 12] : [2, 6.5]
    let y2 = round(this.between(heights[0]!, heights[1]!))
    if (Math.abs(y2 - lane.y) < 1.5) y2 = round(lane.y + (lane.y < (heights[0]! + heights[1]!) / 2 ? 1.8 : -1.8))
    this.closeLane(wallX + 0.2)
    this.elements.push({ type: 'block', x: round(wallX), y: -3, w: wallW, h: WORLD_HEIGHT + 6 })
    this.elements.push({ type: 'warp', x: round(sealX), y: round(g === 1 ? lane.y - WARP_H : lane.y), w: 1, h: WARP_H, tx: round(exitX), ty: round(g === 1 ? y2 - WARP_H : y2) })
    this.shift += round(exitX) - round(sealX)
    this.lane = { y: y2, g, start: exitX - 1.2, kind: 'block' }
    this.landed = exitX
    this.cursor = exitX + PLAYER_W + Math.max(react, this.speed * lerp(0.45, 0.22, k))
  }

  /**
   * Le piège du kawarimi (tutoriel) : une bûche sur la voie, puis une rangée de pics qu'on ne peut pas
   * éviter (rien en face) : la bûche les encaisse, et l'on file, intouchable un instant.
   */
  trap(): void {
    const lane = this.lane
    if (lane.kind !== 'block') {
      this.cursor += this.speed * 0.5
      return
    }
    const logX = this.cursor + 0.5
    this.elements.push({ type: 'log', x: round(logX), y: round(lane.g === 1 ? lane.y - PLAYER_H / 2 : lane.y + PLAYER_H / 2) })
    const spikesX = logX + this.speed * 0.9
    this.elements.push({ type: 'spikes', x: round(spikesX), y: lane.y, w: 1.6, dir: lane.g === 1 ? 'up' : 'down' })
    this.cursor = spikesX + 1.6 + this.speed * 0.6
  }

  /** Le niveau : la voie finale se prolonge au-delà de l'arrivée. */
  finish(meta: { id: string; name: string; theme: ThemeId }): GravityLevel {
    const length = round(this.cursor + this.speed * 0.8)
    this.closeLane(length + 40)
    return {
      format: LEVEL_FORMAT,
      id: meta.id,
      name: meta.name,
      theme: meta.theme,
      difficulty: this.difficulty,
      speed: this.speed,
      length,
      start: { y: 11, g: 1 },
      elements: this.elements.slice(),
    }
  }
}

/** Vérifie la dernière section posée, depuis l'entrée de la section jusqu'à sa sortie. */
function sectionHolds(builder: Builder, entry: { x: number; y: number; g: Gravity }, meta: { theme: ThemeId }): boolean {
  const from = entry.x - 30
  const elements = builder.elements.filter((element) => element.type === 'scroll' || ('w' in element ? element.x + element.w > from : element.x > from))
  const probe: GravityLevel = {
    format: LEVEL_FORMAT,
    id: 'probe',
    name: 'probe',
    theme: meta.theme,
    difficulty: builder.difficulty,
    speed: builder.speed,
    length: builder.cursor + 1,
    start: { y: entry.y, g: entry.g },
    // La voie courante, encore ouverte, est posée jusqu'au bout de la section (une mobile l'est déjà).
    elements: [
      ...elements,
      ...(builder.lane.kind === 'mover' ? [] : [builder.laneElement(builder.lane, builder.lane.start, builder.cursor + 8)]),
    ],
  }
  const world = buildWorld(probe)
  const start = spawnAt(world, entry.x, entry.y, entry.g)
  // L'instant où le ninja arrive à l'entrée de la section (avance des téléportations comprise).
  start.tick = Math.max(0, Math.round(builder.timeAt(entry.x) / TICK))
  return solveFrom(world, start, builder.cursor, 60_000).ok
}

/** Pose une section ; impossible, elle est refaite plus douce, puis en simple inversion bienveillante. */
function placeSection(builder: Builder, kind: SectionKind, intensity: number, meta: { theme: ThemeId }): void {
  const attempts: [SectionKind, number][] = [
    [kind, intensity],
    [kind, intensity],
    [kind, intensity - 2],
    [kind, intensity - 4],
    ['switch', 1],
  ]
  builder.sections += 1
  for (const [index, [tryKind, tryIntensity]] of attempts.entries()) {
    const before = builder.snapshot()
    const entry = { x: builder.cursor - Math.min(2, builder.speed * 0.2), y: builder.lane.y, g: builder.lane.g }
    builder.section(tryKind, clamp(tryIntensity, 1, 10))
    if (sectionHolds(builder, entry, meta)) {
      if (index >= 2) builder.softened += 1
      builder.maybeBreather()
      return
    }
    builder.restore(before)
  }
  builder.softened += 1
  builder.cursor += builder.speed
}

/** Poids des sections tirées au hasard, selon la difficulté. */
function weightsFor(difficulty: number): [SectionKind, number][] {
  const k = (clamp(difficulty, 1, 10) - 1) / 9
  return [
    ['switch', 30 - 12 * k],
    ['spikes', 16],
    ['wall', 10],
    ['runway', 14 - 10 * k],
    ['islands', 8 + 6 * k],
    ['moon', 5],
    ['pad', 4 + 4 * k],
    ['zigzag', k > 0.2 ? 6 + 12 * k : 0],
    ['crumble', k > 0.3 ? 4 + 10 * k : 0],
    ['shuriken', k > 0.3 ? 4 + 10 * k : 0],
    ['mover', k > 0.4 ? 3 + 8 * k : 0],
    ['mini', k > 0.1 ? 3 + 7 * k : 0],
    ['kawarimi', 3 + 3 * k],
    ['hiraishin', k > 0.25 ? 2 + 4 * k : 0],
    ['flames', k > 0.45 ? 3 + 7 * k : 0],
    ['ghost', k > 0.45 ? 3 + 6 * k : 0],
    ['orbit', k > 0.5 ? 2 + 7 * k : 0],
  ]
}

function pickKind(weights: [SectionKind, number][], rand: () => number): SectionKind {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = rand() * total
  for (const [kind, weight] of weights) {
    roll -= weight
    if (roll < 0) return kind
  }
  return 'switch'
}

/** Les rouleaux, sur le chemin du solveur (de préférence en plein vol), vers 25, 55 et 85 % du niveau. */
function placeScrolls(level: GravityLevel, report: SolveReport): void {
  const { path } = report
  if (path.length === 0) return
  const marks = [0.25, 0.55, 0.85].slice(0, SCROLLS_PER_LEVEL)
  for (const mark of marks) {
    const goal = START_X + (level.length - START_X) * mark
    let best = path[0]!
    let score = Infinity
    for (const point of path) {
      const distance = Math.abs(point.x - goal) + (point.airborne ? 0 : 6)
      if (distance < score) [best, score] = [point, distance]
    }
    level.elements.push({ type: 'scroll', x: round(best.x + PLAYER_W / 2), y: round(best.y + PLAYER_H / 2) })
  }
}

/** Identifiant de niveau : lettres, chiffres et tirets. */
export const slugOf = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'niveau'

function assemble(
  difficulty: number,
  seed: number,
  meta: { id: string; name: string; theme: ThemeId },
  timed: boolean,
  layout: (builder: Builder, rand: () => number) => void,
): BuildResult {
  let last: BuildResult | null = null
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const rand = seededRandom(seed + attempt * 7919)
    const builder = new Builder(clamp(Math.round(difficulty), 1, 10), rand, timed)
    layout(builder, rand)
    const level = builder.finish(meta)
    const report = solveLevel(buildWorld(level))
    last = { level, report, attempts: attempt, sections: builder.sections, softened: builder.softened }
    if (report.ok) {
      placeScrolls(level, report)
      return last
    }
  }
  return last!
}

/** Un niveau tiré au hasard (reproductible) selon la difficulté, jusqu'à la longueur visée. */
export function generateLevel(options: GenerateOptions): BuildResult {
  const difficulty = clamp(Math.round(options.difficulty), 1, 10)
  const target = typeof options.length === 'number' ? options.length : LENGTH_PRESETS[options.length ?? 'medium']
  const name = options.name ?? `Niveau ${difficulty}` // i18n-ignore : nom par défaut, remplacé à l'enregistrement
  const meta = { id: options.id ?? slugOf(`${name}-${options.seed}`), name, theme: options.theme }
  const weights = weightsFor(difficulty)
  const timed = weights.some(([kind, weight]) => weight > 0 && TIMED_SECTIONS.has(kind))
  return assemble(difficulty, options.seed, meta, timed, (builder, rand) => {
    // Une mise en jambes, puis des sections jusqu'à la longueur visée (un peu plus rudes vers la fin).
    placeSection(builder, 'switch', Math.max(1, difficulty - 2), meta)
    while (builder.cursor < target) {
      const progress = builder.cursor / target
      const intensity = difficulty + Math.round(rand() * 2 - 1 + (progress > 0.7 ? 0.6 : 0))
      placeSection(builder, pickKind(weights, rand), intensity, meta)
    }
  })
}

/** Un niveau d'après un plan (une IA, ou à la main) : les sections dans l'ordre, prouvées une à une. */
export function buildLevel(plan: LevelPlan, seed: number, id?: string): BuildResult {
  const meta = { id: id ?? slugOf(`${plan.name}-${seed}`), name: plan.name, theme: plan.theme }
  const timed = plan.sections.some((section) => TIMED_SECTIONS.has(section.kind))
  return assemble(plan.difficulty, seed, meta, timed, (builder) => {
    for (const section of plan.sections) placeSection(builder, section.kind, section.intensity, meta)
  })
}

/** Une étape d'un parcours écrit (le tutoriel) : une section, ou le piège du kawarimi. */
export type ScriptStep = PlanSection | { kind: 'trap' }

export interface ScriptedResult extends BuildResult {
  /** L'abscisse où commence chaque étape (là où sa première action devient possible). */
  marks: number[]
}

/** Pose le piège du kawarimi ; s'il ne tient pas (une voie mobile…), une simple course à la place. */
function placeTrap(builder: Builder, meta: { theme: ThemeId }): void {
  const before = builder.snapshot()
  const entry = { x: builder.cursor - Math.min(2, builder.speed * 0.2), y: builder.lane.y, g: builder.lane.g }
  builder.trap()
  if (sectionHolds(builder, entry, meta)) return
  builder.restore(before)
  builder.cursor += builder.speed
}

/** Un parcours écrit étape par étape (le tutoriel), avec l'abscisse où commence chacune. */
export function buildScripted(steps: ScriptStep[], seed: number, meta: { id: string; name: string; theme: ThemeId; difficulty: number }): ScriptedResult {
  let marks: number[] = []
  const timed = steps.some((step) => step.kind !== 'trap' && TIMED_SECTIONS.has(step.kind))
  const result = assemble(meta.difficulty, seed, meta, timed, (builder) => {
    marks = []
    for (const step of steps) {
      marks.push(round(builder.cursor))
      if (step.kind === 'trap') placeTrap(builder, meta)
      else placeSection(builder, step.kind, step.intensity, meta)
    }
  })
  return { ...result, marks }
}
