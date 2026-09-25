import {
  Brain,
  CircleCheck,
  Coffee,
  Compass,
  Drama,
  Flame,
  Ghost,
  Heart,
  Hourglass,
  Infinity as InfinityIcon,
  PartyPopper,
  Orbit,
  Radio,
  Rocket,
  Search,
  Skull,
  Swords,
  Trophy,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import type { Dictionary } from '../../i18n/fr'

/**
 * Habillage des cartes : icône et couleur néon de chaque ambiance / rythme.
 * Les ids sont ceux de l'API (`backend/src/modules/oracle/decks.ts`) ; les
 * libellés sont dans les dictionnaires (`t.oracle.moods`, `t.oracle.paces`).
 */
export type MoodId = keyof Dictionary['oracle']['moods']
export type PaceId = keyof Dictionary['oracle']['paces']

interface CardSkin {
  icon: LucideIcon
  tone: string
}

export const MOOD_SKINS: Record<MoodId, CardSkin> = {
  'action': { icon: Swords, tone: '#ff5c5c' },
  'romance': { icon: Heart, tone: '#ff7eb6' },
  'dark-fantasy': { icon: Skull, tone: '#b18cff' },
  'sci-fi': { icon: Rocket, tone: '#4fd1ff' },
  'comedy': { icon: PartyPopper, tone: '#ffd166' },
  'mystery': { icon: Search, tone: '#7c9cff' },
  'slice-of-life': { icon: Coffee, tone: '#8fe3b0' },
  'psychological': { icon: Brain, tone: '#ff9f5c' },
  'martial-arts': { icon: Flame, tone: '#ff6b3d' },
  'isekai': { icon: Orbit, tone: '#5cf2d6' },
  'horror': { icon: Ghost, tone: '#9aa7b8' },
  'sports': { icon: Trophy, tone: '#ffb347' },
  'drama': { icon: Drama, tone: '#e06c9f' },
  'supernatural': { icon: WandSparkles, tone: '#8f7bff' },
  'adventure': { icon: Compass, tone: '#6fd08c' },
}

export const PACE_SKINS: Record<PaceId, CardSkin> = {
  short: { icon: Hourglass, tone: '#ffc46b' },
  epic: { icon: InfinityIcon, tone: '#c9a0ff' },
  completed: { icon: CircleCheck, tone: '#3fe0a0' },
  ongoing: { icon: Radio, tone: '#5cc8ff' },
}

export const isMoodId = (value: string): value is MoodId => value in MOOD_SKINS
export const isPaceId = (value: string): value is PaceId => value in PACE_SKINS

/** Chiffres romains du dos des cartes : un ornement, pas un texte à traduire. */
export const CARD_NUMERALS = ['I', 'II', 'III'] as const
