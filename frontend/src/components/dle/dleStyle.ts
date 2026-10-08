import type { CSSProperties } from 'react'
import { RARITY_STYLE } from '../../lib/boosters'
import type { Dictionary } from '../../i18n'
import type { DleCategory, DleMode, RoomPlayer, Verdict, WorkSummary } from '../../services/dleApi'

/**
 * Couleurs des verdicts, franches comme dans Loldle : vert identique, orange proche,
 * rouge différent. `solid` : la couleur pleine ; `background` : avec un léger relief
 * (plus clair en haut) ; `border` : l'arête, plus sombre ; `color` : le texte.
 */
export const VERDICT_STYLE: Record<Verdict, { solid: string; background: string; border: string; color: string; glow: string; glass: string; edge: string }> = {
  exact: { solid: '#1fae6a', background: 'linear-gradient(180deg, #27c27a, #1a9c5e)', border: '#127a47', color: '#ffffff', glow: '0 6px 18px -8px rgba(31,174,106,0.9)', glass: 'linear-gradient(180deg, rgba(39,194,122,0.55), rgba(26,156,94,0.32))', edge: 'rgba(31,174,106,0.75)' },
  partial: { solid: '#e3962b', background: 'linear-gradient(180deg, #f1a63a, #d18421)', border: '#9e6012', color: '#ffffff', glow: '0 6px 18px -8px rgba(227,150,43,0.9)', glass: 'linear-gradient(180deg, rgba(241,166,58,0.55), rgba(209,132,33,0.32))', edge: 'rgba(227,150,43,0.75)' },
  wrong: { solid: '#cf3b4a', background: 'linear-gradient(180deg, #dd4757, #b9303f)', border: '#86202c', color: '#ffffff', glow: '0 6px 18px -10px rgba(207,59,74,0.8)', glass: 'linear-gradient(180deg, rgba(221,71,87,0.5), rgba(185,48,63,0.28))', edge: 'rgba(207,59,74,0.7)' },
}

/** Pastille de couleur d'un verdict (progression d'un adversaire, légende). */
export const verdictDot = (verdict: Verdict): CSSProperties => ({ background: VERDICT_STYLE[verdict].solid })

/** Dégradé « poussière d'étoile » : or pâle → rose → violet. */
export const STARDUST_GRADIENT = 'linear-gradient(135deg, #fff4c8, #ffc46b 35%, #ff5ec4 70%, #b46cff)'

export const playerName = (player: Pick<RoomPlayer, 'name'>, fallback: string) => player.name?.trim() || fallback

/** Couleur d'aura d'un joueur : celle de sa carte d'avatar, sinon le violet de l'app. */
export const auraOf = (player: RoomPlayer) => (player.avatar ? RARITY_STYLE[player.avatar.rarity].color : '#7c5cff')

/** Couleur d'une proposition : celle de sa rareté (œuvre), l'orange de Naruto (personnage). */
export const accentOf = (work: Pick<WorkSummary, 'rarity'>) => (work.rarity ? RARITY_STYLE[work.rarity].color : '#ff8a3d')

/** Couleurs de chaque catégorie : dégradé de sa carte, lueur. */
export const CATEGORY_STYLE: Record<DleCategory, { gradient: string; glow: string; ink: string; accent: string }> = {
  manga: { gradient: 'linear-gradient(135deg, #b46cff, #7c5cff 45%, #4cc9f0)', glow: 'rgba(124,92,255,0.55)', ink: '#d9ccff', accent: '#7c5cff' },
  naruto: { gradient: 'linear-gradient(135deg, #ffb347, #ff7a1a 50%, #e8402c)', glow: 'rgba(255,122,26,0.55)', ink: '#ffd2a8', accent: '#ff7a1a' },
  onepiece: { gradient: 'linear-gradient(135deg, #ffe08a, #f4b400 40%, #d62839)', glow: 'rgba(214,40,57,0.55)', ink: '#ffe3a3', accent: '#d62839' },
  jojo: { gradient: 'linear-gradient(135deg, #ffd86b, #e05bff 45%, #6a2bd9)', glow: 'rgba(224,91,255,0.5)', ink: '#f2c9ff', accent: '#e05bff' },
  jjk: { gradient: 'linear-gradient(135deg, #8fe3ff, #3a5bff 45%, #9b1cff)', glow: 'rgba(58,91,255,0.55)', ink: '#c9d6ff', accent: '#3a5bff' },
  // Le gi orange et bleu de Goku, l'or des Dragon Balls.
  dragonball: { gradient: 'linear-gradient(135deg, #ffe066, #ff8a1a 45%, #1f4fd8)', glow: 'rgba(255,138,26,0.55)', ink: '#ffd9a8', accent: '#ff8a1a' },
  // Le vert de Deku, le rouge et le bleu d'All Might.
  mha: { gradient: 'linear-gradient(135deg, #b8ff6b, #22c55e 45%, #1d4ed8)', glow: 'rgba(34,197,94,0.5)', ink: '#c8f7d6', accent: '#22c55e' },
}

/** Nom d'un format : « Classique », et « Couverture » (mangas) ou « Portrait » (personnages). */
export const modeLabel = (t: Dictionary, category: DleCategory, mode: DleMode) =>
  mode === 'zoom' && category !== 'manga' ? t.dle.portrait : t.dle.modes[mode].title
