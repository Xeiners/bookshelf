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

/** Shuriken géant qui tourne (centre x, y) ; il peut aller et venir de (dx, dy) en `period` secondes. */
export interface ShurikenElement {
  type: 'shuriken'
  x: number
  y: number
  r?: number
  dx?: number
  dy?: number
  period?: number
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
