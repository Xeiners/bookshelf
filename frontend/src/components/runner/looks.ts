/**
 * Apparences du coureur : chaque partie du personnage prend sa couleur ici. Ajouter une
 * tenue, c'est ajouter une entrée ; le joueur pourra bientôt choisir la sienne (et en
 * débloquer d'autres).
 */
export interface HeroLook {
  id: string
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

export const HERO_LOOKS = {
  ninja: {
    id: 'ninja',
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
  },
} as const satisfies Record<string, HeroLook>

export type HeroLookId = keyof typeof HERO_LOOKS
export const DEFAULT_LOOK: HeroLookId = 'ninja'
