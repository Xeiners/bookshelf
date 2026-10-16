import { BRUSH_IDS, FRAME_COLLABORATORS, FRAME_MAX, FRAME_MIN, MAX_BEZIER_NODES, MAX_EXTENT, MAX_POLY_POINTS, MAX_STROKE_POINTS, MAX_STROKE_WIDTH, MAX_TEXT, MAX_TITLE, WORLD_LIMIT, CELL } from './canvas.constants.js'

/*
 * Les objets de la toile et leur validation. Le client propose, le serveur NORMALISE : chaque
 * champ est vérifié, les nombres sont arrondis, l'encombrement (`bbox`) est recalculé ici et
 * jamais pris tel quel. Un objet invalide est refusé avec un code court que le client traduit.
 *
 *   s  trait            p : x, y, pression (0–1) à la suite ; b : pinceau
 *   r  rectangle        x, y, w, h, r : rotation, k : rayon des coins
 *   e  ellipse          x, y, w, h, r
 *   l  ligne            q : x1, y1, x2, y2
 *   a  flèche           q : idem (pointe en fin de ligne)
 *   g  polygone         q : x, y à la suite ; cl : fermé
 *   b  courbe de Bézier n : par nœud x, y, entrée x, y, sortie x, y ; cl : fermée
 *   x  texte            x, y, s : corps, tx : contenu, al : alignement, r, bd : gras
 *   f  cadre            x, y, w, h, tt : titre, co : collaborateurs (ids de comptes)
 * Style commun : c trait, f remplissage (ou null), a opacité, sw épaisseur du trait (0 : pas de trait), d pointillés.
 */

export type ObjectType = 's' | 'r' | 'e' | 'l' | 'a' | 'g' | 'b' | 'x' | 'f'
export const OBJECT_TYPES: readonly ObjectType[] = ['s', 'r', 'e', 'l', 'a', 'g', 'b', 'x', 'f']

export interface Style {
  c: string
  f?: string | null
  a?: number
  sw: number
  d?: 0 | 1 | 2
}

export type ObjectData = Style & { t: ObjectType; [field: string]: unknown }

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Refus : un code court (`bad_shape`, `too_big`…), jamais un texte à afficher tel quel. */
export class CanvasFault extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message)
  }
}

const bad = (code = 'bad_shape'): never => {
  throw new CanvasFault(code)
}

const round = (value: number) => Math.round(value * 100) / 100

function num(value: unknown, min = -WORLD_LIMIT, max = WORLD_LIMIT): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return bad()
  return round(value)
}

function numbers(value: unknown, multiple: number, min: number, max: number, lo = -WORLD_LIMIT, hi = WORLD_LIMIT): number[] {
  if (!Array.isArray(value) || value.length % multiple !== 0 || value.length < min * multiple || value.length > max * multiple) return bad('bad_shape')
  const result = new Array<number>(value.length)
  for (let index = 0; index < value.length; index += 1) result[index] = num(value[index], lo, hi)
  return result
}

const HEX = /^#[0-9a-fA-F]{6}$/
function color(value: unknown): string {
  if (typeof value !== 'string' || !HEX.test(value)) return bad('bad_color')
  return value.toLowerCase()
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return bad('bad_text')
  // Pas de caractères de contrôle (hors retour à la ligne), pas de texte vide.
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').slice(0, max)
  return clean
}

interface StyleFields {
  c: string
  f?: string | null
  a?: number
  sw: number
  d?: 0 | 1 | 2
}

function styleOf(raw: Record<string, unknown>, options: { minWidth?: number } = {}): StyleFields {
  const style: StyleFields = { c: color(raw.c), sw: num(raw.sw, options.minWidth ?? 0, MAX_STROKE_WIDTH) }
  if (raw.f !== undefined && raw.f !== null) style.f = color(raw.f)
  else if (raw.f === null) style.f = null
  if (raw.a !== undefined) {
    const opacity = num(raw.a, 0.05, 1)
    if (opacity < 1) style.a = opacity
  }
  if (raw.d !== undefined && raw.d !== 0) {
    if (raw.d !== 1 && raw.d !== 2) return bad()
    style.d = raw.d
  }
  return style
}

const angle = (value: unknown): number | undefined => {
  if (value === undefined) return undefined
  const radians = num(value, -7, 7)
  return radians === 0 ? undefined : radians
}

/** Pinceau : de la liste, ou refusé. L'accès (débloqué ou non) se vérifie ailleurs. */
export function brushOfData(data: ObjectData): string | null {
  return typeof data.b === 'string' ? data.b : null
}

