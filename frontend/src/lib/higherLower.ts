import { parseRoomCode } from './dle'
import type { HlMetric, HlTier } from '../services/higherLowerApi'

/* Higher or Lower : affichage des valeurs et progression des paliers (pur, testé). */

/** Chiffres après la virgule : deux pour une note (8,42), aucun sinon. */
export const decimalsOf = (metric: HlMetric): number => (metric === 'score' ? 2 : 0)

/** Valeur d'une carte dans la langue de l'interface : « 3 000 000 000 », « 9,22 ». */
export function formatHlValue(value: number, metric: HlMetric, locale: string): string {
  const digits = decimalsOf(metric)
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

/** Poussières d'une série : le palier le plus haut atteint. */
export const tierReward = (streak: number, tiers: readonly HlTier[]): number => tiers.filter((tier) => streak >= tier.streak).at(-1)?.reward ?? 0

/**
 * Où en est la série entre deux paliers : le prochain (`null` au-delà du dernier) et
 * l'avancement depuis le précédent, de 0 à 1.
 */
export function tierProgress(streak: number, tiers: readonly HlTier[]): { next: HlTier | null; ratio: number } {
  const next = tiers.find((tier) => tier.streak > streak) ?? null
  if (!next) return { next: null, ratio: 1 }
  const from = tiers.filter((tier) => tier.streak <= streak).at(-1)?.streak ?? 0
  return { next, ratio: Math.min(1, Math.max(0, (streak - from) / (next.streak - from))) }
}

/** Intensité de la flamme de série : 0 (tiède) à 3 (incandescente). */
export const flameLevel = (streak: number): 0 | 1 | 2 | 3 => (streak >= 20 ? 3 : streak >= 10 ? 2 : streak >= 5 ? 1 : 0)

/** Durée du compteur qui dévoile une valeur : plus long pour un grand nombre, jamais interminable. */
export const countDuration = (value: number): number => Math.min(1.5, 0.75 + Math.log10(Math.max(10, value)) * 0.07)

/** Initiales d’une œuvre sans couverture : « One Piece » → « OP ». */
export function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 || /\d/.test(word))
  const picked = (words.length > 0 ? words : [name]).slice(0, 2)
  return picked.map((word) => word.charAt(0).toUpperCase()).join('')
}

/* ---- COOP : lien d'invitation `?hl=<code>` (lu au démarrage, puis retiré de l'adresse) ---- */

const COOP_PARAM = 'hl'

export const coopLink = (code: string, origin: string, pathname = '/') => `${origin}${pathname}?${COOP_PARAM}=${code}`

export function coopCodeFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(COOP_PARAM)
  return value ? parseRoomCode(value) : null
}

export function withoutCoopParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete(COOP_PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}
