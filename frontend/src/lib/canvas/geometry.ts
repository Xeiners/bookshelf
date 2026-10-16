import type { BezierData, Box, CanvasObject, Data, EllipseData, FrameData, LineData, PolyData, RectData, StrokeData, TextData } from './types'

/*
 * Géométrie des objets : encombrement (le même calcul que le serveur : c'est lui qui décide, ceci
 * sert à l'affichage et à la sélection), déplacement, transformation, test de clic, courbes de
 * Bézier, simplification des tracés.
 */

export const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
export const boxWidth = (box: Box) => box.maxX - box.minX
export const boxHeight = (box: Box) => box.maxY - box.minY
export const overlaps = (a: Box, b: Box) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
export const containsPoint = (box: Box, x: number, y: number) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY
export const inflate = (box: Box, margin: number): Box => ({ minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin })

export function unionBox(boxes: readonly Box[]): Box {
  const result = emptyBox()
  for (const box of boxes) {
    if (box.minX < result.minX) result.minX = box.minX
    if (box.minY < result.minY) result.minY = box.minY
    if (box.maxX > result.maxX) result.maxX = box.maxX
    if (box.maxY > result.maxY) result.maxY = box.maxY
  }
  return result
}

function boxOfPoints(values: readonly number[], stride: number, offsets: readonly number[] = [0, 1]): Box {
  const box = emptyBox()
  for (let index = 0; index + stride <= values.length; index += stride) {
    for (let at = 0; at < offsets.length; at += 2) {
      const x = values[index + offsets[at]!]!
      const y = values[index + offsets[at + 1]!]!
      if (x < box.minX) box.minX = x
      if (x > box.maxX) box.maxX = x
      if (y < box.minY) box.minY = y
      if (y > box.maxY) box.maxY = y
    }
  }
  return box
}

function boxOfRotated(x: number, y: number, w: number, h: number, rotation = 0): Box {
  if (!rotation) return { minX: x, minY: y, maxX: x + w, maxY: y + h }
  const cx = x + w / 2
  const cy = y + h / 2
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const box = emptyBox()
  for (const [dx, dy] of [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ] as const) {
    const px = cx + dx * cos - dy * sin
    const py = cy + dx * sin + dy * cos
    if (px < box.minX) box.minX = px
    if (px > box.maxX) box.maxX = px
    if (py < box.minY) box.minY = py
    if (py > box.maxY) box.maxY = py
  }
  return box
}

export function textSize(content: string, size: number): { width: number; height: number } {
  const lines = content.split('\n')
  const longest = Math.max(1, ...lines.map((line) => line.length))
  return { width: longest * size * 0.62, height: lines.length * size * 1.25 }
}

/** Marge d'un trait : demi-épaisseur, plus la lueur de certains pinceaux. */
function reach(sw: number, brush?: string): number {
  if (brush === 'neon') return sw * 1.6
  if (brush === 'sparkle') return sw * 2.2
  return sw / 2
}

/** Encombrement d'un objet (traits compris), comme le calcule le serveur. */
export function boundsOf(data: Data): Box {
  switch (data.t) {
    case 's':
      return inflate(boxOfPoints(data.p, 3), reach(data.sw, data.b))
    case 'r':
    case 'e':
      return inflate(boxOfRotated(data.x, data.y, data.w, data.h, data.r), data.sw / 2)
    case 'l':
    case 'a':
      return inflate(boxOfPoints(data.q, 2), data.t === 'a' ? data.sw * 4 + 8 : data.sw / 2)
    case 'g':
      return inflate(boxOfPoints(data.q, 2), data.sw / 2)
    case 'b':
      return inflate(boxOfPoints(data.n, 6, [0, 1, 2, 3, 4, 5]), data.sw / 2)
    case 'x': {
      const { width, height } = textSize(data.tx, data.s)
      const left = data.al === 1 ? data.x - width / 2 : data.al === 2 ? data.x - width : data.x
      return boxOfRotated(left, data.y, width, height, data.r)
    }
    case 'f':
      return { minX: data.x, minY: data.y - 44, maxX: data.x + data.w, maxY: data.y + data.h }
  }
}

/** Le rectangle réservé d'un cadre (sans son bandeau de titre). */
export const frameArea = (data: FrameData): Box => ({ minX: data.x, minY: data.y, maxX: data.x + data.w, maxY: data.y + data.h })

