import {
  FEATHER_GRAVITY,
  FEATHER_SECONDS,
  GRAVITY,
  HARD_AT,
  JUMP_SPEED,
  MAGNET_RANGE,
  MAGNET_SECONDS,
  MAGNET_SPEED,
  MAX_GAP,
  MIN_ENEMY_SPACING,
  MIN_GAP,
  MIN_STAR_SPACING,
  MOVE_RESPONSE,
  MOVE_SPEED,
  PLATFORM_HEIGHT,
  PLATFORM_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  ROCKET_SECONDS,
  ROCKET_SPEED,
  SPRING_SPEED,
  STOMP_SPEED,
  WIDE_FACTOR,
  WIDE_SECONDS,
  WORLD_WIDTH,
  scoreOf,
} from './constants'

/*
 * Page Jump : simulation pure (aucun rendu ; hasard tiré d'une graine). Le héros rebondit de tome
 * en tome vers le ciel ; on le dirige à gauche ou à droite (il passe d'un bord à l'autre). Bonus :
 * ressort, envol, bulle. Les onis d'encre tuent de côté, s'écrasent par-dessus. Tomber sous l'écran
 * finit la partie. Testée dans `frontend/test/jump.test.ts`.
 */

export type PlatformKind = 'normal' | 'moving' | 'fragile'
export type ItemKind = 'spring' | 'rocket' | 'shield' | 'star' | TimedPower
/** Bonus qui durent un temps. */
export type TimedPower = 'wide' | 'magnet' | 'feather'

export interface Platform {
  id: number
  /** Centre horizontal, dessus du tome (hauteur). */
  x: number
  y: number
  kind: PlatformKind
  /** Tome mobile : vitesse horizontale. */
  vx: number
  /** Tome fragile : instant (s de partie) où il s'est effondré ; `null` tant qu'il tient. */
  brokeAt: number | null
  /** Couleur de couverture (index de palette). */
  tint: number
}

export interface Item {
  id: number
  kind: ItemKind
  x: number
  y: number
  /** Posé sur ce tome (ressort, et il le suit s'il bouge). */
  platformId: number | null
  taken: boolean
}

export interface Enemy {
  id: number
  x: number
  y: number
  /** Va-et-vient horizontal : centre, amplitude, phase. */
  home: number
  range: number
  phase: number
  alive: boolean
}

export interface Player {
  x: number
  /** Bas des pieds. */
  y: number
  vx: number
  vy: number
  facing: 1 | -1
  /** Envol restant (s). */
  rocket: number
  shield: boolean
  /** Bonus à durée : temps restant (s) de chacun. */
  timers: Record<TimedPower, number>
  /** Touché par un oni : il tombe sans plus rien toucher. */
  dead: boolean
}

/** Ce que le rendu doit mettre en scène (sons, éclats). Vidé par le rendu à chaque image. */
export type JumpEvent =
  | { type: 'bounce'; x: number; y: number }
  | { type: 'spring'; x: number; y: number }
  | { type: 'break'; x: number; y: number }
  | { type: 'rocket' }
  | { type: 'power'; kind: TimedPower }
  | { type: 'shield' }
  | { type: 'shieldPop'; x: number; y: number }
  | { type: 'star'; x: number; y: number }
  | { type: 'stomp'; x: number; y: number }
  | { type: 'hit' }
  | { type: 'over' }

export interface JumpState {
  player: Player
  platforms: Platform[]
  items: Item[]
  enemies: Enemy[]
  /** Bas de la vue (hauteur). Ne fait que monter. */
  camera: number
  /** Hauteur la plus haute atteinte (pieds). */
  height: number
  stars: number
  stomps: number
  time: number
  over: boolean
  /** Hauteur où poser le prochain tome. */
  nextY: number
  nextId: number
  /** Dernières hauteurs d'un éclat et d'un oni (espacement minimal, cf. la plausibilité). */
  lastStarY: number
  lastEnemyY: number
  seed: number
  events: JumpEvent[]
}

