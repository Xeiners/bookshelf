/**
 * Manga Runner 3D — la simulation, sans rendu ni React (testée : `frontend/test/runner.test.ts`).
 *
 * Le coureur reste à l'origine : c'est la piste qui défile. Chaque objet a une abscisse
 * curviligne `s` (mètres depuis le départ) ; le rendu le place à `z = -(s - distance)`.
 * La piste est tirée par rangées, d'une graine : à chaque rangée, au moins une voie reste
 * franchissable (libre, ou à sauter / à glisser), et les murs et trains, qui ne se
 * franchissent pas, ne bouchent jamais les trois voies à la fois.
 *
 * Certains trains ont une rampe : on monte sur leur toit (le « support » sous le coureur).
 * Un jeton de quiz vide la route devant soi le temps de répondre : la voie où l'on court à
 * l'échéance donne la réponse. Les monstres se pulvérisent d'un tir (avec une recharge).
 * Un tremplin lance le coureur jusqu'à Skypia, un tunnel l'emmène aux Enfers : ces
 * royaumes ont leur piste, le temps d'une trentaine de secondes. Tous les 1 500 m, un boss
 * barre la route : on le bat en enchaînant des gestes (trois attaques).
 *
 * Tout est muté en place (aucune allocation par image) : la boucle de rendu lit l'état.
 */
import {
  ACCEL,
  BOSS_AFTER,
  BOSS_COMBOS,
  BOSS_COUNTER,
  BOSS_DEATH,
  BOSS_EVERY,
  BOSS_HP,
  BOSS_IMPACT,
  BOSS_INTRO,
  BOSS_PENALTY,
  BOSS_REWARD,
  BOSS_STRIKE,
  CLOUD_TIME,
  comboTime,
  DIVE_VELOCITY,
  FLY_HEIGHT,
  GRAVITY,
  HIT_INVULNERABILITY,
  JUMP_VELOCITY,
  KEEP_BEHIND,
  LANE_TIME,
  LAUNCH_SWITCH,
  LAUNCH_VELOCITY,
  LANE_WIDTH,
  LIVES,
  MAGNET_TIME,
  PORTAL_EVERY,
  PORTAL_FIRST,
  PLAYER_HALF_DEPTH,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  QUIZ_CLEAR_MARGIN,
  QUIZ_TIME,
  RAMP_LENGTH,
  REALM_GAP,
  REALM_LANDING,
  REALM_TIME,
  REVIVE_CLEARANCE,
  REVIVE_INVULNERABILITY,
  SHIELD_TIME,
  SHIFT_LEAD,
  SHIFT_TIME,
  SHOT_COOLDOWN,
  SHOT_RANGE,
  SHOT_REWARD,
  SLIDE_HEIGHT,
  SLIDE_TIME,
  START_SPEED,
  STUMBLE_RECOVERY,
  STUMBLE_SLOWDOWN,
  STUN_TIME,
  TRAIN_ROOF,
  TUNNEL_SWITCH,
  VIEW_AHEAD,
  scoreFor,
  speedAt,
} from './constants'
import { seededRandom } from './random'

export type Lane = -1 | 0 | 1
export type ObstacleKind = 'wall' | 'low' | 'gate' | 'train'
/** `pad` : tremplin vers Skypia ; `tunnel` : entrée des Enfers. */
export type PickupKind = 'star' | 'quiz' | 'magnet' | 'cloud' | 'pad' | 'tunnel'
/** Le monde où l'on court : la Terre, les îles célestes (Skypia), les Enfers. */
export type Realm = 'earth' | 'sky' | 'under'
export type ObjectKind = ObstacleKind | PickupKind

export interface TrackObject {
  id: number
  kind: ObjectKind
  lane: Lane
  /** Début de l'objet le long de la piste (m). */
  s: number
  length: number
  /** Hauteur d'une ✦ (arc au-dessus d'un tome couché, toit d'un train). */
  y: number
  /** Obstacle posé sur un support (un monstre sur le toit d'un train) : sa hauteur (m). */
  base?: number
  /** Royaume de l'objet (absent : la Terre). */
  realm?: Realm
  /** Variante d'apparence (couleur, motif), tirée avec la piste. */
  variant: number
  /** Ramassé, ou déjà heurté : ne compte plus. */
  done: boolean
  /** Monstre qui feinte : la voie où il bondit, et son avancement (0 à 1). */
  shiftTo?: Lane
  shift?: number
  /** Pulvérisé par l'Éveil ou par un tir (instant `t`) : il vole en éclats au lieu de bloquer. */
  smashedAt?: number
  /** Train : une rampe devant lui (on monte sur le toit) ; ou accroché au train d'avant (toit continu). */
  ramp?: boolean
  linked?: boolean
  /** Effacé par un quiz (la route se vide le temps de répondre) : il n'existe plus. */
  cleared?: boolean
}

