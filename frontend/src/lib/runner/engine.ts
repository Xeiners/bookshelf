/**
 * Manga Runner 3D — la simulation, sans rendu ni React (testée : `frontend/test/runner.test.ts`).
 *
 * Le coureur reste à l'origine : c'est la piste qui défile. Chaque objet a une abscisse
 * curviligne `s` (mètres depuis le départ) ; le rendu le place à `z = -(s - distance)`.
 * La piste est tirée par rangées, d'une graine : à chaque rangée, au moins une voie reste
 * franchissable (libre, ou à sauter / à glisser), et les murs et trains, qui ne se
 * franchissent pas, ne bouchent jamais les trois voies à la fois.
 *
 * Tout est muté en place (aucune allocation par image) : la boucle de rendu lit l'état.
 */
import {
  CLOUD_TIME,
  DIVE_VELOCITY,
  FLY_HEIGHT,
  GRAVITY,
  HIT_INVULNERABILITY,
  JUMP_VELOCITY,
  KEEP_BEHIND,
  LANE_TIME,
  LANE_WIDTH,
  LIVES,
  MAGNET_TIME,
  PLAYER_HALF_DEPTH,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  QUIZ_TIME,
  REVIVE_CLEARANCE,
  REVIVE_INVULNERABILITY,
  SHIELD_TIME,
  SLIDE_HEIGHT,
  SLIDE_TIME,
  VIEW_AHEAD,
  scoreFor,
  speedAt,
} from './constants'
import { seededRandom } from './random'

export type Lane = -1 | 0 | 1
export type ObstacleKind = 'wall' | 'low' | 'gate' | 'train'
export type PickupKind = 'star' | 'quiz' | 'magnet' | 'cloud'
export type ObjectKind = ObstacleKind | PickupKind

export interface TrackObject {
  id: number
  kind: ObjectKind
  lane: Lane
  /** Début de l'objet le long de la piste (m). */
  s: number
  length: number
  /** Hauteur d'une ✦ (arc au-dessus d'un tome couché). */
  y: number
  /** Variante d'apparence (couleur, motif), tirée avec la piste. */
  variant: number
  /** Ramassé, ou déjà heurté : ne compte plus. */
  done: boolean
}

/** Hauteurs occupées par chaque obstacle (m) : on saute un tome couché, on glisse sous un torii. */
export const OBSTACLE_SPAN: Record<ObstacleKind, readonly [number, number]> = {
  wall: [0, 3.2],
  low: [0, 0.9],
  gate: [1.15, 3.6],
  train: [0, 3.4],
}
const HARD: ReadonlySet<ObjectKind> = new Set(['wall', 'train'])
const isObstacle = (kind: ObjectKind): kind is ObstacleKind => kind === 'wall' || kind === 'low' || kind === 'gate' || kind === 'train'

export type RunAction = 'left' | 'right' | 'up' | 'down'

export type RunEvent =
  | 'star'
  | 'jump'
  | 'slide'
  | 'lane'
  | 'hit'
  | 'magnet'
  | 'cloud'
  | 'quiz'
  | 'quizRight'
  | 'quizWrong'
  | 'over'
  | 'revive'

/** Une question de quiz : trois réponses, une par voie (gauche, centre, droite). */
export interface QuizQuestion {
  prompt: string
  /** Portrait qui accompagne la question (« D'où vient… ? »). */
  image?: string | null
  options: readonly [QuizOption, QuizOption, QuizOption]
  /** Index de la bonne réponse (0 : gauche). */
  answer: 0 | 1 | 2
}
export interface QuizOption {
  label: string
  image?: string | null
}

export interface ActiveQuiz {
  question: QuizQuestion
  /** Fin du temps de réponse (temps de course, s). */
  deadline: number
}

export interface RunState {
  t: number
  distance: number
  speed: number
  lane: Lane
  /** Position latérale réelle (m), qui rejoint la voie. */
  x: number
  /** Départ du changement de voie en cours : position et instant. */
  laneFrom: number
  laneAt: number
  /** Résurrections déjà utilisées pendant la course. */
  revives: number
  y: number
  vy: number
  grounded: boolean
  /** Fin de la glissade en cours (temps de course), 0 : debout. */
  slideUntil: number
  /** Glissade demandée en l'air : elle commence à l'atterrissage. */
  slideOnLanding: boolean
  lives: number
  maxLives: number
  invulnerableUntil: number
  shieldUntil: number
  magnetUntil: number
  cloudUntil: number
  stardust: number
  quizRight: number
  quizAsked: number
  quiz: ActiveQuiz | null
  over: boolean
  objects: TrackObject[]
  /** Ce qui s'est passé depuis la dernière lecture (sons, vibrations, interface). */
  events: RunEvent[]
  /** Générateur de piste. */
  track: TrackGenerator
}