/** Hasard reproductible (mulberry32) : la graine avance dans l'état. */
function random(state: JumpState): number {
  state.seed = (state.seed + 0x6d2b79f5) | 0
  let t = state.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
/** Difficulté de 0 à 1 selon la hauteur. */
export const difficulty = (y: number): number => clamp(y / HARD_AT, 0, 1)

const TIMED: readonly TimedPower[] = ['wide', 'magnet', 'feather']
const TIMED_SECONDS: Record<TimedPower, number> = { wide: WIDE_SECONDS, magnet: MAGNET_SECONDS, feather: FEATHER_SECONDS }

/** Demi-largeur d'appui d'un tome : élargie par le Grand tome. */
export const platformHalf = (player: Player): number => (PLATFORM_WIDTH / 2) * (player.timers.wide > 0 ? WIDE_FACTOR : 1)

/** Distance horizontale sur une scène qui se referme sur elle-même (on passe d'un bord à l'autre). */
function wrapDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % WORLD_WIDTH
  return Math.min(d, WORLD_WIDTH - d)
}

const HALF = PLATFORM_WIDTH / 2

function addPlatform(state: JumpState, y: number, kind: PlatformKind): Platform {
  const x = HALF + random(state) * (WORLD_WIDTH - PLATFORM_WIDTH)
  const speed = lerp(50, 130, difficulty(y)) * (0.75 + random(state) * 0.5)
  const platform: Platform = { id: state.nextId++, x, y, kind, vx: kind === 'moving' ? (random(state) < 0.5 ? -speed : speed) : 0, brokeAt: null, tint: Math.floor(random(state) * 6) }
  state.platforms.push(platform)
  return platform
}

/** Pose les tomes (et leurs bonus, éclats, onis) jusqu'à `top`. */
function generate(state: JumpState, top: number): void {
  while (state.nextY < top) {
    const y = state.nextY
    const d = difficulty(y)
    const roll = random(state)
    const kind: PlatformKind = y < 400 ? 'normal' : roll < lerp(0.04, 0.32, d) ? 'moving' : roll < lerp(0.04, 0.32, d) + lerp(0, 0.22, d) ? 'fragile' : 'normal'
    const platform = addPlatform(state, y, kind)

    // Bonus posés sur le tome (pas sur un tome fragile : il s'effondre aussitôt).
    if (kind !== 'fragile' && y > 300) {
      const item = random(state)
      if (item < 0.05) state.items.push({ id: state.nextId++, kind: 'spring', x: platform.x, y, platformId: platform.id, taken: false })
      else if (item < 0.062 && y > 1500) state.items.push({ id: state.nextId++, kind: 'rocket', x: platform.x, y: y + 34, platformId: null, taken: false })
      else if (item < 0.077 && y > 3000) state.items.push({ id: state.nextId++, kind: 'shield', x: platform.x, y: y + 34, platformId: null, taken: false })
      else if (item < 0.089 && y > 1000) state.items.push({ id: state.nextId++, kind: 'wide', x: platform.x, y: y + 34, platformId: null, taken: false })
      else if (item < 0.101 && y > 800) state.items.push({ id: state.nextId++, kind: 'magnet', x: platform.x, y: y + 34, platformId: null, taken: false })
      else if (item < 0.111 && y > 2000) state.items.push({ id: state.nextId++, kind: 'feather', x: platform.x, y: y + 34, platformId: null, taken: false })
    }
    // Un éclat ✦ flotte parfois dans le vide entre deux tomes.
    if (y - state.lastStarY >= MIN_STAR_SPACING && random(state) < 0.2) {
      state.lastStarY = y
      state.items.push({ id: state.nextId++, kind: 'star', x: 20 + random(state) * (WORLD_WIDTH - 40), y: y + 60, platformId: null, taken: false })
    }

    let gap = lerp(MIN_GAP, MAX_GAP * 0.92, d) * (0.75 + random(state) * 0.35)
    gap = clamp(gap, MIN_GAP * 0.8, MAX_GAP)
    // Un oni d'encre garde parfois le passage : dans l'écart, jamais collé à un tome.
    if (y > 2500 && y - state.lastEnemyY >= MIN_ENEMY_SPACING && random(state) < lerp(0.05, 0.12, d) && gap > 90) {
      state.lastEnemyY = y
      const home = 50 + random(state) * (WORLD_WIDTH - 100)
      state.enemies.push({ id: state.nextId++, x: home, y: y + gap / 2 + 10, home, range: 30 + random(state) * 60, phase: random(state) * Math.PI * 2, alive: true })
    }
    state.nextY = y + gap
  }
}