/* ---- Transformations ------------------------------------------------------------------ */

/** x' = a·x + c·y + e ; y' = b·x + d·y + f */
export interface Affine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
export const translation = (dx: number, dy: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy })
export const scaling = (sx: number, sy: number, cx: number, cy: number): Affine => ({ a: sx, b: 0, c: 0, d: sy, e: cx - sx * cx, f: cy - sy * cy })
export const rotation = (angle: number, cx: number, cy: number): Affine => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { a: cos, b: sin, c: -sin, d: cos, e: cx - cos * cx + sin * cy, f: cy - sin * cx - cos * cy }
}
/** `second` après `first`. */
export const compose = (second: Affine, first: Affine): Affine => ({
  a: second.a * first.a + second.c * first.b,
  b: second.b * first.a + second.d * first.b,
  c: second.a * first.c + second.c * first.d,
  d: second.b * first.c + second.d * first.d,
  e: second.a * first.e + second.c * first.f + second.e,
  f: second.b * first.e + second.d * first.f + second.f,
})
export const apply = (m: Affine, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]
/** Partie linéaire seule (sans translation) : ce que devient un vecteur. */
const linear = (m: Affine, x: number, y: number): [number, number] => [m.a * x + m.c * y, m.b * x + m.d * y]

const round = (value: number) => Math.round(value * 100) / 100

function mapPairs(values: readonly number[], stride: number, m: Affine, pairs: number): number[] {
  const out = values.slice()
  for (let index = 0; index + stride <= values.length; index += stride) {
    for (let pair = 0; pair < pairs; pair += 1) {
      const [x, y] = apply(m, values[index + pair * 2]!, values[index + pair * 2 + 1]!)
      out[index + pair * 2] = round(x)
      out[index + pair * 2 + 1] = round(y)
    }
  }
  return out
}

/**
 * L'objet une fois transformé. Traits, lignes, polygones et courbes « cuisent » la
 * transformation dans leurs points ; rectangles, ellipses et textes gardent leur rotation.
 */
export function transformData(data: Data, m: Affine): Data {
  const scaleX = Math.hypot(m.a, m.b)
  const scaleY = Math.hypot(m.c, m.d)
  const width = (value: number) => Math.min(256, Math.max(0, round(value * Math.sqrt(scaleX * scaleY))))
  switch (data.t) {
    case 's':
      return { ...data, p: mapPairs(data.p, 3, m, 1), sw: Math.max(0.25, width(data.sw)) }
    case 'l':
    case 'a':
      return { ...data, q: mapPairs(data.q, 2, m, 1), sw: Math.max(0.25, width(data.sw)) }
    case 'g':
      return { ...data, q: mapPairs(data.q, 2, m, 1), sw: width(data.sw) }
    case 'b':
      return { ...data, n: mapPairs(data.n, 6, m, 3), sw: width(data.sw) }
    case 'r':
    case 'e': {
      const [cx, cy] = apply(m, data.x + data.w / 2, data.y + data.h / 2)
      // Les axes propres de l'objet (tournés de `r`) et ce que devient chacun.
      const turn = data.r ?? 0
      const mx = linear(m, Math.cos(turn), Math.sin(turn))
      const my = linear(m, -Math.sin(turn), Math.cos(turn))
      const w = Math.max(0.5, round(data.w * Math.hypot(mx[0], mx[1])))
      const h = Math.max(0.5, round(data.h * Math.hypot(my[0], my[1])))
      const next = { ...data, x: round(cx - w / 2), y: round(cy - h / 2), w, h, sw: width(data.sw) }
      const angle = round(Math.atan2(mx[1], mx[0]))
      if (angle) next.r = angle
      else delete next.r
      if (next.t === 'r' && next.k) next.k = Math.min(round(next.k * Math.min(scaleX, scaleY)), Math.min(w, h) / 2)
      return next
    }
    case 'x': {
      const { width: tw, height: th } = textSize(data.tx, data.s)
      const left = data.al === 1 ? data.x - tw / 2 : data.al === 2 ? data.x - tw : data.x
      const [cx, cy] = apply(m, left + tw / 2, data.y + th / 2)
      const turn = data.r ?? 0
      const mx = linear(m, Math.cos(turn), Math.sin(turn))
      const my = linear(m, -Math.sin(turn), Math.cos(turn))
      const size = Math.min(400, Math.max(6, round(data.s * Math.hypot(my[0], my[1]))))
      const next = { ...data, s: size }
      const resized = textSize(data.tx, size)
      const anchorX = data.al === 1 ? cx : data.al === 2 ? cx + resized.width / 2 : cx - resized.width / 2
      next.x = round(anchorX)
      next.y = round(cy - resized.height / 2)
      const angle = round(Math.atan2(mx[1], mx[0]))
      if (angle) next.r = angle
      else delete next.r
      return next
    }
    case 'f': {
      // Un cadre se déplace et se redimensionne, il ne tourne pas.
      const [x0, y0] = apply(m, data.x, data.y)
      const [x1, y1] = apply(m, data.x + data.w, data.y + data.h)
      return { ...data, x: round(Math.min(x0, x1)), y: round(Math.min(y0, y1)), w: round(Math.abs(x1 - x0)), h: round(Math.abs(y1 - y0)) }
    }
  }
}