/** Marge ajoutée à l'encombrement : demi-épaisseur, plus la lueur de certains pinceaux. */
function reach(style: Style, brush?: string | null): number {
  const half = style.sw / 2
  if (brush === 'neon') return style.sw * 1.6
  if (brush === 'sparkle') return style.sw * 2.2
  return half
}

const grow = (box: Box, margin: number): Box => ({ minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin })

function boxOfPoints(values: readonly number[], stride: number, offsets: readonly number[] = [0, 1]): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let index = 0; index < values.length; index += stride) {
    for (let at = 0; at < offsets.length; at += 2) {
      const x = values[index + offsets[at]!]!
      const y = values[index + offsets[at + 1]!]!
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { minX, minY, maxX, maxY }
}

/** Rectangle tourné autour de son centre : son encombrement. */
function boxOfRotated(x: number, y: number, w: number, h: number, rotation = 0): Box {
  if (!rotation) return { minX: x, minY: y, maxX: x + w, maxY: y + h }
  const cx = x + w / 2
  const cy = y + h / 2
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [dx, dy] of [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ] as const) {
    const px = cx + dx * cos - dy * sin
    const py = cy + dx * sin + dy * cos
    if (px < minX) minX = px
    if (px > maxX) maxX = px
    if (py < minY) minY = py
    if (py > maxY) maxY = py
  }
  return { minX, minY, maxX, maxY }
}

/** Largeur et hauteur estimées d'un texte (le serveur ne mesure pas les polices). */
export function textSize(content: string, size: number): { width: number; height: number } {
  const lines = content.split('\n')
  const longest = Math.max(1, ...lines.map((line) => line.length))
  return { width: longest * size * 0.62, height: lines.length * size * 1.25 }
}

function checkExtent(box: Box): Box {
  const rounded = { minX: round(box.minX), minY: round(box.minY), maxX: round(box.maxX), maxY: round(box.maxY) }
  if (!(Number.isFinite(rounded.minX) && Number.isFinite(rounded.minY) && Number.isFinite(rounded.maxX) && Number.isFinite(rounded.maxY))) return bad()
  if (rounded.maxX - rounded.minX > MAX_EXTENT || rounded.maxY - rounded.minY > MAX_EXTENT) throw new CanvasFault('too_big')
  return rounded
}

export interface Normalized {
  data: ObjectData
  box: Box
}