export function createJump(seed = Date.now()): JumpState {
  const state: JumpState = {
    player: { x: WORLD_WIDTH / 2, y: 40, vx: 0, vy: JUMP_SPEED, facing: 1, rocket: 0, shield: false, timers: { wide: 0, magnet: 0, feather: 0 }, dead: false },
    platforms: [],
    items: [],
    enemies: [],
    camera: 0,
    height: 0,
    stars: 0,
    stomps: 0,
    time: 0,
    over: false,
    nextY: 90,
    nextId: 1,
    lastStarY: 0,
    lastEnemyY: 0,
    seed: seed | 0,
    events: [],
  }
  // Le sol de départ : un tome large, sous le héros.
  state.platforms.push({ id: state.nextId++, x: WORLD_WIDTH / 2, y: 40, kind: 'normal', vx: 0, brokeAt: null, tint: 0 })
  generate(state, 1400)
  return state
}

/** Pas de simulation fixe (s) : la physique ne dépend pas de la fréquence d'affichage. */
export const STEP = 1 / 120

/**
 * Avance la partie de `dt` secondes. `input` : direction voulue, de -1 (gauche) à 1 (droite).
 * `viewHeight` : hauteur visible (unités du monde), pour la caméra et la chute.
 */
export function stepJump(state: JumpState, dt: number, input: number, viewHeight: number): void {
  if (state.over) return
  let left = Math.min(dt, 0.1)
  while (left > 1e-6) {
    const step = Math.min(STEP, left)
    tick(state, step, clamp(input, -1, 1), viewHeight)
    left -= step
    if (state.over) return
  }
}

