import { getStroke, type StrokeOptions } from 'perfect-freehand'
import type { StrokeData } from './types'

/*
 * Les pinceaux. Un trait est stocké comme une suite de points (x, y, pression) ; son contour (un
 * polygone épais qui épouse la pression) se calcule avec perfect-freehand et se garde en Path2D,
 * en unités du monde : il reste net à tous les zooms et ne se recalcule que si le trait change.
 *
 *   pen         stylo : la pression (ou la vitesse, à la souris) fait varier l'épaisseur
 *   marker      feutre : épaisseur constante, bouts ronds
 *   highlighter surligneur : large, translucide, se mêle au dessous
 *   ink         encre de manga : attaque et fin effilées
 *   pencil      crayon : grain, légèrement transparent
 *   neon        néon : cœur clair dans un halo de couleur
 *   tone        trame (screentone) : le trait est un semis de points
 *   sparkle     étoiles : un fil de couleur semé d'étincelles
 */

export const BRUSH_ORDER = ['pen', 'marker', 'highlighter', 'ink', 'pencil', 'neon', 'tone', 'sparkle'] as const
export type BrushId = (typeof BRUSH_ORDER)[number]

interface BrushStyle {
  options: (size: number) => StrokeOptions
  /** Multiplicateur d'opacité. */
  alpha: number
  /** `multiply` : se mêle au dessous (surligneur). */
  blend?: GlobalCompositeOperation
}

const BRUSHES: Record<BrushId, BrushStyle> = {
  pen: { options: (size) => ({ size, thinning: 0.55, smoothing: 0.55, streamline: 0.5 }), alpha: 1 },
  marker: { options: (size) => ({ size, thinning: 0, smoothing: 0.6, streamline: 0.45 }), alpha: 1 },
  highlighter: { options: (size) => ({ size: size * 1.8, thinning: 0, smoothing: 0.6, streamline: 0.5, start: { cap: false }, end: { cap: false } }), alpha: 0.42, blend: 'multiply' },
  ink: { options: (size) => ({ size, thinning: 0.85, smoothing: 0.6, streamline: 0.55, start: { taper: size * 3 }, end: { taper: size * 6 } }), alpha: 1 },
  pencil: { options: (size) => ({ size, thinning: 0.3, smoothing: 0.4, streamline: 0.3 }), alpha: 0.82 },
  neon: { options: (size) => ({ size, thinning: 0, smoothing: 0.65, streamline: 0.5 }), alpha: 1 },
  tone: { options: (size) => ({ size: size * 1.5, thinning: 0, smoothing: 0.6, streamline: 0.5 }), alpha: 1 },
  sparkle: { options: (size) => ({ size: size * 0.4, thinning: 0.3, smoothing: 0.6, streamline: 0.5 }), alpha: 1 },
}

export const isBrush = (value: unknown): value is BrushId => typeof value === 'string' && value in BRUSHES

/** Points à plat (x, y, pression) → tableau pour perfect-freehand. */
function toPoints(flat: readonly number[]): [number, number, number][] {
  const points: [number, number, number][] = []
  for (let index = 0; index + 2 < flat.length; index += 3) points.push([flat[index]!, flat[index + 1]!, flat[index + 2]!])
  return points
}

/** Tous les points ont la même pression : un tracé à la souris, où la vitesse fait l'épaisseur. */
const steady = (flat: readonly number[]) => {
  for (let index = 5; index < flat.length; index += 3) if (Math.abs(flat[index]! - flat[2]!) > 0.001) return false
  return true
}

