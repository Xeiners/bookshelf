/*
 * Gravity Ninja : le format d'un niveau (JSON, version `LEVEL_FORMAT`). Tout niveau, qu'il vienne du
 * générateur, d'une IA ou d'un fichier, n'est qu'une liste d'éléments réutilisables posés dans le
 * couloir (x vers la droite, y vers le bas, en unités du monde ; `WORLD_HEIGHT` de haut).
 */

/** Thèmes visuels (décors, matières, particules) : cf. `themes.ts`. */
export const THEME_IDS = ['konoha', 'night', 'hunter', 'halloween', 'christmas', 'sand', 'mist'] as const
export type ThemeId = (typeof THEME_IDS)[number]

/** Sens de la gravité : 1 vers le bas (on court sur les sols), -1 vers le haut (sous les plafonds). */
export type Gravity = 1 | -1

/** Bloc plein : sol, plafond, mur, plateforme suspendue. */
export interface BlockElement {
  type: 'block'
  x: number
  y: number
  w: number
  h: number
}

/** Plateforme fragile : elle tombe `CRUMBLE_DELAY` après qu'on s'y est posé. */
export interface CrumbleElement {
  type: 'crumble'
  x: number
  y: number
  w: number
  h: number
}

/** Plateforme mobile : va et vient entre (x, y) et (x + dx, y + dy), en `period` secondes. */
export interface MoverElement {
  type: 'mover'
  x: number
  y: number
  w: number
  h: number
  dx: number
  dy: number
  period: number
  /** Décalage dans le cycle (0 → 1). */
  phase?: number
}

/**
 * Rangée de pics posée sur une surface à la hauteur `y` : `up`, plantés dans un sol (pointes vers le
 * haut, ils occupent [y − SPIKE_H, y]) ; `down`, accrochés sous un plafond ([y, y + SPIKE_H]).
 */
export interface SpikesElement {
  type: 'spikes'
  x: number
  y: number
  w: number
  dir: 'up' | 'down'
}

/**
 * Shuriken géant qui tourne (centre x, y) ; il peut aller et venir de (dx, dy) en `period` secondes,
 * ou, avec `orbit`, tourner autour de (x, y) à cette distance (un tour en `period` secondes) : plusieurs
 * shurikens de même centre, décalés (`phase`), forment une roue de lames.
 */
export interface ShurikenElement {
  type: 'shuriken'
  x: number
  y: number
  r?: number
  dx?: number
  dy?: number
  period?: number
  phase?: number
  orbit?: number
}

/**
 * Hiraishin : sceau de téléportation. Le traverser (la boîte x, y, w, h) transporte le ninja dans la
 * boîte jumelle en (tx, ty), à la même place dans le sceau, avec sa gravité : il franchit ainsi une
 * barrière que rien d'autre ne passe.
 */
export interface WarpElement {
  type: 'warp'
  x: number
  y: number
  w: number
  h: number
  tx: number
  ty: number
}

/**
 * Jet de flammes : une bouche posée sur une surface à la hauteur `y` (`up` sur un sol, `down` sous un
 * plafond) qui crache sur `reach` unités, une fraction `on` de chaque cycle de `period` secondes.
 */
export interface FlameElement {
  type: 'flame'
  x: number
  y: number
  w: number
  reach: number
  dir: 'up' | 'down'
  period: number
  on: number
  phase?: number
}

/** Dalle spectrale : solide une fraction `on` de chaque cycle de `period` secondes, absente le reste du temps. */
export interface GhostElement {
  type: 'ghost'
  x: number
  y: number
  w: number
  h: number
  period: number
  on: number
  phase?: number
}

/** Sceau d'inversion : le traverser inverse la gravité. */
export interface FlipElement {
  type: 'flip'
  x: number
  y: number
  w: number
  h: number
}

/** Bonus de la lune (centre) : quelques secondes de gravité lunaire en maintenant le doigt. */
export interface MoonElement {
  type: 'moon'
  x: number
  y: number
}

/**
 * Porte de taille : la traverser rend le ninja minuscule (`mini`), ou lui rend sa taille. Minuscule,
 * il se faufile dans des tunnels trop bas pour lui.
 */
export interface SizeElement {
  type: 'size'
  x: number
  y: number
  w: number
  h: number
  mini: boolean
}

/** Kawarimi : bûche de substitution (centre). Elle encaisse le prochain piège (pics, shuriken). */
export interface LogElement {
  type: 'log'
  x: number
  y: number
}

/** Rouleau à collectionner (centre). */
export interface ScrollElement {
  type: 'scroll'
  x: number
  y: number
}

/**
 * Tremplin : posé sur une surface (`up` sur un sol, `down` sous un plafond). Le ninja qui y court
 * est propulsé loin de la surface, sans changer de gravité, et y retombe plus loin.
 */
export interface SpringElement {
  type: 'spring'
  x: number
  y: number
  w: number
  dir: 'up' | 'down'
}

/**
 * Nuage : une dalle qu'on traverse d'un côté et sur laquelle on se pose de l'autre. `up` : on s'y pose
 * en tombant vers le bas (et on la traverse en montant) ; `down` : on s'y pose dessous, gravité inversée.
 */
export interface CloudElement {
  type: 'cloud'
  x: number
  y: number
  w: number
  h: number
  dir: 'up' | 'down'
}

/** Kekkai : le talisman (centre). Le prendre dissout les barrières de son canal (0 → 7). */
export interface KeyElement {
  type: 'key'
  x: number
  y: number
  channel: number
}

/** Kekkai : une barrière, solide tant que le talisman de son canal n'a pas été pris. */
export interface BarrierElement {
  type: 'barrier'
  x: number
  y: number
  w: number
  h: number
  channel: number
}

/**
 * Lanceur de kunaï, en (x, y) : à chaque cycle de `period` secondes (décalé de `phase`), un kunaï
 * part vers la gauche à `speed` unités/s et vole sur `range` unités.
 */
export interface KunaiElement {
  type: 'kunai'
  x: number
  y: number
  speed: number
  range: number
  period: number
  phase?: number
}

export type LevelElement =
  | BlockElement
  | CrumbleElement
  | MoverElement
  | SpikesElement
  | ShurikenElement
  | FlipElement
  | MoonElement
  | ScrollElement
  | SizeElement
  | LogElement
  | WarpElement
  | FlameElement
  | GhostElement
  | SpringElement
  | CloudElement
  | KeyElement
  | BarrierElement
  | KunaiElement

export type ElementType = LevelElement['type']

export interface GravityLevel {
  format: number
  id: string
  name: string
  theme: ThemeId
  /** 1 (facile) → 10 (très dur). */
  difficulty: number
  /** Vitesse de course (unités/s). */
  speed: number
  /** L'arrivée : la ligne d'arrivée est à `length`. */
  length: number
  /** Départ (à `START_X`) : la surface et le sens de la gravité. */
  start: { y: number; g: Gravity }
  elements: LevelElement[]
}