function tick(state: JumpState, dt: number, input: number, viewHeight: number): void {
  const p = state.player
  state.time += dt

  // Tomes mobiles : d'un bord à l'autre (les ressorts posés dessus les suivent).
  for (const platform of state.platforms) {
    if (platform.kind !== 'moving') continue
    platform.x += platform.vx * dt
    if (platform.x < HALF || platform.x > WORLD_WIDTH - HALF) {
      platform.x = clamp(platform.x, HALF, WORLD_WIDTH - HALF)
      platform.vx = -platform.vx
    }
  }
  for (const item of state.items) {
    if (item.platformId === null) continue
    const platform = state.platforms.find((candidate) => candidate.id === item.platformId)
    if (platform) item.x = platform.x
  }
  for (const enemy of state.enemies) if (enemy.alive) enemy.x = enemy.home + Math.sin(state.time * 1.6 + enemy.phase) * enemy.range

  // Déplacement horizontal lissé, et passage d'un bord à l'autre.
  if (!p.dead) {
    const target = input * MOVE_SPEED
    p.vx += (target - p.vx) * Math.min(1, dt / MOVE_RESPONSE)
    if (Math.abs(input) > 0.05) p.facing = input > 0 ? 1 : -1
  }
  p.x += p.vx * dt
  if (p.x < 0) p.x += WORLD_WIDTH
  else if (p.x >= WORLD_WIDTH) p.x -= WORLD_WIDTH

  // Vertical : l'envol porte, sinon la pesanteur.
  const previousY = p.y
  if (p.rocket > 0) {
    p.rocket = Math.max(0, p.rocket - dt)
    p.vy = ROCKET_SPEED
  } else {
    p.vy -= GRAVITY * (p.timers.feather > 0 ? FEATHER_GRAVITY : 1) * dt
  }
  for (const kind of TIMED) p.timers[kind] = Math.max(0, p.timers[kind] - dt)
  p.y += p.vy * dt

  // Atterrissage : en descente, les pieds franchissent le dessus d'un tome.
  if (!p.dead && p.vy < 0 && p.rocket === 0) {
    for (const platform of state.platforms) {
      if (platform.brokeAt !== null) continue
      if (previousY < platform.y || p.y > platform.y) continue
      if (wrapDistance(p.x, platform.x) > platformHalf(p) + PLAYER_WIDTH / 2 - 4) continue
      p.y = platform.y
      const spring = state.items.find((item) => item.kind === 'spring' && item.platformId === platform.id && wrapDistance(item.x, p.x) < 18)
      if (spring) {
        p.vy = SPRING_SPEED
        state.events.push({ type: 'spring', x: platform.x, y: platform.y })
      } else {
        p.vy = JUMP_SPEED
        state.events.push({ type: 'bounce', x: p.x, y: platform.y })
      }
      if (platform.kind === 'fragile') {
        platform.brokeAt = state.time
        state.events.push({ type: 'break', x: platform.x, y: platform.y })
      }
      break
    }
  }

  // L'aimant attire les éclats proches vers le héros.
  if (!p.dead && p.timers.magnet > 0) {
    const centerY = p.y + PLAYER_HEIGHT / 2
    for (const item of state.items) {
      if (item.taken || item.kind !== 'star') continue
      let dx = p.x - item.x
      if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH
      else if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH
      const dy = centerY - item.y
      const distance = Math.hypot(dx, dy)
      if (distance > MAGNET_RANGE || distance < 1) continue
      const step = Math.min(distance, MAGNET_SPEED * dt)
      item.x = (item.x + (dx / distance) * step + WORLD_WIDTH) % WORLD_WIDTH
      item.y += (dy / distance) * step
    }
  }

  // Bonus et éclats à portée.
  if (!p.dead) {
    const centerY = p.y + PLAYER_HEIGHT / 2
    for (const item of state.items) {
      if (item.taken || item.kind === 'spring') continue
      if (wrapDistance(item.x, p.x) > 24 || Math.abs(item.y - centerY) > 30) continue
      item.taken = true
      if (item.kind === 'star') {
        state.stars += 1
        state.events.push({ type: 'star', x: item.x, y: item.y })
      } else if (item.kind === 'rocket') {
        p.rocket = ROCKET_SECONDS
        state.events.push({ type: 'rocket' })
      } else if (item.kind === 'wide' || item.kind === 'magnet' || item.kind === 'feather') {
        p.timers[item.kind] = TIMED_SECONDS[item.kind]
        state.events.push({ type: 'power', kind: item.kind })
      } else {
        p.shield = true
        state.events.push({ type: 'shield' })
      }
    }
  }

  // Onis d'encre : écrasés par-dessus, mortels sinon (sauf envol ou bulle).
  if (!p.dead) {
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue
      const dx = wrapDistance(enemy.x, p.x)
      const dy = p.y + PLAYER_HEIGHT / 2 - enemy.y
      if (dx > 30 || Math.abs(dy) > 34) continue
      if ((p.vy < 0 && p.y > enemy.y + 4) || p.rocket > 0) {
        enemy.alive = false
        state.stomps += 1
        if (p.rocket === 0) p.vy = STOMP_SPEED
        state.events.push({ type: 'stomp', x: enemy.x, y: enemy.y })
      } else if (p.shield) {
        enemy.alive = false
        p.shield = false
        state.events.push({ type: 'shieldPop', x: enemy.x, y: enemy.y })
      } else {
        p.dead = true
        p.vx = 0
        p.vy = Math.min(p.vy, 0) - 200
        state.events.push({ type: 'hit' })
      }
    }
  }

  // Hauteur, caméra (elle ne redescend jamais), monde à venir et ménage sous l'écran.
  if (!p.dead) state.height = Math.max(state.height, p.y)
  state.camera = Math.max(state.camera, p.y - viewHeight * 0.42)
  generate(state, state.camera + viewHeight + 600)
  const floor = state.camera - 120
  if (state.platforms.length > 0 && state.platforms[0]!.y < floor) {
    state.platforms = state.platforms.filter((platform) => platform.y >= floor)
    state.items = state.items.filter((item) => item.y >= floor)
    state.enemies = state.enemies.filter((enemy) => enemy.y >= floor)
  }

  // Tombé sous l'écran : fini.
  if (p.y < state.camera - PLAYER_HEIGHT * 2 - PLATFORM_HEIGHT) {
    state.over = true
    state.events.push({ type: 'over' })
  }
}

export interface JumpOutcome {
  score: number
  height: number
  stars: number
  stomps: number
}

/** Hauteur affichée (et envoyée au serveur) : celle grimpée depuis le départ, arrondie. */
export const climbed = (state: JumpState): number => Math.max(0, Math.floor(state.height - 40))

export const outcomeOf = (state: JumpState): JumpOutcome => {
  const height = climbed(state)
  return { score: scoreOf(height, state.stars, state.stomps), height, stars: state.stars, stomps: state.stomps }
}
