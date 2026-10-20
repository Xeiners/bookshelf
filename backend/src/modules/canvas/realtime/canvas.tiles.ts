import sharp from 'sharp'
import { prisma } from '../../../core/db.js'
import { CELL } from '../canvas.constants.js'
import { frameRect, overlaps, textSize, type Box, type ObjectData } from '../canvas.schema.js'
import { world, type WObject, type WorldEvent } from './canvas.world.js'

/*
 * Tuiles raster de la toile, pour les zooms où les objets ne tiennent plus à l'écran. Une
 * pyramide : au niveau 0, une tuile couvre 1024 unités (image de 512 px, soit 2 unités par pixel) ;
 * chaque niveau suivant double le côté couvert et se fabrique en assemblant les quatre tuiles du
 * dessous. Rendu par `sharp` à partir d'un SVG des objets. Les tuiles se calculent à la demande,
 * se gardent en mémoire (plafonnée), et on sait d'avance lesquelles sont vides (une table
 * d'occupation par niveau) : zoomer sur le vide ne coûte rien.
 *
 * Chaque modification de la toile invalide les tuiles qu'elle touche, à tous les niveaux : leur
 * version augmente, et les clients en mode tuiles en sont prévenus (par paquets) pour recharger.
 */

export const TILE_BASE = 1024
export const TILE_PX = 512
export const TILE_MAX_LEVEL = 11
const CACHE_BYTES = 96 * 1024 * 1024
/** Une tuile modifiée n'est refaite qu'à cette cadence : les anciennes images servent entre-temps. */
const REBUILD_MS = 1500
const NOTIFY_MS = 750

export type TileChange = [level: number, x: number, y: number, version: number]

const sizeOf = (level: number) => TILE_BASE * 2 ** level
const keyOf = (level: number, x: number, y: number) => `${level}/${x}/${y}`

/* ---- SVG --------------------------------------------------------------------------------- */

const esc = (value: string) => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const f = (value: number) => String(Math.round(value * 100) / 100)

function strokeAttrs(data: ObjectData, extra = ''): string {
  const parts = [`stroke="${data.c}"`, `stroke-width="${f(data.sw)}"`, 'stroke-linecap="round"', 'stroke-linejoin="round"']
  if (data.d === 1) parts.push(`stroke-dasharray="${f(data.sw * 3)} ${f(data.sw * 2)}"`)
  else if (data.d === 2) parts.push(`stroke-dasharray="${f(data.sw)} ${f(data.sw * 1.6)}"`)
  return `${parts.join(' ')} ${extra}`
}

const opacityOf = (data: ObjectData, factor = 1) => {
  const value = ((data.a as number | undefined) ?? 1) * factor
  return value < 1 ? ` opacity="${f(value)}"` : ''
}

function pointsPath(values: readonly number[], stride: number, step: number): string {
  let path = ''
  let lastX = Infinity
  let lastY = Infinity
  const count = values.length / stride
  for (let index = 0; index < count; index += 1) {
    const x = values[index * stride]!
    const y = values[index * stride + 1]!
    // Aux grands niveaux de zoom arrière, les points trop proches ne se voient pas.
    if (index > 0 && index < count - 1 && Math.abs(x - lastX) < step && Math.abs(y - lastY) < step) continue
    path += `${path ? 'L' : 'M'}${f(x)} ${f(y)}`
    lastX = x
    lastY = y
  }
  return path
}

function bezierPath(nodes: readonly number[], closed: boolean): string {
  const count = nodes.length / 6
  let path = `M${f(nodes[0]!)} ${f(nodes[1]!)}`
  const segment = (from: number, to: number) => {
    path += `C${f(nodes[from * 6 + 4]!)} ${f(nodes[from * 6 + 5]!)} ${f(nodes[to * 6 + 2]!)} ${f(nodes[to * 6 + 3]!)} ${f(nodes[to * 6]!)} ${f(nodes[to * 6 + 1]!)}`
  }
  for (let index = 0; index < count - 1; index += 1) segment(index, index + 1)
  if (closed) {
    segment(count - 1, 0)
    path += 'Z'
  }
  return path
}

function arrowHead(q: readonly number[], width: number): string {
  const [x1, y1, x2, y2] = q as [number, number, number, number]
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const size = width * 4 + 8
  const left = angle + Math.PI - 0.45
  const right = angle + Math.PI + 0.45
  return `${f(x2)},${f(y2)} ${f(x2 + Math.cos(left) * size)},${f(y2 + Math.sin(left) * size)} ${f(x2 + Math.cos(right) * size)},${f(y2 + Math.sin(right) * size)}`
}