export interface RunOptions {
  lives?: number
}

export function createRun(seed: number, options: RunOptions = {}): RunState {
  const lives = Math.max(1, options.lives ?? LIVES)
  const state: RunState = {
    t: 0,
    distance: 0,
    speed: speedAt(0),
    lane: 0,
    x: 0,
    laneFrom: 0,
    laneAt: -1,
    revives: 0,
    y: 0,
    vy: 0,
    grounded: true,
    slideUntil: 0,
    slideOnLanding: false,
    lives,
    maxLives: lives,
    invulnerableUntil: 0,
    shieldUntil: 0,
    magnetUntil: 0,
    cloudUntil: 0,
    stardust: 0,
    quizRight: 0,
    quizAsked: 0,
    quiz: null,
    over: false,
    objects: [],
    events: [],
    track: new TrackGenerator(seed),
  }
  state.track.fill(state.objects, VIEW_AHEAD)
  return state
}

export const isSliding = (state: RunState) => state.slideUntil > state.t
export const isFlying = (state: RunState) => state.cloudUntil > state.t
export const isShielded = (state: RunState) => state.shieldUntil > state.t
export const scoreOf = (state: RunState) => scoreFor(state.distance, state.stardust, state.quizRight)

/**
 * Revivre après le choc fatal (payé en Poussières, cf. le serveur) : la course reprend,
 * invincible un instant, et les obstacles tout proches disparaissent.
 */
export function revive(state: RunState): void {
  if (!state.over) return
  state.over = false
  state.lives = 1
  state.revives += 1
  state.invulnerableUntil = state.t + REVIVE_INVULNERABILITY
  for (const object of state.objects) {
    if (isObstacle(object.kind) && object.s + object.length > state.distance - 2 && object.s < state.distance + REVIVE_CLEARANCE) object.done = true
  }
  state.events.push('revive')
}

/** Un geste du joueur : changer de voie, sauter, glisser (plonger s'il est en l'air). */
export function act(state: RunState, action: RunAction): void {
  if (state.over) return
  if (action === 'left' || action === 'right') {
    const next = Math.max(-1, Math.min(1, state.lane + (action === 'left' ? -1 : 1))) as Lane
    if (next !== state.lane) {
      state.lane = next
      state.laneFrom = state.x
      state.laneAt = state.t
      state.events.push('lane')
    }
    return
  }
  if (isFlying(state)) return
  if (action === 'up') {
    if (!state.grounded) return
    state.slideUntil = 0
    state.slideOnLanding = false
    state.vy = JUMP_VELOCITY
    state.grounded = false
    state.events.push('jump')
    return
  }
  // Bas : en l'air, on plonge et on glisse à l'atterrissage ; au sol, on glisse tout de suite.
  if (!state.grounded) {
    state.vy = Math.min(state.vy, DIVE_VELOCITY)
    state.slideOnLanding = true
    return
  }
  state.slideUntil = state.t + SLIDE_TIME
  state.events.push('slide')
}

/**
 * Avance la course de `dt` secondes. `ask` fournit une question quand on ramasse un jeton
 * de quiz (`null` : pas de question disponible, le jeton vaut alors quelques ✦).
 */
