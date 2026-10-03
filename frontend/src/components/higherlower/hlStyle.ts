import type { HlMetric } from '../../services/higherLowerApi'

/* Higher or Lower : couleurs du jeu, des deux réponses et de chaque métrique. */

/** Signature du jeu : une courbe qui monte, de l'émeraude au violet. */
export const HL_GRADIENT = 'linear-gradient(135deg, #5ef2c2, #4cc9f0 45%, #7c5cff)'

/** « Plus haut » (émeraude) et « Plus bas » (corail). */
export const HL_UP = { gradient: 'linear-gradient(135deg, #c6ffe9, #3fe0a0 50%, #12a874)', ink: '#03231a', glow: 'rgba(63,224,160,0.5)', color: '#3fe0a0' }
export const HL_DOWN = { gradient: 'linear-gradient(135deg, #ffd6e1, #ff5e8a 50%, #cf2f62)', ink: '#2b0411', glow: 'rgba(255,94,138,0.5)', color: '#ff5e8a' }

/** Fond d'une carte : jamais transparent (un portrait détouré laisserait voir derrière). */
export const CARD_INK = '#0b0b12'

export const METRIC_STYLE: Record<HlMetric, { gradient: string; accent: string; glow: string }> = {
  bounty: { gradient: 'linear-gradient(135deg, #fff0b0, #ffc46b 45%, #ff7a3d)', accent: '#ffc46b', glow: 'rgba(255,170,80,0.45)' },
  sales: { gradient: 'linear-gradient(135deg, #c9f3ff, #4cc9f0 50%, #3a5bff)', accent: '#4cc9f0', glow: 'rgba(76,201,240,0.45)' },
  chapters: { gradient: 'linear-gradient(135deg, #ead6ff, #b46cff 50%, #6a2bd9)', accent: '#b46cff', glow: 'rgba(180,108,255,0.45)' },
  score: { gradient: 'linear-gradient(135deg, #ffe0f1, #ff9ad8 45%, #ff5ec4)', accent: '#ff9ad8', glow: 'rgba(255,94,196,0.45)' },
}

/** Texte en dégradé (titres, valeurs). */
export const gradientText = (gradient: string) => ({ backgroundImage: gradient, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }) as const
