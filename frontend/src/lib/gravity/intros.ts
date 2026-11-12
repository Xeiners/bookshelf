import { PICKUP_R } from './constants'
import type { GravityWorld } from './engine'

/** Les éléments particuliers d'un niveau, expliqués en jeu la première fois qu'ils approchent. */
export const INTRO_KINDS = ['moon', 'seal', 'crumble', 'mover', 'shuriken', 'scroll', 'log', 'mini'] as const
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
  for (const solid of world.solids) if (solid.kind !== 'block') see(solid.kind, Math.min(solid.x, solid.x + solid.dx))
  for (const shuriken of world.shurikens) see('shuriken', Math.min(shuriken.x, shuriken.x + shuriken.dx) - shuriken.r)
  return [...first].map(([kind, x]) => ({ kind, x })).sort((a, b) => a.x - b.x)
}