/** Position latérale d'un objet (m) : sa voie, ou entre deux voies quand un monstre bondit. */
export function objectX(object: TrackObject): number {
  const from = object.lane * LANE_WIDTH
  if (object.shiftTo === undefined) return from
  const p = object.shift ?? 0
  return from + (object.shiftTo - object.lane) * LANE_WIDTH * p * p * (3 - 2 * p)
}

/**
 * Hauteurs occupées par chaque obstacle (m) : on saute un tome couché, on glisse sous un
 * torii, on court sur le toit d'un train.
 */
export const OBSTACLE_SPAN: Record<ObstacleKind, readonly [number, number]> = {
  wall: [0, 3.2],
  low: [0, 0.9],
  gate: [1.15, 3.6],
  train: [0, TRAIN_ROOF - 0.3],
}
/** Hauteurs occupées par un obstacle donné (posé sur son support : un monstre sur un toit). */
export function spanOf(object: TrackObject): readonly [number, number] {
  const [low, high] = OBSTACLE_SPAN[object.kind as ObstacleKind]
  const base = object.base ?? 0
  return base === 0 ? [low, high] : [low + base, high + base]
}
const HARD: ReadonlySet<ObjectKind> = new Set(['wall', 'train'])
export const isObstacle = (kind: ObjectKind): kind is ObstacleKind => kind === 'wall' || kind === 'low' || kind === 'gate' || kind === 'train'
/** Ce qu'un tir peut pulvériser (le rendu n'offre que les monstres : debout ou étendus). */
const SHOOTABLE: ReadonlySet<ObjectKind> = new Set(['wall', 'low'])

/** Demi-largeur d'un toit de train (m) : au-delà, on tombe. */
const ROOF_HALF_WIDTH = 1.1

/**
 * Le support sous un point de la piste : le sol (0), le toit d'un train, ou la pente de sa
 * rampe. `x` : position latérale (m), `s` : abscisse (m).
 */
export function supportAt(objects: readonly TrackObject[], x: number, s: number): number {
  let ground = 0
  for (const object of objects) {
    if (object.kind !== 'train' || object.cleared) continue
    if (Math.abs(x - object.lane * LANE_WIDTH) > ROOF_HALF_WIDTH) continue
    if (s >= object.s && s <= object.s + object.length) return TRAIN_ROOF
    if (object.ramp && s >= object.s - RAMP_LENGTH && s < object.s) ground = Math.max(ground, (TRAIN_ROOF * (s - object.s + RAMP_LENGTH)) / RAMP_LENGTH)
  }
  return ground
}

export type RunAction = 'left' | 'right' | 'up' | 'down'

export type RunEvent =
  | 'star'
  | 'jump'
  | 'slide'
  | 'lane'
  | 'stumble'
  | 'hit'
  | 'magnet'
  | 'cloud'
  | 'quiz'
  | 'quizRight'
  | 'quizWrong'
  | 'smash'
  | 'shot'
  | 'clear'
  | 'boss'
  | 'comboStep'
  | 'comboMiss'
  | 'bossCast'
  | 'bossHit'
  | 'bossCounter'
  | 'bossDown'
  | 'bossDefeated'
  | 'launch'
  | 'tunnel'
  | 'realm'
  | 'realmExit'
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

/** Phases d'un combat de boss. */
export type BossPhase = 'intro' | 'combo' | 'strike' | 'counter' | 'dying'

/** Un combat de boss en cours. */
export interface BossFight {
  /** Numéro du boss (0, 1, 2…) : le rendu en tire le monstre, le combo sa suite de gestes. */
  index: number
  phase: BossPhase
  /** Début de la phase (temps de course). */
  phaseAt: number
  hp: number
  /** Attaque en cours (0 à 2) : la compétence lancée. */
  round: number
  /** Gestes à enchaîner, et combien sont déjà faits. */
  combo: RunAction[]
  progress: number
  /** Fin du temps pour le combo (temps de course). */
  deadline: number
  /** Contre-attaques subies ; dernier faux geste (temps de course). */
  counters: number
  missAt: number
  /** L'attaque lancée a touché (une fois par attaque). */
  struck: boolean
}

