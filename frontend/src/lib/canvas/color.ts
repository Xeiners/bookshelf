/*
 * Couleurs : conversions teinte / saturation / clarté ↔ code hexadécimal (le sélecteur libre),
 * lisibilité d'un texte posé sur une couleur.
 */

export const HEX = /^#[0-9a-fA-F]{6}$/

export interface Hsl {
  h: number
  s: number
  l: number
}

export function hexToHsl(hex: string): Hsl {
  const value = HEX.test(hex) ? hex : '#000000'
  const r = parseInt(value.slice(1, 3), 16) / 255
  const g = parseInt(value.slice(3, 5), 16) / 255
  const b = parseInt(value.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l: l * 100 }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 }
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = Math.min(1, Math.max(0, s / 100))
  const light = Math.min(1, Math.max(0, l / 100))
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const part = (value: number) => Math.round(value * 255).toString(16).padStart(2, '0')
  return `#${part(f(0))}${part(f(8))}${part(f(4))}`
}

/** Noir ou blanc, selon ce qui se lit le mieux sur cette couleur. */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const value = HEX.test(hex) ? hex : '#000000'
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16))
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 150 ? '#000000' : '#ffffff'
}

export const PALETTE = [
  '#1b1b1f', '#4a4a55', '#8b8b99', '#d4d4dc', '#ffffff', '#e0245e',
  '#ff4d6d', '#ff8a3d', '#ffc233', '#ffe66d', '#7bd94a', '#2fd1a0',
  '#00b894', '#2bc3ff', '#5b8cff', '#0b3d91', '#7c5cff', '#9a6bff',
  '#d65cff', '#ff5cb4', '#8d5524', '#c68642', '#f1c27d', '#ffdbac',
] as const