export function step(state: RunState, dt: number, ask: () => QuizQuestion | null): void {
  if (state.over) return
  const t = (state.t += dt)
  state.speed = speedAt(t)
  const from = state.distance
  state.distance += state.speed * dt

  // Latéral : la position rejoint la voie en courbe douce (cubique : vif au départ, posé à l'arrivée).
  const target = state.lane * LANE_WIDTH
  const progress = Math.min(1, (t - state.laneAt) / LANE_TIME)
  const eased = 1 - (1 - progress) ** 3
  state.x = progress >= 1 ? target : state.laneFrom + (target - state.laneFrom) * eased

  // Vertical : vol sur le nuage, sinon saut et gravité.
  if (isFlying(state)) {
    state.y += (FLY_HEIGHT - state.y) * Math.min(1, dt * 6)
    state.vy = 0
    state.grounded = false
  } else {
    if (!state.grounded || state.y > 0) {
      state.vy -= GRAVITY * dt
      state.y += state.vy * dt
      if (state.y <= 0) {
        state.y = 0
        state.vy = 0
        state.grounded = true
        if (state.slideOnLanding) {
          state.slideOnLanding = false
          state.slideUntil = t + SLIDE_TIME
          state.events.push('slide')
        }
      }
    }
  }

  // Quiz : à l'échéance, la voie où l'on court est la réponse.
  if (state.quiz && t >= state.quiz.deadline) {
    const chosen = state.lane + 1
    if (chosen === state.quiz.question.answer) {
      state.quizRight += 1
      state.shieldUntil = t + SHIELD_TIME
      state.events.push('quizRight')
    } else {
      state.events.push('quizWrong')
    }
    state.quiz = null
  }

  collide(state, from, ask)

  // Piste : on efface derrière, on tire devant.
  const objects = state.objects
  let kept = 0
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index]!
    if (object.s + object.length > state.distance - KEEP_BEHIND) objects[kept++] = object
  }
  objects.length = kept
  state.track.fill(objects, state.distance + VIEW_AHEAD, state.quiz !== null)
}

function collide(state: RunState, from: number, ask: () => QuizQuestion | null): void {
  const t = state.t
  const sliding = isSliding(state)
  const flying = isFlying(state)
  const magnet = state.magnetUntil > t
  const bottom = state.y
  const top = state.y + (sliding ? SLIDE_HEIGHT : PLAYER_HEIGHT)
  // Le coureur balaie [from, distance] pendant l'image : rien ne passe au travers à grande vitesse.
  const back = from - PLAYER_HALF_DEPTH
  const front = state.distance + PLAYER_HALF_DEPTH
  const safe = flying || state.invulnerableUntil > t || state.shieldUntil > t

  for (const object of state.objects) {
    if (object.done) continue
    if (object.s > front + (magnet ? 2.5 : 1)) continue
    if (object.s + object.length < back - (magnet ? 1.5 : 0.6)) continue
    const laneX = object.lane * LANE_WIDTH
    const sideways = Math.abs(state.x - laneX)

    if (isObstacle(object.kind)) {
      if (safe || object.s > front || object.s + object.length < back) continue
      if (sideways > 1.0 + PLAYER_HALF_WIDTH) continue
      const [low, high] = OBSTACLE_SPAN[object.kind]
      if (top <= low || bottom >= high) continue
      object.done = true
      hit(state)
      if (state.over) return
      continue
    }

    // Objets à ramasser : dans sa voie et à sa hauteur ; en vol, toute la voie ; l'aimant attire tout.
    const near = magnet && object.kind === 'star' ? sideways < LANE_WIDTH * 1.6 : sideways < 1.1
    if (!near) continue
    const reach = flying || (magnet && object.kind === 'star') || (object.y + 0.5 > bottom && object.y - 0.5 < top)
    if (!reach) continue
    object.done = true
    pickUp(state, object.kind, ask)
  }
}

function hit(state: RunState): void {
  state.lives -= 1
  state.invulnerableUntil = state.t + HIT_INVULNERABILITY
  state.events.push('hit')
  if (state.lives <= 0) {
    state.lives = 0
    state.over = true
    state.quiz = null
    state.events.push('over')
  }
}

function pickUp(state: RunState, kind: ObjectKind, ask: () => QuizQuestion | null): void {
  const t = state.t
  if (kind === 'star') {
    state.stardust += 1
    state.events.push('star')
  } else if (kind === 'magnet') {
    state.magnetUntil = t + MAGNET_TIME
    state.events.push('magnet')
  } else if (kind === 'cloud') {
    state.cloudUntil = t + CLOUD_TIME
    state.slideUntil = 0
    state.events.push('cloud')
  } else if (kind === 'quiz') {
    const question = state.quiz ? null : ask()
    if (question) {
      state.quiz = { question, deadline: t + QUIZ_TIME }
      state.quizAsked += 1
      state.events.push('quiz')
    } else {
      state.stardust += 5
      state.events.push('star')
    }
  }
}