export interface RunState {
  t: number
  /** Graine de la course (combos des boss). */
  seed: number
  distance: number
  speed: number
  lane: Lane
  /** Position latérale réelle (m), qui rejoint la voie, et sa vitesse (m/s). */
  x: number
  vx: number
  /** Départ du changement de voie en cours : position, vitesse latérale, instant, voie quittée. */
  laneFrom: number
  laneSpeed: number
  laneAt: number
  laneBefore: Lane
  /** Dernier trébuchement (temps de course) ; sonné jusqu'à `stunnedUntil`. */
  stumbleAt: number
  stunnedUntil: number
  /** Frôlements ignorés jusque-là (le temps de rebondir hors de l'obstacle). */
  graceUntil: number
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
  /** La route est vide jusque-là (m) : posée par un quiz. */
  clearUntil: number
  /** Support sous le coureur (sol, toit ou rampe), en m. */
  ground: number
  /** Prochain tir possible (temps de course), monstres pulvérisés, et le dernier tir (pour le rayon). */
  shotReadyAt: number
  kills: number
  lastShot: { at: number; x: number; y: number; s: number } | null
  /** Le monde où l'on court, et le tronçon (m) qu'il couvre ; la bascule attendue (tremplin, tunnel). */
  realm: Realm
  realmFrom: number
  realmUntil: number
  pendingRealm: { realm: Exclude<Realm, 'earth'>; at: number } | null
  /** Passage d'un monde à l'autre : intouchable, sans clignoter (temps de course). */
  transitUntil: number
  /** Combat de boss en cours, distance du prochain, boss vaincus. */
  boss: BossFight | null
  /** Fin du dernier combat (temps de course) : la course repart en douceur. */
  bossEndedAt: number
  nextBoss: number
  bossesBeaten: number
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
    seed,
    distance: 0,
    speed: speedAt(0),
    lane: 0,
    x: 0,
    vx: 0,
    laneFrom: 0,
    laneSpeed: 0,
    laneAt: -1,
    laneBefore: 0,
    stumbleAt: -10,
    stunnedUntil: 0,
    graceUntil: 0,
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
    clearUntil: 0,
    ground: 0,
    shotReadyAt: 0,
    kills: 0,
    lastShot: null,
    realm: 'earth',
    realmFrom: 0,
    realmUntil: 0,
    pendingRealm: null,
    transitUntil: 0,
    boss: null,
    bossEndedAt: -10,
    nextBoss: BOSS_EVERY,
    bossesBeaten: 0,
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
export const isStunned = (state: RunState) => state.stunnedUntil > state.t
export const shotReady = (state: RunState) => state.t >= state.shotReadyAt
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
  state.stunnedUntil = 0
  state.invulnerableUntil = state.t + REVIVE_INVULNERABILITY
  for (const object of state.objects) {
    if (isObstacle(object.kind) && object.s + object.length > state.distance - 2 && object.s < state.distance + REVIVE_CLEARANCE) object.done = true
  }
  state.events.push('revive')
}

