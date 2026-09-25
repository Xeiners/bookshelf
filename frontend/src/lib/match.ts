import type { PillTone } from '../components/ui/Pill'

/** Couleur du % de match : vert au-delà de 80 %, doré au-delà de 60 %, neutre en dessous. */
export const matchTone = (percent: number): PillTone => (percent > 80 ? 'like' : percent > 60 ? 'gold' : 'neutral')

/** Classe de texte Tailwind équivalente, pour les badges hors `Pill`. */
export const MATCH_TEXT: Record<PillTone, string> = {
  like: 'text-like',
  gold: 'text-gold',
  neutral: 'text-cream/80',
  glow: 'text-glow',
  nope: 'text-nope',
}
