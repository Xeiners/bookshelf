import type { HeroModel } from './assets'

/**
 * Les coureurs : des personnages modélisés et animés (KayKit, CC0) et le petit ninja
 * chibi d'origine. Ajouter un coureur, c'est ajouter une entrée ; certains pourront plus
 * tard se débloquer (Poussières, records).
 */
export const HERO_LOOKS = ['rogue_hooded', 'rogue', 'knight', 'barbarian', 'mage', 'ninja'] as const
export type HeroLookId = (typeof HERO_LOOKS)[number]
export const DEFAULT_LOOK: HeroLookId = 'rogue_hooded'

/** Le modèle 3D d'un coureur, ou `null` pour le ninja chibi (dessiné en volumes simples). */
export const modelOf = (look: HeroLookId): HeroModel | null => (look === 'ninja' ? null : look)

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
