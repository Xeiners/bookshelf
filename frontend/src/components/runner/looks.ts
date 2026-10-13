import type { VrmModel } from './assets'

/**
 * Les coureurs : l'aventurier aux vraies proportions (VRM) et le petit ninja chibi
 * d'origine. Ajouter un coureur, c'est ajouter une entrée ; certains pourront plus tard
 * se débloquer (Poussières, records).
 */
export const HERO_LOOKS = ['adventurer', 'ninja'] as const
export type HeroLookId = (typeof HERO_LOOKS)[number]
export const DEFAULT_LOOK: HeroLookId = 'adventurer'

export type HeroSource = { kind: 'vrm'; model: VrmModel } | { kind: 'chibi' }

/** De quoi est fait un coureur : un VRM, ou le ninja chibi (volumes simples). */
export const sourceOf = (look: HeroLookId): HeroSource => (look === 'ninja' ? { kind: 'chibi' } : { kind: 'vrm', model: look })

/** Couleurs du ninja chibi. */
export interface ChibiPalette {
  skin: string
  hair: string
  /** Reflet des cheveux (émission légère). */
  hairShine: string
  eyes: string
  jacket: string
  /** Empiècement des épaules et des manches. */
  jacketDark: string
  collar: string
  pants: string
  /** Bande claire aux chevilles. */
  pantsBand: string
  headband: string
  plate: string
  sandals: string
  /** Emblème dans le dos. */
  emblem: string
}

export const CHIBI: ChibiPalette = {
  skin: '#ffd9bb',
  hair: '#ffc53a',
  hairShine: '#ffd86b',
  eyes: '#3fa9ff',
  jacket: '#ff8a1f',
  jacketDark: '#23243a',
  collar: '#f7f3ff',
  pants: '#ff8a1f',
  pantsBand: '#f7f3ff',
  headband: '#262a52',
  plate: '#cfd6e6',
  sandals: '#2f3a78',
  emblem: '#e2483a',
}