/** Un geste du joueur : changer de voie, sauter, glisser (plonger s'il est en l'air). */
export function act(state: RunState, action: RunAction): void {
  if (state.over) return
  // Combat de boss : les gestes lancent les attaques (on ne change pas de voie).
  if (state.boss) {
    bossInput(state, state.boss, action)
    return
  }
  if (action === 'left' || action === 'right') {
    const next = Math.max(-1, Math.min(1, state.lane + (action === 'left' ? -1 : 1))) as Lane
    if (next !== state.lane) {
      steer(state, next)
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

/** Aller droit dans une voie (une réponse touchée au quiz : on court vers sa voie). */
export function goToLane(state: RunState, lane: Lane): void {
  if (state.over || lane === state.lane) return
  steer(state, lane)
  state.events.push('lane')
}

/** Part vers une voie, depuis la position et la vitesse latérale du moment. */
function steer(state: RunState, lane: Lane): void {
  state.laneBefore = state.lane
  state.lane = lane
  state.laneFrom = state.x
  state.laneSpeed = state.vx
  state.laneAt = state.t
}

/**
 * Tirer sur un obstacle (un monstre touché du doigt) : pulvérisé s'il est devant, à portée,
 * et si le tir est rechargé. Rapporte quelques ✦. Renvoie `false` si le tir ne part pas.
 */
export function shoot(state: RunState, id: number): boolean {
  if (state.over || !shotReady(state)) return false
  const object = state.objects.find((candidate) => candidate.id === id)
  if (!object || object.done || object.cleared || object.smashedAt !== undefined || !SHOOTABLE.has(object.kind)) return false
  const ahead = object.s - state.distance
  if (ahead < -0.5 || ahead > SHOT_RANGE) return false
  const [low, high] = spanOf(object)
  state.lastShot = { at: state.t, x: objectX(object), y: object.kind === 'low' ? 0.5 : (low + Math.min(high, low + 2.4)) / 2, s: object.s + object.length / 2 }
  object.done = true
  object.smashedAt = state.t
  state.shotReadyAt = state.t + SHOT_COOLDOWN
  state.kills += 1
  state.stardust += SHOT_REWARD
  state.events.push('shot')
  return true
}

/**
 * Répondre au quiz en cours : à l'échéance, la voie où l'on court ; `null` : pas de réponse.
 * Bonne réponse : l'Éveil (invincible, il pulvérise les obstacles et attire les ✦).
 */
export function answerQuiz(state: RunState, choice: 0 | 1 | 2 | null): void {
  const quiz = state.quiz
  if (!quiz || state.over) return
  if (choice === quiz.question.answer) {
    state.quizRight += 1
    // L'Éveil : invincible, on pulvérise ce qui barre la voie et on attire les ✦.
    state.shieldUntil = state.t + SHIELD_TIME
    state.magnetUntil = Math.max(state.magnetUntil, state.shieldUntil)
    state.events.push('quizRight')
  } else {
    state.events.push('quizWrong')
  }
  state.quiz = null
}

/**
 * Avance la course de `dt` secondes. `ask` fournit une question quand on ramasse un jeton
 * de quiz (`null` : pas de question disponible, le jeton vaut alors quelques ✦).
 */
export function step(state: RunState, dt: number, ask: () => QuizQuestion | null): void {
  if (state.over) return
  const t = (state.t += dt)
  // Après un trébuchement, on repart moins vite, puis on retrouve son allure.
  const recovering = Math.max(0, 1 - (t - state.stumbleAt) / STUMBLE_RECOVERY)
  // Combat de boss : on s'arrête face à lui (le décor ne défile plus sous ses pieds) ;
  // après la victoire, la course repart en une seconde.
  const restart = Math.min(1, Math.max(0.15, (t - state.bossEndedAt) / 1.2))
  state.speed = state.boss ? 0 : speedAt(t) * (1 - STUMBLE_SLOWDOWN * recovering) * restart
  const from = state.distance
  state.distance += state.speed * dt

  // Latéral : courbe d'Hermite de (position, vitesse) au départ jusqu'à la voie, à l'arrêt.
  const target = state.lane * LANE_WIDTH
  const p = Math.min(1, (t - state.laneAt) / LANE_TIME)
  if (p >= 1) {
    state.x = target
    state.vx = 0
  } else {
    const p2 = p * p
    const p3 = p2 * p
    const v0 = state.laneSpeed * LANE_TIME
    state.x = (2 * p3 - 3 * p2 + 1) * state.laneFrom + (p3 - 2 * p2 + p) * v0 + (3 * p2 - 2 * p3) * target
    state.vx = ((6 * p2 - 6 * p) * state.laneFrom + (3 * p2 - 4 * p + 1) * v0 + (6 * p - 6 * p2) * target) / LANE_TIME
  }

  // Vertical : vol sur le nuage, sinon saut et gravité, au-dessus du support (sol, toit, rampe).
  const ground = supportAt(state.objects, state.x, state.distance)
  state.ground = ground
  if (isFlying(state)) {
    state.y += (FLY_HEIGHT - state.y) * Math.min(1, dt * 6)
    state.vy = 0
    state.grounded = false
  } else {
    if (state.grounded) {
      // Au bout du toit, ou d'un pas de côté dans le vide : on tombe. Sur la rampe : on monte.
      if (ground < state.y - 0.05) state.grounded = false
      else if (ground > state.y) state.y = Math.min(ground, state.y + Math.max(0.9, 14 * dt))
    }
    if (!state.grounded) {
      const before = state.y
      state.vy -= GRAVITY * dt
      state.y += state.vy * dt
      // On se pose sur le toit seulement en arrivant d'au-dessus (pas à travers la caisse).
      const floor = before >= ground - 0.5 ? ground : 0
      if (state.vy <= 0 && state.y <= floor) {
        state.y = floor
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

  // Quiz : à l'échéance, la voie où l'on court donne la réponse.
  if (state.quiz && t >= state.quiz.deadline) answerQuiz(state, (state.lane + 1) as 0 | 1 | 2)

  // Boss : tous les 1 500 m, sur terre, hors quiz et hors passage d'un monde à l'autre.
  if (state.boss) bossStep(state, state.boss)
  else if (state.distance >= state.nextBoss && state.realm === 'earth' && !state.pendingRealm && !state.quiz && t > state.transitUntil) startBoss(state)

  // Royaumes : la bascule (au sommet du saut, au fond du tunnel), puis le retour sur terre.
  if (state.pendingRealm && t >= state.pendingRealm.at) enterRealm(state, state.pendingRealm.realm)
  if (state.realm !== 'earth' && state.distance >= state.realmUntil) leaveRealm(state)

  // Monstres qui feintent : à l'approche, ils bondissent dans la voie voisine.
  for (const object of state.objects) {
    if (object.shiftTo === undefined || (object.shift ?? 0) >= 1) continue
    if ((object.s - state.distance) / Math.max(state.speed, 1) > SHIFT_LEAD) continue
    object.shift = Math.min(1, (object.shift ?? 0) + dt / SHIFT_TIME)
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
  state.track.fill(objects, state.distance + VIEW_AHEAD, state.quiz !== null, state.clearUntil)
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
  const safe = flying || state.invulnerableUntil > t || state.shieldUntil > t || state.transitUntil > t

  for (const object of state.objects) {
    if (object.done || object.cleared) continue
    if (object.s > front + (magnet ? 2.5 : 1)) continue
    if (object.s + object.length < back - (magnet ? 1.5 : 0.6)) continue
    const laneX = objectX(object)
    const sideways = Math.abs(state.x - laneX)

    if (isObstacle(object.kind)) {
      // Éveillé : ce qui se dresse devant (sauf les trains, qu'on traverse) vole en éclats.
      if (state.shieldUntil > t && object.kind !== 'train' && object.s <= front + 1 && sideways < 1.0 + PLAYER_HALF_WIDTH) {
        object.done = true
        object.smashedAt = t
        state.events.push('smash')
        continue
      }
      if (safe || object.s > front || object.s + object.length < back) continue
      if (sideways > 1.0 + PLAYER_HALF_WIDTH) continue
      const [low, high] = spanOf(object)
      if (top <= low || bottom >= high) continue
      // De face (on vient d'atteindre l'obstacle, bien dans sa voie) : le choc.
      const headOn = object.s >= from + PLAYER_HALF_DEPTH - 0.05 && sideways < 0.9
      if (headOn) {
        object.done = true
        hit(state)
        if (state.over) return
        continue
      }
      // Par le côté : on trébuche (une fois par frôlement).
      if (state.graceUntil > t) continue
      stumble(state, object)
      if (state.over) return
      continue
    }

    // Objets à ramasser : dans sa voie et à sa hauteur ; en vol, toute la voie ; l'aimant attire tout.
    const near = magnet && object.kind === 'star' ? sideways < LANE_WIDTH * 1.6 : sideways < 1.1
    if (!near) continue
    // Hauteur : large pour les ✦ (les arcs au-dessus des tomes suivent le saut, mais pas au centimètre).
    const margin = object.kind === 'star' ? 0.8 : 0.5
    const reach = flying || (magnet && object.kind === 'star') || (object.y + margin > bottom && object.y - margin < top)
    if (!reach) continue
    object.done = true
    pickUp(state, object.kind, ask)
  }
}

/**
 * Un frôlement : si l'on entrait dans la voie de l'obstacle, on rebondit dans celle d'où
 * l'on venait ; on est sonné et ralenti. Déjà sonné : c'est la chute.
 */
function stumble(state: RunState, object: TrackObject): void {
  const t = state.t
  if (isStunned(state)) {
    object.done = true
    hit(state)
    return
  }
  state.graceUntil = t + 0.45
  if (Math.round(objectX(object) / LANE_WIDTH) === state.lane && state.laneBefore !== state.lane) {
    const back = state.laneBefore
    steer(state, back)
    state.laneSpeed = -state.laneSpeed * 0.3
    state.laneBefore = back
  }
  state.stumbleAt = t
  state.stunnedUntil = t + STUN_TIME
  state.events.push('stumble')
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
  } else if (kind === 'pad') {
    // Le tremplin : propulsé dans le ciel ; au sommet, on bascule à Skypia.
    state.vy = LAUNCH_VELOCITY
    state.grounded = false
    state.slideUntil = 0
    state.slideOnLanding = false
    state.cloudUntil = 0
    state.transitUntil = t + 2
    state.pendingRealm = { realm: 'sky', at: t + LAUNCH_SWITCH }
    state.events.push('launch')
  } else if (kind === 'tunnel') {
    state.transitUntil = t + 1.2
    state.pendingRealm = { realm: 'under', at: t + TUNNEL_SWITCH }
    state.events.push('tunnel')
  } else if (kind === 'quiz') {
    const question = state.quiz ? null : ask()
    if (question) {
      state.quiz = { question, deadline: t + QUIZ_TIME }
      state.quizAsked += 1
      state.events.push('quiz')
      clearRoad(state)
    } else {
      state.stardust += 5
      state.events.push('star')
    }
  }
}

/**
 * La route se vide devant soi le temps du quiz : tout ce qui est devant (obstacles, ✦,
 * bonus) disparaît jusqu'au-delà de l'échéance, et rien n'y sera posé. Le train dont on
 * foule le toit ou la rampe reste.
 */
function clearRoad(state: RunState): void {
  const from = state.distance + 1.5
  const until = state.distance + state.speed * (QUIZ_TIME + 0.4) + QUIZ_CLEAR_MARGIN
  for (const object of state.objects) {
    const start = object.s - (object.ramp ? RAMP_LENGTH : 0)
    if (object.done || start <= from || object.s >= until) continue
    object.done = true
    object.cleared = true
  }
  state.clearUntil = until
  state.events.push('clear')
}

/* ---- Boss ------------------------------------------------------------------------- */

const GESTURES: readonly RunAction[] = ['up', 'down', 'left', 'right']

/** Un combo de gestes pour l'attaque `round` (jamais deux fois le même geste de suite). */
function comboFor(state: RunState, boss: BossFight): RunAction[] {
  const random = seededRandom((state.seed ^ (boss.index * 7919 + boss.round * 131 + boss.counters * 17 + 1)) >>> 0)
  const length = BOSS_COMBOS[Math.min(boss.round, BOSS_COMBOS.length - 1)]!
  const combo: RunAction[] = []
  while (combo.length < length) {
    const gesture = GESTURES[Math.floor(random() * GESTURES.length)]!
    if (gesture !== combo[combo.length - 1]) combo.push(gesture)
  }
  return combo
}

function newCombo(state: RunState, boss: BossFight): void {
  boss.combo = comboFor(state, boss)
  boss.progress = 0
  boss.phase = 'combo'
  boss.phaseAt = state.t
  boss.deadline = state.t + comboTime(boss.combo.length)
}

/** Le boss arrive : la route se vide, le coureur revient au centre. */
function startBoss(state: RunState): void {
  for (const object of state.objects) {
    const start = object.s - (object.ramp ? RAMP_LENGTH : 0)
    if (object.done || start <= state.distance + 1.5) continue
    object.done = true
    object.cleared = true
  }
  // Rien n'est tiré pendant le combat.
  state.clearUntil = Number.POSITIVE_INFINITY
  state.cloudUntil = Math.min(state.cloudUntil, state.t)
  if (state.lane !== 0) steer(state, 0)
  state.boss = { index: state.bossesBeaten, phase: 'intro', phaseAt: state.t, hp: BOSS_HP, round: 0, combo: [], progress: 0, deadline: 0, counters: 0, missAt: -10, struck: false }
  state.events.push('boss')
}

/** Un geste pendant le combat : le bon fait avancer le combo ; un faux le remet à zéro. */
function bossInput(state: RunState, boss: BossFight, action: RunAction): void {
  if (boss.phase !== 'combo') return
  if (action === boss.combo[boss.progress]) {
    boss.progress += 1
    state.events.push('comboStep')
    if (boss.progress >= boss.combo.length) {
      boss.phase = 'strike'
      boss.phaseAt = state.t
      boss.struck = false
      state.events.push('bossCast')
    }
    return
  }
  boss.progress = 0
  boss.missAt = state.t
  state.events.push('comboMiss')
}

function bossStep(state: RunState, boss: BossFight): void {
  const elapsed = state.t - boss.phaseAt
  switch (boss.phase) {
    case 'intro':
      if (elapsed >= BOSS_INTRO) newCombo(state, boss)
      return
    case 'combo':
      // Trop lent : il contre-attaque, et coûte quelques ✦.
      if (state.t >= boss.deadline) {
        boss.phase = 'counter'
        boss.phaseAt = state.t
        boss.counters += 1
        state.stardust = Math.max(0, state.stardust - BOSS_PENALTY)
        state.events.push('bossCounter')
      }
      return
    case 'counter':
      if (elapsed >= BOSS_COUNTER) newCombo(state, boss)
      return
    case 'strike':
      if (!boss.struck && elapsed >= BOSS_IMPACT) {
        boss.struck = true
        boss.hp -= 1
        state.events.push('bossHit')
      }
      if (elapsed < BOSS_STRIKE) return
      if (boss.hp <= 0) {
        boss.phase = 'dying'
        boss.phaseAt = state.t
        state.events.push('bossDown')
        return
      }
      boss.round += 1
      newCombo(state, boss)
      return
    case 'dying':
      if (elapsed < BOSS_DEATH) return
      // Vaincu : la récompense, et la route reprend un peu plus loin.
      state.boss = null
      state.bossEndedAt = state.t
      state.bossesBeaten += 1
      state.stardust += BOSS_REWARD
      state.nextBoss = state.distance + BOSS_EVERY
      state.clearUntil = state.distance + BOSS_AFTER
      state.track.resume(state.distance + BOSS_AFTER)
      state.events.push('bossDefeated')
  }
}

/**
 * Arrivée dans un royaume : tout ce qui était devant disparaît, sa piste à lui commence un
 * peu plus loin (le temps de se poser) et dure une trentaine de secondes.
 */
function enterRealm(state: RunState, realm: Exclude<Realm, 'earth'>): void {
  const from = state.distance
  const until = from + state.speed * REALM_TIME
  state.pendingRealm = null
  state.realm = realm
  state.realmFrom = from
  state.realmUntil = until
  for (const object of state.objects) {
    if (object.done || object.s + object.length < from - 1) continue
    object.done = true
    object.cleared = true
  }
  state.track.enterRealm(realm, from + REALM_LANDING, until)
  state.events.push('realm')
}

/** Retour sur terre : de Skypia, on redescend du ciel ; des Enfers, on ressort à la lumière. */
function leaveRealm(state: RunState): void {
  if (state.realm === 'sky' && !isFlying(state)) {
    state.y = Math.max(state.y, 7)
    state.vy = 0
    state.grounded = false
  }
  state.realm = 'earth'
  state.transitUntil = state.t + 1.2
  state.events.push('realmExit')
}

/** Vitesse probable à l'abscisse `s` (accélération depuis le départ) : pour caler les arcs de ✦ sur le saut. */
function speedAround(s: number): number {
  const t = (-START_SPEED + Math.sqrt(START_SPEED * START_SPEED + 2 * ACCEL * Math.max(0, s))) / ACCEL
  return speedAt(t)
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
  private nextPortal = PORTAL_FIRST
  private portals = 0
  /** Royaume en cours de tirage, et sa fin (m). */
  private realm: Realm = 'earth'
  private realmUntil = 0
  private readonly hardUntil: Record<Lane, number> = { [-1]: 0, 0: 0, 1: 0 }

  constructor(seed: number) {
    this.random = seededRandom(seed)
  }

  /**
   * Ajoute des rangées jusqu'à `until` mètres. `quizOpen` : un quiz est en cours, pas de
   * nouveau jeton ; `quietUntil` : la route reste vide jusque-là (rangées tirées puis écartées).
   */
  fill(objects: TrackObject[], until: number, quizOpen = false, quietUntil = 0): void {
    while (this.nextRow < until) {
      // Fin du royaume : un peu de route libre, puis la Terre reprend.
      if (this.realm !== 'earth' && this.nextRow >= this.realmUntil) {
        this.realm = 'earth'
        this.nextRow = this.realmUntil + REALM_GAP
        for (const lane of LANES) this.hardUntil[lane] = 0
        continue
      }
      const start = objects.length
      if (this.realm === 'earth') this.row(objects, this.nextRow, quizOpen)
      else this.realmRow(objects, this.nextRow)
      if (this.nextRow < quietUntil) objects.length = start
      const difficulty = Math.min(1, this.nextRow / 2500)
      this.nextRow += Math.max(16, 30 - 12 * difficulty) + this.random() * 6
    }
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)]!
  }

  private push(objects: TrackObject[], kind: ObjectKind, lane: Lane, s: number, length: number, y = 0): TrackObject {
    const object: TrackObject = { id: this.nextId++, kind, lane, s, length, y, variant: Math.floor(this.random() * 1000), done: false }
    if (this.realm !== 'earth') object.realm = this.realm
    objects.push(object)
    return object
  }

  /** La piste reprend à `from` (m), après un combat de boss. */
  resume(from: number): void {
    this.nextRow = from
    for (const lane of LANES) this.hardUntil[lane] = 0
  }

  /** Arrivée dans un royaume : sa piste commence à `from` et s'arrête à `until` (m). */
  enterRealm(realm: Exclude<Realm, 'earth'>, from: number, until: number): void {
    this.realm = realm
    this.realmUntil = until
    this.nextRow = from
    for (const lane of LANES) this.hardUntil[lane] = 0
  }

  /**
   * Une rangée de royaume : jamais plus de deux voies prises (on y profite du voyage),
   * colonnes ou cristaux, blocs bas, arches à passer en glissant, des monstres du lieu, et
   * des ✦ en abondance dans les voies libres.
   */
  private realmRow(objects: TrackObject[], s: number): void {
    const random = this.random
    const count = random() < 0.55 ? 1 : 2
    const lanes = [...LANES].sort(() => random() - 0.5).slice(0, count)
    for (const lane of lanes) {
      if (this.hardUntil[lane] > s - 3) continue
      const r = random()
      const kind: ObstacleKind = r < 0.42 ? 'wall' : r < 0.72 ? 'low' : 'gate'
      const length = kind === 'wall' ? 1.6 : 1
      this.push(objects, kind, lane, s, length)
      if (kind === 'wall') this.hardUntil[lane] = s + length
    }
    for (const lane of LANES) {
      if (lanes.includes(lane) || random() > 0.6) continue
      for (let index = 0; index < 6; index += 1) this.push(objects, 'star', lane, s - 2 + index * 2.5, 0.6, 1)
    }
  }

  /** Un arc de ✦ au-dessus d'un tome couché, calé sur un saut à la vitesse probable de l'endroit. */
  private starArc(objects: TrackObject[], lane: Lane, s: number): void {
    const speed = speedAround(s)
    const air = (2 * JUMP_VELOCITY) / GRAVITY
    const peak = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY)
    for (let index = 0; index < 5; index += 1) {
      const offset = (index - 2) * 0.19 * speed * air
      const fromTop = offset / speed
      // Hauteur des pieds à cet instant du saut, plus de quoi tomber à hauteur de poitrine.
      const feet = Math.max(0, peak - (GRAVITY / 2) * fromTop * fromTop)
      this.push(objects, 'star', lane, s + 0.5 + offset, 0.6, Math.max(1, feet + 0.9))
    }
  }

  /** Le toit d'un train à rampe : une ligne de ✦, parfois un monstre posé dessus, à abattre. */
  private roof(objects: TrackObject[], lane: Lane, s: number, length: number, difficulty: number): void {
    const random = this.random
    if (random() < 0.32 + 0.3 * difficulty) {
      const monster = this.push(objects, 'wall', lane, s + length * (0.45 + random() * 0.3), 1.6)
      monster.base = TRAIN_ROOF
      return
    }
    if (random() < 0.8) for (let at = s + 1.5; at < s + length - 1; at += 2.5) this.push(objects, 'star', lane, at, 0.6, TRAIN_ROOF + 1)
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
      if (blocked.has(lane)) continue
      const freeSince = this.hardUntil[lane]
      const length = kind === 'train' ? 12 + Math.floor(random() * 3) * 4 : kind === 'wall' ? 1.6 : 1
      const object = this.push(objects, kind, lane, s, length)
      if (HARD.has(kind)) {
        blocked.add(lane)
        this.hardUntil[lane] = s + length
      }
      // Un train sur deux a sa rampe (la voie est libre devant elle) : on monte sur le toit,
      // parfois sur deux wagons à la suite.
      if (kind === 'train' && freeSince < s - RAMP_LENGTH - 2 && random() < 0.5) {
        object.ramp = true
        this.roof(objects, lane, s, length, difficulty)
        if (random() < 0.35) {
          const next = s + length + 0.4
          const second = 12 + Math.floor(random() * 3) * 4
          const linked = this.push(objects, 'train', lane, next, second)
          linked.linked = true
          this.hardUntil[lane] = next + second
          this.roof(objects, lane, next, second, difficulty)
        }
      }
      // Un arc de ✦ au-dessus d'un tome couché : la récompense du saut.
      if (kind === 'low' && random() < 0.5) this.starArc(objects, lane, s)
    }

    // Un monstre feinte parfois : il bondira dans une voie voisine libre (de plus en plus souvent).
    const rowObstacles = objects.filter((object) => object.s === s && object.kind !== 'star')
    for (const wall of rowObstacles) {
      if (wall.kind !== 'wall' || random() > 0.2 + 0.3 * difficulty) continue
      const targets = LANES.filter((lane) => Math.abs(lane - wall.lane) === 1 && !blocked.has(lane) && !rowObstacles.some((other) => other.lane === lane))
      if (targets.length === 0) continue
      const target = targets[Math.floor(random() * targets.length)]!
      wall.shiftTo = target
      wall.shift = 0
      blocked.add(target)
      this.hardUntil[target] = Math.max(this.hardUntil[target], s + wall.length)
      break
    }

    // Une voie libre (sans obstacle à cette rangée) reçoit une ligne de ✦, parfois un bonus.
    const occupied = new Set(rowObstacles.map((object) => object.shiftTo ?? object.lane))
    const free = LANES.filter((lane) => !occupied.has(lane) && !blocked.has(lane))
    if (free.length === 0) return
    const lane = this.pick(free)
    // Un passage vers un royaume : le tremplin (Skypia), puis le tunnel (les Enfers), en alternance.
    if (s >= this.nextPortal) {
      this.nextPortal = s + PORTAL_EVERY + random() * 250
      const kind = this.portals++ % 2 === 0 ? 'pad' : 'tunnel'
      this.push(objects, kind, lane, s, kind === 'tunnel' ? 6 : 1.6, kind === 'tunnel' ? 1 : 0)
      return
    }
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