function rotation(data: ObjectData, cx: number, cy: number): string {
  const radians = data.r as number | undefined
  return radians ? ` transform="rotate(${f((radians * 180) / Math.PI)} ${f(cx)} ${f(cy)})"` : ''
}

/** Un objet en SVG. `step` : taille d'un pixel en unités du monde (simplifie les traits). */
export function objectSvg(data: ObjectData, step = 0): string {
  const fill = (data.f as string | null | undefined) ?? null
  switch (data.t) {
    case 's': {
      const p = data.p as number[]
      const brush = data.b as string | undefined
      const path = pointsPath(p, 3, step * 0.7)
      const lone = p.length === 3 ? `<circle cx="${f(p[0]!)}" cy="${f(p[1]!)}" r="${f(data.sw / 2)}" fill="${data.c}"${opacityOf(data)}/>` : ''
      if (lone) return lone
      if (brush === 'highlighter') return `<path d="${path}" fill="none" ${strokeAttrs(data)}${opacityOf(data, 0.45)}/>`
      if (brush === 'neon') return `<path d="${path}" fill="none" stroke="${data.c}" stroke-width="${f(data.sw * 2.6)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.28"/><path d="${path}" fill="none" ${strokeAttrs({ ...data, c: '#ffffff' } as ObjectData)}${opacityOf(data)}/>`
      const factor = brush === 'pencil' ? 0.85 : brush === 'tone' ? 0.6 : 1
      return `<path d="${path}" fill="none" ${strokeAttrs(data)}${opacityOf(data, factor)}/>`
    }
    case 'r': {
      const x = data.x as number
      const y = data.y as number
      const w = data.w as number
      const h = data.h as number
      const radius = (data.k as number | undefined) ?? 0
            return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${radius ? ` rx="${f(radius)}"` : ''} fill="${fill ?? 'none'}" ${data.sw === 0 ? '' : strokeAttrs(data)}${opacityOf(data)}${rotation(data, x + w / 2, y + h / 2)}/>`
    }
    case 'e': {
      const x = data.x as number
      const y = data.y as number
      const w = data.w as number
      const h = data.h as number
      return `<ellipse cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" rx="${f(w / 2)}" ry="${f(h / 2)}" fill="${fill ?? 'none'}" ${data.sw === 0 ? '' : strokeAttrs(data)}${opacityOf(data)}${rotation(data, x + w / 2, y + h / 2)}/>`
    }
    case 'l':
    case 'a': {
      const q = data.q as number[]
      const line = `<line x1="${f(q[0]!)}" y1="${f(q[1]!)}" x2="${f(q[2]!)}" y2="${f(q[3]!)}" ${strokeAttrs(data)}${opacityOf(data)}/>`
      return data.t === 'a' ? `${line}<polygon points="${arrowHead(q, data.sw)}" fill="${data.c}"${opacityOf(data)}/>` : line
    }
    case 'g': {
      const q = data.q as number[]
      const points = Array.from({ length: q.length / 2 }, (_, index) => `${f(q[index * 2]!)},${f(q[index * 2 + 1]!)}`).join(' ')
      const closed = data.cl === 1
      return `<${closed ? 'polygon' : 'polyline'} points="${points}" fill="${closed ? (fill ?? 'none') : 'none'}" ${strokeAttrs(data)}${opacityOf(data)}/>`
    }
    case 'b':
      return `<path d="${bezierPath(data.n as number[], data.cl === 1)}" fill="${data.cl === 1 ? (fill ?? 'none') : 'none'}" ${strokeAttrs(data)}${opacityOf(data)}/>`
    case 'x': {
      const size = data.s as number
      const content = data.tx as string
      const align = (data.al as number | undefined) ?? 0
      const x = data.x as number
      const y = data.y as number
      const { width, height } = textSize(content, size)
      const anchor = align === 1 ? 'middle' : align === 2 ? 'end' : 'start'
      const lines = content.split('\n')
      const spans = lines.map((line, index) => `<tspan x="${f(x)}" y="${f(y + size * 0.95 + index * size * 1.25)}">${esc(line) || ' '}</tspan>`).join('')
      const left = align === 1 ? x - width / 2 : align === 2 ? x - width : x
      return `<text font-family="DejaVu Sans, Arial, sans-serif" font-size="${f(size)}" font-weight="${data.bd === 1 ? 700 : 400}" fill="${data.c}" text-anchor="${anchor}"${opacityOf(data)}${rotation(data, left + width / 2, y + height / 2)}>${spans}</text>`
    }
    case 'f': {
      const { x, y, w, h } = frameRect(data)
      const title = (data.tt as string) ?? ''
      return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill ?? '#ffffff'}" stroke="${data.c}" stroke-width="2"/>${title ? `<text x="${f(x)}" y="${f(y - 12)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" font-weight="700" fill="${data.c}">${esc(title)}</text>` : ''}`
    }
  }
}

