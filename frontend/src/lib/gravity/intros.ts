import { PICKUP_R } from './constants'
import type { GravityWorld } from './engine'

/** Les éléments particuliers d'un niveau, expliqués en jeu la première fois qu'ils approchent. */
export const INTRO_KINDS = ['moon', 'seal', 'crumble', 'mover', 'shuriken', 'scroll', 'log', 'mini', 'warp', 'flame', 'ghost', 'orbit', 'spring', 'cloud', 'key', 'kunai'] as const
export type IntroKind = (typeof INTRO_KINDS)[number]

export interface Intro {
  kind: IntroKind
  /** Abscisse où l'élément commence (unités). */
  x: number
}

/** La première apparition de chaque élément particulier du niveau, de gauche à droite. */
export function introsOf(world: GravityWorld): Intro[] {
  const first = new Map<IntroKind, number>()
  const see = (kind: IntroKind, x: number) => first.set(kind, Math.min(first.get(kind) ?? Infinity, x))
  for (const pickup of world.pickups) see(pickup.kind, pickup.x - PICKUP_R)
  for (const flip of world.flips) see('seal', flip.x)
  for (const gate of world.gates) if (gate.mini) see('mini', gate.x)
  // La barrière s'explique avec son talisman (« prends-le, elle s'ouvre »).
  for (const solid of world.solids) if (solid.kind !== 'block') see(solid.kind === 'barrier' ? 'key' : solid.kind, Math.min(solid.x, solid.x + solid.dx))
  for (const shuriken of world.shurikens) see(shuriken.orbit > 0 ? 'orbit' : 'shuriken', Math.min(shuriken.x, shuriken.x + shuriken.dx) - shuriken.r - shuriken.orbit)
  for (const warp of world.warps) see('warp', warp.x)
  for (const flame of world.flames) see('flame', flame.x)
  for (const spring of world.springs) see('spring', spring.x)
  // Le kunaï surgit de son lanceur : on l'annonce dès que sa course entre en jeu.
  for (const kunai of world.kunais) see('kunai', kunai.x - kunai.range)
  return [...first].map(([kind, x]) => ({ kind, x })).sort((a, b) => a.x - b.x)
}