function outlinePath(outline: number[][]): Path2D {
  const path = new Path2D()
  if (outline.length < 2) return path
  const first = outline[0]!
  path.moveTo(first[0]!, first[1]!)
  for (let index = 1; index < outline.length - 1; index += 1) {
    const a = outline[index]!
    const b = outline[index + 1]!
    path.quadraticCurveTo(a[0]!, a[1]!, (a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2)
  }
  path.closePath()
  return path
}

/** Un petit point : le trait d'un seul appui. */
function dotPath(x: number, y: number, radius: number): Path2D {
  const path = new Path2D()
  path.arc(x, y, Math.max(0.2, radius), 0, Math.PI * 2)
  return path
}

interface Built {
  fill: Path2D
  /** Pour le néon : le halo, plus large. */
  glow?: Path2D
  /** Pour les étincelles : positions et tailles. */
  stars?: { x: number; y: number; size: number; turn: number }[]
  /** Pour le crayon : un second passage décalé. */
  grain?: Path2D
}

const built = new WeakMap<StrokeData, Built>()

const hash = (a: number, b: number) => {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function build(data: StrokeData): Built {
  const brush = isBrush(data.b) ? data.b : 'pen'
  const style = BRUSHES[brush]
  const flat = data.p
  if (flat.length <= 3) return { fill: dotPath(flat[0]!, flat[1]!, (brush === 'highlighter' ? data.sw * 1.8 : data.sw) / 2) }
  const points = toPoints(flat)
  const options = (size: number) => ({ ...style.options(size), simulatePressure: steady(flat), last: true })
  const result: Built = { fill: outlinePath(getStroke(points, options(data.sw))) }
  if (brush === 'neon') result.glow = outlinePath(getStroke(points, { ...options(data.sw * 2.6), simulatePressure: false }))
  if (brush === 'pencil') {
    const shifted = points.map(([x, y, pressure], index): [number, number, number] => [x + (hash(index, 1) - 0.5) * data.sw * 0.5, y + (hash(index, 2) - 0.5) * data.sw * 0.5, pressure])
    result.grain = outlinePath(getStroke(shifted, { ...options(data.sw * 0.7), thinning: 0.6 }))
  }
  if (brush === 'sparkle') {
    const stars: NonNullable<Built['stars']> = []
    const gap = Math.max(6, data.sw * 3.2)
    let carried = 0
    for (let index = 0; index + 5 < flat.length; index += 3) {
      const dx = flat[index + 3]! - flat[index]!
      const dy = flat[index + 4]! - flat[index + 1]!
      const length = Math.hypot(dx, dy)
      carried += length
      while (carried >= gap) {
        carried -= gap
        const t = length === 0 ? 0 : 1 - carried / length
        const n = stars.length
        stars.push({ x: flat[index]! + dx * t + (hash(n, 3) - 0.5) * data.sw * 2.2, y: flat[index + 1]! + dy * t + (hash(n, 4) - 0.5) * data.sw * 2.2, size: data.sw * (0.8 + hash(n, 5) * 1.6), turn: hash(n, 6) * Math.PI })
      }
    }
    result.stars = stars
  }
  return result
}

function starPath(size: number): Path2D {
  const path = new Path2D()
  for (let index = 0; index < 8; index += 1) {
    const radius = index % 2 === 0 ? size : size * 0.28
    const angle = (index / 8) * Math.PI * 2 - Math.PI / 2
    if (index === 0) path.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
    else path.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
  }
  path.closePath()
  return path
}

const dotPatterns = new Map<string, CanvasPattern | null>()

/** Motif de trame : des points en quinconce, dans la couleur du trait. */
function tonePattern(ctx: CanvasRenderingContext2D, color: string, cell: number): CanvasPattern | null {
  const key = `${color}:${cell}`
  if (dotPatterns.has(key)) return dotPatterns.get(key)!
  const size = Math.max(4, Math.round(cell * 8))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  if (!g) return null
  g.fillStyle = color
  const radius = size * 0.2
  for (const [x, y] of [
    [size * 0.25, size * 0.25],
    [size * 0.75, size * 0.75],
  ] as const) {
    g.beginPath()
    g.arc(x, y, radius, 0, Math.PI * 2)
    g.fill()
  }
  const pattern = ctx.createPattern(canvas, 'repeat')
  if (pattern) pattern.setTransform(new DOMMatrix().scale(1 / 8, 1 / 8))
  dotPatterns.set(key, pattern)
  return pattern
}

/** Mélange léger vers le blanc, pour le cœur d'un trait néon. */
export const NEON_CORE = '#ffffff'

/** Dessine un trait (le contexte est déjà dans le repère du monde). */
export function drawStroke(ctx: CanvasRenderingContext2D, data: StrokeData, alpha: number): void {
  const brush = isBrush(data.b) ? data.b : 'pen'
  const style = BRUSHES[brush]
  let parts = built.get(data)
  if (!parts) {
    parts = build(data)
    built.set(data, parts)
  }
  const opacity = alpha * style.alpha * (data.a ?? 1)
  ctx.save()
  if (style.blend) ctx.globalCompositeOperation = style.blend
  if (brush === 'neon') {
    ctx.globalAlpha = opacity * 0.28
    ctx.fillStyle = data.c
    ctx.fill(parts.glow ?? parts.fill)
    ctx.globalAlpha = opacity
    ctx.fillStyle = NEON_CORE
    ctx.fill(parts.fill)
  } else if (brush === 'tone') {
    ctx.globalAlpha = opacity
    ctx.fillStyle = tonePattern(ctx, data.c, Math.max(1, Math.round(data.sw / 4))) ?? data.c
    ctx.fill(parts.fill)
  } else if (brush === 'sparkle') {
    ctx.globalAlpha = opacity
    ctx.fillStyle = data.c
    ctx.fill(parts.fill)
    const star = starPath(1)
    for (const spot of parts.stars ?? []) {
      ctx.save()
      ctx.translate(spot.x, spot.y)
      ctx.rotate(spot.turn)
      ctx.scale(spot.size, spot.size)
      ctx.fill(star)
      ctx.restore()
    }
  } else if (brush === 'pencil') {
    ctx.globalAlpha = opacity
    ctx.fillStyle = data.c
    ctx.fill(parts.fill)
    ctx.globalAlpha = opacity * 0.4
    if (parts.grain) ctx.fill(parts.grain)
  } else {
    ctx.globalAlpha = opacity
    ctx.fillStyle = data.c
    ctx.fill(parts.fill)
  }
  ctx.restore()
}