export const moved = (data: Data, dx: number, dy: number): Data => transformData(data, translation(dx, dy))

/* ---- Courbes -------------------------------------------------------------------------- */

/** Une courbe de Bézier en segments : `steps` points par tronçon. */
export function flattenBezier(nodes: readonly number[], closed: boolean, steps = 14): number[] {
  const count = nodes.length / 6
  const points: number[] = []
  const segment = (from: number, to: number, first: boolean) => {
    const p0x = nodes[from * 6]!
    const p0y = nodes[from * 6 + 1]!
    const c1x = nodes[from * 6 + 4]!
    const c1y = nodes[from * 6 + 5]!
    const c2x = nodes[to * 6 + 2]!
    const c2y = nodes[to * 6 + 3]!
    const p1x = nodes[to * 6]!
    const p1y = nodes[to * 6 + 1]!
    for (let step = first ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps
      const u = 1 - t
      points.push(u * u * u * p0x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * p1x, u * u * u * p0y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * p1y)
    }
  }
  for (let index = 0; index < count - 1; index += 1) segment(index, index + 1, index === 0)
  if (closed && count > 1) segment(count - 1, 0, false)
  return points
}

/* ---- Tests de clic -------------------------------------------------------------------- */

export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function distanceToPolyline(x: number, y: number, values: readonly number[], stride: number, closed: boolean): number {
  let best = Infinity
  const count = Math.floor(values.length / stride)
  if (count === 1) return Math.hypot(x - values[0]!, y - values[1]!)
  for (let index = 0; index < count - 1; index += 1) {
    best = Math.min(best, distanceToSegment(x, y, values[index * stride]!, values[index * stride + 1]!, values[(index + 1) * stride]!, values[(index + 1) * stride + 1]!))
  }
  if (closed && count > 2) best = Math.min(best, distanceToSegment(x, y, values[(count - 1) * stride]!, values[(count - 1) * stride + 1]!, values[0]!, values[1]!))
  return best
}

function insidePolygon(x: number, y: number, values: readonly number[]): boolean {
  let inside = false
  const count = values.length / 2
  for (let a = 0, b = count - 1; a < count; b = a, a += 1) {
    const ax = values[a * 2]!
    const ay = values[a * 2 + 1]!
    const bx = values[b * 2]!
    const by = values[b * 2 + 1]!
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
  }
  return inside
}

/** Le point, dans le repère d'un rectangle tourné (origine au centre). */
function toLocal(x: number, y: number, cx: number, cy: number, angle: number): [number, number] {
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  return [(x - cx) * cos - (y - cy) * sin, (x - cx) * sin + (y - cy) * cos]
}