/* ---- Piste ------------------------------------------------------------------------ */

const LANES: readonly Lane[] = [-1, 0, 1]

/** Tire la piste rangée par rangée ; `hardUntil` retient, par voie, la fin du dernier mur ou train. */
export class TrackGenerator {
  private readonly random: () => number
  private nextRow = 45
  private nextId = 1
  private lastQuiz = 0
  private lastPower = 0
  private readonly hardUntil: Record<Lane, number> = { [-1]: 0, 0: 0, 1: 0 }

  constructor(seed: number) {
    this.random = seededRandom(seed)
  }

  /** Ajoute des rangées jusqu'à `until` mètres. `quizOpen` : un quiz est en cours, pas de nouveau jeton. */
  fill(objects: TrackObject[], until: number, quizOpen = false): void {
    while (this.nextRow < until) {
      this.row(objects, this.nextRow, quizOpen)
      const difficulty = Math.min(1, this.nextRow / 2500)
      this.nextRow += Math.max(16, 30 - 12 * difficulty) + this.random() * 6
    }
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)]!
  }

  private push(objects: TrackObject[], kind: ObjectKind, lane: Lane, s: number, length: number, y = 0): void {
    objects.push({ id: this.nextId++, kind, lane, s, length, y, variant: Math.floor(this.random() * 1000), done: false })
  }

  private row(objects: TrackObject[], s: number, quizOpen: boolean): void {
    const difficulty = Math.min(1, s / 2500)
    const random = this.random
    // Combien de voies occupées : une au début, deux ou trois ensuite.
    const roll = random()
    const count = roll < 0.55 - 0.35 * difficulty ? 1 : roll < 0.9 - 0.15 * difficulty ? 2 : 3
    const lanes = [...LANES].sort(() => random() - 0.5).slice(0, count)
    const blocked = new Set<Lane>()
    // Voies encore bouchées par un mur ou un train d'une rangée précédente.
    for (const lane of LANES) if (this.hardUntil[lane] > s - 3) blocked.add(lane)

    for (const lane of lanes) {
      const hardAllowed = LANES.some((other) => other !== lane && !blocked.has(other))
      let kind: ObstacleKind
      const r = random()
      if (hardAllowed && r < 0.22 + 0.1 * difficulty) kind = 'train'
      else if (hardAllowed && r < 0.45) kind = 'wall'
      else kind = r < 0.72 ? 'low' : 'gate'
      if (blocked.has(lane) && (kind === 'train' || kind === 'wall')) continue
      if (blocked.has(lane)) continue
      const length = kind === 'train' ? 12 + Math.floor(random() * 3) * 4 : kind === 'wall' ? 1.6 : 1
      this.push(objects, kind, lane, s, length)
      if (HARD.has(kind)) {
        blocked.add(lane)
        this.hardUntil[lane] = s + length
      }
      // Un arc de ✦ au-dessus d'un tome couché : la récompense du saut.
      if (kind === 'low' && random() < 0.5) {
        for (let index = 0; index < 5; index += 1) {
          const offset = (index - 2) * 1.6
          this.push(objects, 'star', lane, s + offset, 0.6, 2.1 - (offset * offset) / 6)
        }
      }
    }

    // Une voie libre (sans obstacle à cette rangée) reçoit une ligne de ✦, parfois un bonus.
    const occupied = new Set(objects.filter((object) => object.s === s && object.kind !== 'star').map((object) => object.lane))
    const free = LANES.filter((lane) => !occupied.has(lane) && !blocked.has(lane))
    if (free.length === 0) return
    const lane = this.pick(free)
    if (!quizOpen && s - this.lastQuiz > 320 && random() < 0.6) {
      this.lastQuiz = s
      this.push(objects, 'quiz', lane, s, 0.8, 1)
      return
    }
    if (s - this.lastPower > 420 && random() < 0.35) {
      this.lastPower = s
      this.push(objects, random() < 0.55 ? 'magnet' : 'cloud', lane, s, 0.8, 1)
      return
    }
    if (random() < 0.85) {
      const length = 5 + Math.floor(random() * 4)
      for (let index = 0; index < length; index += 1) this.push(objects, 'star', lane, s - 2 + index * 2.5, 0.6, 1)
    }
  }
}
