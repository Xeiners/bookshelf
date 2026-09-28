import type { Rarity } from '../../lib/boosters'

/**
 * Finitions des cadres, par rareté : de l'argent mat de la Commune à
 * l'iridescence tournante de la Mythique. Des dégradés « métal » (bandes
 * claires et sombres alternées) donnent le relief ; un biseau (ombres
 * intérieures) le complète dans `CollectibleCard`.
 */
export interface CardFrame {
  /** Dégradé du cadre (la Mythique le remplace par une couche iridescente tournante). */
  metal: string
  /** Pastille de rareté : fond et texte. */
  badge: string
  badgeText: string
  /** Filet entre l'illustration et le cartouche. */
  rule: string
  /** Reflet brillant sur le cadre (Rare). */
  gloss?: boolean
  /** Gravure fine sur le métal (Légendaire). */
  chiseled?: boolean
  /** Aura pulsante autour de la carte. */
  aura?: string
  /** Étincelles sur le cadre (Légendaire). */
  sparkles?: boolean
  /** Cadre iridescent tournant (Mythique). */
  iridescent?: boolean
}

export const IRIDESCENT = 'conic-gradient(from 0deg, #ff5ec4, #ffc46b, #3fe0a0, #4cc9f0, #b46cff, #ff5ec4)'

export const CARD_FRAMES: Record<Rarity, CardFrame> = {
  COMMON: {
    metal: 'linear-gradient(145deg, #eceef2 0%, #9a9da6 26%, #d4d6dc 50%, #7b7e87 76%, #c2c5cc 100%)',
    badge: 'linear-gradient(135deg, #e7e9ee, #8f929b)',
    badgeText: '#16151d',
    rule: 'linear-gradient(90deg, transparent, #c2c5cc, transparent)',
  },
  RARE: {
    metal: 'linear-gradient(145deg, #b4d0ff 0%, #2458e6 28%, #86b0ff 48%, #0f2f9e 74%, #5b8cff 100%)',
    badge: 'linear-gradient(135deg, #8fb6ff, #1e4fd8)',
    badgeText: '#f7f5f0',
    rule: 'linear-gradient(90deg, transparent, #7aa7ff, transparent)',
    gloss: true,
  },
  EPIC: {
    metal: 'linear-gradient(145deg, #f3dbff 0%, #9b3dff 30%, #d593ff 50%, #5b15b5 76%, #b86cff 100%)',
    badge: 'linear-gradient(135deg, #d08bff, #7a1fe0)',
    badgeText: '#f7f5f0',
    rule: 'linear-gradient(90deg, transparent, #d08bff, transparent)',
    aura: 'radial-gradient(closest-side, rgba(180, 108, 255, 0.75), rgba(180, 108, 255, 0.18) 60%, transparent)',
  },
  LEGENDARY: {
    metal:
      'linear-gradient(135deg, #fff6cf 0%, #e0a82e 16%, #fff0b0 32%, #a5700f 50%, #f7d47c 66%, #8a5a0a 84%, #ffe39a 100%)',
    badge: 'linear-gradient(135deg, #fff0b0, #c8901c)',
    badgeText: '#2a1a02',
    rule: 'linear-gradient(90deg, transparent, #ffe39a, transparent)',
    chiseled: true,
    sparkles: true,
    aura: 'radial-gradient(closest-side, rgba(255, 196, 107, 0.7), rgba(255, 196, 107, 0.15) 60%, transparent)',
  },
  MYTHIC: {
    metal: IRIDESCENT,
    badge: 'linear-gradient(90deg, #ff5ec4, #ffc46b, #3fe0a0, #4cc9f0, #b46cff)',
    badgeText: '#0b0b12',
    rule: 'linear-gradient(90deg, transparent, #ff5ec4, #4cc9f0, transparent)',
    iridescent: true,
    aura: 'radial-gradient(closest-side, rgba(255, 94, 196, 0.55), rgba(76, 201, 240, 0.2) 60%, transparent)',
  },
}

/** Étincelles du cadre Légendaire : position (% de la carte) et décalage de départ (s). */
export const SPARKLES = [
  { left: 6, top: 5, delay: 0 },
  { left: 91, top: 12, delay: 0.8 },
  { left: 94, top: 70, delay: 1.5 },
  { left: 4, top: 58, delay: 2.1 },
  { left: 50, top: 2, delay: 1.1 },
]