/** Les objets d'une zone, dans l'ordre de dessin : cadres d'abord, puis par empilement. */
export function drawOrder(objects: readonly WObject[]): WObject[] {
  return [...objects].sort((a, b) => (a.type === 'f' ? 0 : 1) - (b.type === 'f' ? 0 : 1) || a.z - b.z)
}

export function svgOf(objects: readonly { data: ObjectData }[], box: Box, width: number, height: number, step: number): string {
  const body = objects.map((object) => objectSvg(object.data, step)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${f(box.minX)} ${f(box.minY)} ${f(box.maxX - box.minX)} ${f(box.maxY - box.minY)}">${body}</svg>`
}

async function rasterize(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer()
}

/* ---- Pyramide ---------------------------------------------------------------------------- */

interface Entry {
  version: number
  png: Buffer | null | undefined
  builtAt: number
  stale: boolean
  building: Promise<Buffer | null> | null
}

const entries = new Map<string, Entry>()
const occupied: Set<string>[] = Array.from({ length: TILE_MAX_LEVEL + 1 }, () => new Set())
let cachedBytes = 0
let pending = new Map<string, TileChange>()
let notifyTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(changes: TileChange[]) => void>()

export function onTileChange(listener: (changes: TileChange[]) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const entryOf = (key: string): Entry => {
  let entry = entries.get(key)
  if (!entry) {
    entry = { version: 0, png: undefined, builtAt: 0, stale: false, building: null }
    entries.set(key, entry)
  }
  return entry
}

function forEachTile(box: Box, visit: (level: number, x: number, y: number) => void): void {
  for (let level = 0; level <= TILE_MAX_LEVEL; level += 1) {
    const size = sizeOf(level)
    const x0 = Math.floor(box.minX / size)
    const x1 = Math.floor(box.maxX / size)
    const y0 = Math.floor(box.minY / size)
    const y1 = Math.floor(box.maxY / size)
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) visit(level, x, y)
  }
}

function markOccupied(box: Box): void {
  forEachTile(box, (level, x, y) => occupied[level]!.add(`${x}:${y}`))
}

function dropPng(entry: Entry): void {
  if (entry.png) cachedBytes -= entry.png.length
  entry.png = undefined
}

function invalidate(box: Box): void {
  forEachTile(box, (level, x, y) => {
    const key = keyOf(level, x, y)
    const entry = entryOf(key)
    entry.version += 1
    entry.stale = true
    pending.set(key, [level, x, y, entry.version])
  })
  if (!notifyTimer) {
    notifyTimer = setTimeout(() => {
      notifyTimer = null
      const changes = [...pending.values()]
      pending = new Map()
      for (const listener of listeners) listener(changes)
    }, NOTIFY_MS)
    notifyTimer.unref?.()
  }
}

/** Connecte la pyramide aux changements de la toile. */
export function watchWorld(): () => void {
  return world.on((event: WorldEvent) => {
    switch (event.type) {
      case 'upsert':
        if (event.prevBox) invalidate(event.prevBox)
        markOccupied(event.obj.box)
        invalidate(event.obj.box)
        return
      case 'remove':
      case 'hide':
      case 'unhide':
        invalidate(event.obj.box)
        return
      case 'season':
        resetTiles()
        return
      default:
        return
    }
  })
}

export function resetTiles(): void {
  entries.clear()
  cachedBytes = 0
  pending = new Map()
  for (const set of occupied) set.clear()
}

/** Au démarrage de la saison : quelles zones contiennent quelque chose. */
export async function loadOccupancy(seasonId: string): Promise<void> {
  const cells = await prisma.canvasObject.groupBy({ by: ['cx', 'cy'], where: { seasonId } })
  for (const { cx, cy } of cells) markOccupied({ minX: cx * CELL, minY: cy * CELL, maxX: (cx + 2) * CELL, maxY: (cy + 2) * CELL })
}

let running = 0
const waiting: (() => void)[] = []
async function limited<T>(job: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((resolve) => waiting.push(resolve))
  running += 1
  try {
    return await job()
  } finally {
    running -= 1
    waiting.shift()?.()
  }
}

async function build(level: number, x: number, y: number): Promise<Buffer | null> {
  const size = sizeOf(level)
  if (level === 0) {
    const box: Box = { minX: x * size, minY: y * size, maxX: (x + 1) * size, maxY: (y + 1) * size }
    await world.ensureRange(box)
    const objects: WObject[] = []
    for (const key of world.keysOf(box)) for (const object of world.objectsOf(key)) if (!object.hidden && overlaps(object.box, box)) objects.push(object)
    if (objects.length === 0) return null
    return limited(() => rasterize(svgOf(drawOrder(objects), box, TILE_PX, TILE_PX, size / TILE_PX)))
  }
  const children = await Promise.all(
    [0, 1, 2, 3].map(async (index) => {
      const dx = index % 2
      const dy = Math.floor(index / 2)
      const child = await tile(level - 1, x * 2 + dx, y * 2 + dy)
      return child.png ? { input: child.png, left: dx * TILE_PX, top: dy * TILE_PX } : null
    }),
  )
  const present = children.filter((child): child is { input: Buffer; left: number; top: number } => child !== null)
  if (present.length === 0) return null
  // Deux passes : `sharp` redimensionne avant de superposer, d'où des enfants collés hors du cadre.
  return limited(async () => {
    const joined = await sharp({ create: { width: TILE_PX * 2, height: TILE_PX * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(present)
      .png({ compressionLevel: 0 })
      .toBuffer()
    return sharp(joined).resize(TILE_PX, TILE_PX, { kernel: 'lanczos3' }).png({ compressionLevel: 6 }).toBuffer()
  })
}

export interface TileResult {
  png: Buffer | null
  version: number
  /** Image d'avant la dernière modification (reconstruction trop récente) : ne pas la mettre en cache longtemps. */
  stale: boolean
}

/** Une tuile : l'image (ou `null` si vide), sa version. */
export async function tile(level: number, x: number, y: number, now = Date.now()): Promise<TileResult> {
  const key = keyOf(level, x, y)
  // Tuile vide : rien à fabriquer ni à mémoriser. Créer une entrée ici laisserait n'importe qui
  // gonfler la table en demandant des tuiles au hasard.
  if (!occupied[level]!.has(`${x}:${y}`)) return { png: null, version: entries.get(key)?.version ?? 0, stale: false }
  const entry = entryOf(key)
  if (entry.png !== undefined && !entry.stale) {
    // Récemment servie : la garder en mémoire plus longtemps (ordre d'insertion = ordre d'usage).
    entries.delete(key)
    entries.set(key, entry)
    return { png: entry.png, version: entry.version, stale: false }
  }
  if (entry.png !== undefined && entry.stale && now - entry.builtAt < REBUILD_MS && !entry.building) return { png: entry.png, version: entry.version, stale: true }
  if (!entry.building) {
    const version = entry.version
    entry.building = build(level, x, y)
      .then((png) => {
        dropPng(entry)
        entry.png = png
        if (png) cachedBytes += png.length
        entry.builtAt = Date.now()
        // Modifiée pendant la fabrication : l'image est déjà en retard.
        entry.stale = entry.version !== version
        trim()
        return png
      })
      .finally(() => {
        entry.building = null
      })
  }
  const png = await entry.building
  return { png, version: entry.version, stale: entry.stale }
}

function trim(): void {
  if (cachedBytes <= CACHE_BYTES) return
  for (const entry of entries.values()) {
    if (cachedBytes <= CACHE_BYTES * 0.8) break
    if (entry.png && !entry.building) {
      dropPng(entry)
      entry.stale = true
    }
  }
}

export function tileVersion(level: number, x: number, y: number): number {
  return entries.get(keyOf(level, x, y))?.version ?? 0
}

export function tileStats(): { entries: number; bytes: number } {
  return { entries: entries.size, bytes: cachedBytes }
}

/* ---- Image d'ensemble (archive de saison) --------------------------------------------------- */

/** Dessine des objets dans une image d'au plus `maxSide` pixels, bornée par leur étendue. */
export async function renderOverview(objects: readonly WObject[], maxSide = 2048): Promise<Buffer | null> {
  if (objects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const object of objects) {
    minX = Math.min(minX, object.box.minX)
    minY = Math.min(minY, object.box.minY)
    maxX = Math.max(maxX, object.box.maxX)
    maxY = Math.max(maxY, object.box.maxY)
  }
  const margin = Math.max(maxX - minX, maxY - minY) * 0.03 + 20
  const box: Box = { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin }
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY
  const scale = maxSide / Math.max(width, height)
  const pxW = Math.max(16, Math.round(width * scale))
  const pxH = Math.max(16, Math.round(height * scale))
  const svg = svgOf(drawOrder(objects), box, pxW, pxH, 1 / scale)
  return sharp(Buffer.from(svg)).flatten({ background: '#fbf8f2' }).png({ compressionLevel: 8 }).toBuffer()
}