/** Ce point touche-t-il l'objet ? `tol` : tolérance en unités du monde (≈ 6 px à l'écran). */
export function hitTest(data: Data, x: number, y: number, tol: number): boolean {
  switch (data.t) {
    case 's':
      return distanceToPolyline(x, y, data.p, 3, false) <= data.sw / 2 + tol
    case 'l':
    case 'a':
      return distanceToPolyline(x, y, data.q, 2, false) <= data.sw / 2 + tol
    case 'g': {
      const closed = data.cl === 1
      if (closed && data.f && insidePolygon(x, y, data.q)) return true
      return distanceToPolyline(x, y, data.q, 2, closed) <= data.sw / 2 + tol
    }
    case 'b': {
      const closed = data.cl === 1
      const flat = flattenBezier(data.n, closed)
      if (closed && data.f && insidePolygon(x, y, flat)) return true
      return distanceToPolyline(x, y, flat, 2, false) <= data.sw / 2 + tol
    }
    case 'r': {
      const [lx, ly] = toLocal(x, y, data.x + data.w / 2, data.y + data.h / 2, data.r ?? 0)
      const dx = Math.abs(lx) - data.w / 2
      const dy = Math.abs(ly) - data.h / 2
      // Distance signée au bord : positive dehors, négative dedans.
      const signed = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)
      if (data.f) return signed <= data.sw / 2 + tol
      // Sans remplissage : seulement le contour.
      return Math.abs(signed) <= data.sw / 2 + tol
    }
    case 'e': {
      const [lx, ly] = toLocal(x, y, data.x + data.w / 2, data.y + data.h / 2, data.r ?? 0)
      const rx = Math.max(0.5, data.w / 2)
      const ry = Math.max(0.5, data.h / 2)
      const norm = Math.hypot(lx / rx, ly / ry)
      const slack = (data.sw / 2 + tol) / Math.min(rx, ry)
      if (data.f) return norm <= 1 + slack
      return Math.abs(norm - 1) <= slack
    }
    case 'x': {
      const { width, height } = textSize(data.tx, data.s)
      const left = data.al === 1 ? data.x - width / 2 : data.al === 2 ? data.x - width : data.x
      const [lx, ly] = toLocal(x, y, left + width / 2, data.y + height / 2, data.r ?? 0)
      return Math.abs(lx) <= width / 2 + tol && Math.abs(ly) <= height / 2 + tol
    }
    case 'f':
      return containsPoint({ minX: data.x - tol, minY: data.y - 44, maxX: data.x + data.w + tol, maxY: data.y + data.h + tol }, x, y)
  }
}

/** L'objet le plus haut sous le point (cadres derrière les autres). */
export function topObjectAt(objects: readonly CanvasObject[], x: number, y: number, tol: number): CanvasObject | null {
  let best: CanvasObject | null = null
  for (const object of objects) {
    if (!containsPoint(inflate(object.box, tol), x, y) || !hitTest(object.data, x, y, tol)) continue
    if (!best || drawsAbove(object, best)) best = object
  }
  return best
}

/** Ordre d'affichage : les cadres d'abord (au fond), puis par empilement. */
export const drawOrder = (a: CanvasObject, b: CanvasObject) => (a.data.t === 'f' ? 0 : 1) - (b.data.t === 'f' ? 0 : 1) || a.z - b.z
export const drawsAbove = (a: CanvasObject, b: CanvasObject) => drawOrder(a, b) > 0

/* ---- Simplification ------------------------------------------------------------------- */

/** Douglas-Peucker sur un tracé x, y, pression : garde les points qui comptent. */
export function simplifyStroke(points: readonly number[], tolerance: number): number[] {
  const count = points.length / 3
  if (count <= 2) return points.slice()
  const keep = new Uint8Array(count)
  keep[0] = 1
  keep[count - 1] = 1
  const stack: [number, number][] = [[0, count - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let worst = -1
    let index = -1
    for (let at = first + 1; at < last; at += 1) {
      const distance = distanceToSegment(points[at * 3]!, points[at * 3 + 1]!, points[first * 3]!, points[first * 3 + 1]!, points[last * 3]!, points[last * 3 + 1]!)
      if (distance > worst) {
        worst = distance
        index = at
      }
    }
    if (worst > tolerance && index > 0) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  const out: number[] = []
  for (let index = 0; index < count; index += 1) if (keep[index]) out.push(round(points[index * 3]!), round(points[index * 3 + 1]!), Math.round(points[index * 3 + 2]! * 100) / 100)
  return out
}

/** Les points qui forment un rectangle (rect, ellipse, cadre) : x, y, w, h normalisés. */
export function normalizedRect(x0: number, y0: number, x1: number, y1: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
}

export type ShapeData = RectData | EllipseData | LineData | PolyData | BezierData | TextData | FrameData | StrokeData
