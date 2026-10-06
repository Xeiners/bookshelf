import { parseRoomCode } from './dle'

/* Anime Bomb Party : outils d'affichage, sans état (testés). */

/** Dégradé du titre : de l'énergie occulte au rouge de l'explosion. */
export const BOMB_GRADIENT = 'linear-gradient(120deg, #6fd6ff, #b46cff 40%, #ff5e9c 70%, #ffb347)'

/** Comme le serveur : minuscules, sans accents (« É » → « e », « œ » → « oe »), lettres seules. */
const normalizeChar = (char: string): string =>
  char
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')

export interface Segment {
  text: string
  /** La syllabe imposée. */
  hit: boolean
}

/**
 * Le mot tapé, découpé autour de la première occurrence de la syllabe — repérée sans
 * accents ni casse, mais rendue telle que tapée (« Parlé » → « » · « Par » · « lé »).
 */
export function splitAround(text: string, syllable: string): Segment[] {
  if (!text) return []
  const chars = [...text]
  let normalized = ''
  const origin: number[] = []
  chars.forEach((char, index) => {
    for (const piece of normalizeChar(char)) {
      normalized += piece
      origin.push(index)
    }
  })
  const at = syllable ? normalized.indexOf(syllable.toLowerCase()) : -1
  if (at === -1) return [{ text, hit: false }]
  const start = origin[at] as number
  const end = (origin[at + syllable.length - 1] as number) + 1
  return [
    { text: chars.slice(0, start).join(''), hit: false },
    { text: chars.slice(start, end).join(''), hit: true },
    { text: chars.slice(end).join(''), hit: false },
  ].filter((segment) => segment.text.length > 0)
}

export type HeatStage = 'calm' | 'warm' | 'critical'

/** Couleur de la bombe selon la mèche restante (1 → 0) : bleu-violet, puis jaune, puis rouge incandescent. */
export function heat(ratio: number): { color: string; glow: string; stage: HeatStage } {
  if (ratio > 0.55) return { color: '#6fd6ff', glow: 'rgba(124,92,255,0.65)', stage: 'calm' }
  if (ratio > 0.25) return { color: '#ffd23f', glow: 'rgba(255,170,40,0.7)', stage: 'warm' }
  return { color: '#ff3b3b', glow: 'rgba(255,40,40,0.85)', stage: 'critical' }
}

/** Tic-tac : une fois par seconde mèche pleine, jusqu'à ~7 fois par seconde au bout. */
export const tickInterval = (ratio: number): number => Math.round(140 + Math.max(0, Math.min(1, ratio)) * 860)

/** En dessous, l'écran tremble (ms restantes). */
export const SHAKE_BELOW_MS = 5000

/**
 * Place d'un joueur autour de la table (en % du cadre, centre 50/50) : le joueur de
 * l'appareil en bas, les autres répartis dans l'ordre du tour.
 */
export function seatPosition(index: number, count: number, me: number, radius = 40): { x: number; y: number } {
  const step = (Math.PI * 2) / Math.max(1, count)
  const angle = Math.PI / 2 + (index - Math.max(0, me)) * step
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius }
}

/** Angle (degrés) pour que la flèche de la bombe pointe vers un siège. */
export const angleTo = (seat: { x: number; y: number }): number => (Math.atan2(seat.y - 50, seat.x - 50) * 180) / Math.PI

/* ---- Lien d'invitation `?bomb=<code>` ------------------------------------------------- */

const PARAM = 'bomb'

export const bombLink = (code: string, origin: string, pathname = '/') => `${origin}${pathname}?${PARAM}=${code}`

export function bombCodeFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(PARAM)
  return value ? parseRoomCode(value) : null
}

export function withoutBombParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete(PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}