/** Valide et normalise un objet envoyé par un client. */
export function normalizeObject(raw: unknown): Normalized {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad()
  const source = raw as Record<string, unknown>
  const type = source.t
  if (typeof type !== 'string' || !OBJECT_TYPES.includes(type as ObjectType)) return bad()
  switch (type as ObjectType) {
    case 's': {
      const p = numbers(source.p, 3, 1, MAX_STROKE_POINTS)
      for (let index = 2; index < p.length; index += 3) p[index] = Math.min(1, Math.max(0, p[index]!))
      const style = styleOf(source, { minWidth: 0.25 })
      const data: ObjectData = { t: 's', ...style, p }
      if (source.b !== undefined && source.b !== 'pen') {
        if (typeof source.b !== 'string' || !BRUSH_IDS.includes(source.b)) return bad('bad_brush')
        data.b = source.b
      }
      // Un trait n'est jamais « rempli ».
      delete data.f
      const box = grow(boxOfPoints(p, 3), reach(style, data.b as string | undefined))
      return { data, box: checkExtent(box) }
    }
    case 'r':
    case 'e': {
      const w = num(source.w, 0.5, MAX_EXTENT)
      const h = num(source.h, 0.5, MAX_EXTENT)
      const x = num(source.x)
      const y = num(source.y)
      const style = styleOf(source)
      const data: ObjectData = { t: type as 'r' | 'e', ...style, x, y, w, h }
      const rotation = angle(source.r)
      if (rotation) data.r = rotation
      if (type === 'r' && source.k !== undefined) {
        const radius = num(source.k, 0, Math.min(w, h) / 2)
        if (radius > 0) data.k = radius
      }
      const box = grow(boxOfRotated(x, y, w, h, rotation), style.sw / 2)
      return { data, box: checkExtent(box) }
    }
    case 'l':
    case 'a': {
      const q = numbers(source.q, 2, 2, 2)
      const style = styleOf(source, { minWidth: 0.25 })
      const data: ObjectData = { t: type as 'l' | 'a', ...style, q }
      delete data.f
      const margin = type === 'a' ? style.sw * 4 + 8 : style.sw / 2
      return { data, box: checkExtent(grow(boxOfPoints(q, 2), margin)) }
    }
    case 'g': {
      const q = numbers(source.q, 2, 2, MAX_POLY_POINTS)
      const closed = source.cl === 1 || source.cl === true
      if (closed && q.length < 6) return bad()
      const style = styleOf(source)
      const data: ObjectData = { t: 'g', ...style, q }
      if (closed) data.cl = 1
      else delete data.f
      return { data, box: checkExtent(grow(boxOfPoints(q, 2), style.sw / 2)) }
    }
    case 'b': {
      const n = numbers(source.n, 6, 2, MAX_BEZIER_NODES)
      const closed = source.cl === 1 || source.cl === true
      const style = styleOf(source)
      const data: ObjectData = { t: 'b', ...style, n }
      if (closed) data.cl = 1
      else delete data.f
      return { data, box: checkExtent(grow(boxOfPoints(n, 6, [0, 1, 2, 3, 4, 5]), style.sw / 2)) }
    }
    case 'x': {
      const content = text(source.tx, MAX_TEXT)
      if (content.trim().length === 0) return bad('bad_text')
      if (content.split('\n').length > 8) return bad('bad_text')
      const size = num(source.s, 6, 400)
      const x = num(source.x)
      const y = num(source.y)
      const align = source.al === 1 || source.al === 2 ? source.al : 0
      const rotation = angle(source.r)
      const style = { c: color(source.c), sw: 0 } as Style
      if (source.a !== undefined) {
        const opacity = num(source.a, 0.05, 1)
        if (opacity < 1) style.a = opacity
      }
      const data: ObjectData = { t: 'x', ...style, x, y, s: size, tx: content }
      if (align) data.al = align
      if (rotation) data.r = rotation
      if (source.bd === 1 || source.bd === true) data.bd = 1
      const { width, height } = textSize(content, size)
      const left = align === 1 ? x - width / 2 : align === 2 ? x - width : x
      return { data, box: checkExtent(boxOfRotated(left, y, width, height, rotation)) }
    }
    case 'f': {
      const w = num(source.w, FRAME_MIN, FRAME_MAX)
      const h = num(source.h, FRAME_MIN, FRAME_MAX)
      const x = num(source.x)
      const y = num(source.y)
      const title = text(source.tt ?? '', MAX_TITLE).replace(/\n/g, ' ').trim()
      const collaborators = source.co === undefined ? [] : source.co
      if (!Array.isArray(collaborators) || collaborators.length > FRAME_COLLABORATORS) return bad('bad_frame')
      const co = [...new Set(collaborators.map((id) => (typeof id === 'string' && id.length > 0 && id.length <= 40 ? id : bad('bad_frame'))))]
      const data: ObjectData = { t: 'f', c: color(source.c ?? '#1b1b1f'), f: source.f === null || source.f === undefined ? '#ffffff' : color(source.f), sw: 2, w, h, x, y, tt: title, co }
      // L'encombrement d'un cadre inclut son bandeau de titre, juste au-dessus.
      return { data, box: { minX: x, minY: round(y - 44), maxX: round(x + w), maxY: round(y + h) } }
    }
  }
}

/** Largeur et hauteur du cadre, sans le bandeau. */
export const frameRect = (data: ObjectData) => ({ x: data.x as number, y: data.y as number, w: data.w as number, h: data.h as number })

/** Dans les cases d'ancrage, une case est repérée par ses indices (coin supérieur gauche de l'objet). */
export const cellOf = (value: number) => Math.floor(value / CELL)
export const cellKey = (cx: number, cy: number) => `${cx}:${cy}`

export const overlaps = (a: Box, b: Box) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

/** Cadre : le rectangle réservé (sans le bandeau de titre). */
export const frameBox = (data: ObjectData): Box => {
  const { x, y, w, h } = frameRect(data)
  return { minX: x, minY: y, maxX: x + w, maxY: y + h }
}

/** Les ids de cases qui peuvent contenir un objet touchant `box` (ancrage + marge d'un objet de taille maximale). */
export function anchorRange(box: Box): { x0: number; x1: number; y0: number; y1: number } {
  return { x0: cellOf(box.minX) - 1, x1: cellOf(box.maxX), y0: cellOf(box.minY) - 1, y1: cellOf(box.maxY) }
}

/** Ids acceptables : 16 caractères hexadécimaux, fabriqués par le client. */
export const OBJECT_ID = /^[0-9a-f]{16}$/
