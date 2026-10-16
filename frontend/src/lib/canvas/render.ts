import { drawStroke } from './brushes'
import { Camera, tileLevelFor } from './camera'
import { flattenBezier, textSize } from './geometry'
import type { Scene } from './scene'
import { tileSize, type TileCache } from './tilecache'
import type { Box, CanvasObject, Data, FrameData, ToolId } from './types'

/*
 * Le dessin de la toile. Deux calques : `base` (le décor : papier, grille, tuiles ou objets),
 * redessiné seulement quand la vue ou la scène change ; `overlay` (ce qui bouge sans cesse :
 * curseurs, aperçus des autres, geste en cours, sélection), redessiné à chaque image utile.
 */

export const PAPER = '#fbf8f2'
const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif' // i18n-ignore : police CSS

/** Un curseur à l'écran : position lissée vers la cible, bulle de texte, réactions qui montent. */
export interface CursorView {
  conn: number
  name: string
  color: string
  tool: ToolId
  ink: string
  size: number
  x: number
  y: number
  targetX: number
  targetY: number
  /** Dernier mouvement (ms). */
  seen: number
  bubble: { text: string; until: number } | null
  reactions: { emoji: string; x: number; y: number; at: number }[]
  avatar: HTMLImageElement | null
}

export interface RenderEnv {
  /** Mon compte : pour marquer les cadres où je ne peux pas dessiner. */
  userId: string
  admin: boolean
  mode: 'vector' | 'tiles'
  maxTileLevel: number
}

/* ---- Objets ---------------------------------------------------------------------------- */

function dashOf(data: Data): number[] {
  if (data.d === 1) return [data.sw * 3, data.sw * 2]
  if (data.d === 2) return [data.sw, data.sw * 1.6]
  return []
}

function pathOfPoints(ctx: CanvasRenderingContext2D, values: readonly number[], closed: boolean): void {
  ctx.beginPath()
  for (let index = 0; index + 1 < values.length; index += 2) {
    if (index === 0) ctx.moveTo(values[0]!, values[1]!)
    else ctx.lineTo(values[index]!, values[index + 1]!)
  }
  if (closed) ctx.closePath()
}

function arrowHead(ctx: CanvasRenderingContext2D, q: readonly number[], width: number): void {
  const [x1, y1, x2, y2] = q as [number, number, number, number]
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const size = width * 4 + 8
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 + Math.cos(angle + Math.PI - 0.45) * size, y2 + Math.sin(angle + Math.PI - 0.45) * size)
  ctx.lineTo(x2 + Math.cos(angle + Math.PI + 0.45) * size, y2 + Math.sin(angle + Math.PI + 0.45) * size)
  ctx.closePath()
  ctx.fill()
}

function strokeStyle(ctx: CanvasRenderingContext2D, data: Data): void {
  ctx.strokeStyle = data.c
  ctx.lineWidth = data.sw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash(dashOf(data))
}

/** Dessine un objet (le contexte est dans le repère du monde). `alpha` : transparence en plus (aperçus). */
export function drawData(ctx: CanvasRenderingContext2D, data: Data, alpha = 1): void {
  if (data.t === 's') {
    drawStroke(ctx, data, alpha)
    return
  }
  ctx.save()
  ctx.globalAlpha = alpha * (data.a ?? 1)
  switch (data.t) {
    case 'r': {
      const cx = data.x + data.w / 2
      const cy = data.y + data.h / 2
      if (data.r) {
        ctx.translate(cx, cy)
        ctx.rotate(data.r)
        ctx.translate(-cx, -cy)
      }
      ctx.beginPath()
      if (data.k) ctx.roundRect(data.x, data.y, data.w, data.h, data.k)
      else ctx.rect(data.x, data.y, data.w, data.h)
      if (data.f) {
        ctx.fillStyle = data.f
        ctx.fill()
      }
      if (data.sw > 0) {
        strokeStyle(ctx, data)
        ctx.stroke()
      }
      break
    }
    case 'e': {
      const cx = data.x + data.w / 2
      const cy = data.y + data.h / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.max(0.1, data.w / 2), Math.max(0.1, data.h / 2), data.r ?? 0, 0, Math.PI * 2)
      if (data.f) {
        ctx.fillStyle = data.f
        ctx.fill()
      }
      if (data.sw > 0) {
        strokeStyle(ctx, data)
        ctx.stroke()
      }
      break
    }
    case 'l':
    case 'a': {
      strokeStyle(ctx, data)
      ctx.beginPath()
      ctx.moveTo(data.q[0]!, data.q[1]!)
      ctx.lineTo(data.q[2]!, data.q[3]!)
      ctx.stroke()
      if (data.t === 'a') {
        ctx.fillStyle = data.c
        arrowHead(ctx, data.q, data.sw)
      }
      break
    }
    case 'g': {
      const closed = data.cl === 1
      pathOfPoints(ctx, data.q, closed)
      if (closed && data.f) {
        ctx.fillStyle = data.f
        ctx.fill()
      }
      if (data.sw > 0) {
        strokeStyle(ctx, data)
        ctx.stroke()
      }
      break
    }
    case 'b': {
      const closed = data.cl === 1
      pathOfPoints(ctx, flattenBezier(data.n, closed, 18), closed)
      if (closed && data.f) {
        ctx.fillStyle = data.f
        ctx.fill()
      }
      if (data.sw > 0) {
        strokeStyle(ctx, data)
        ctx.stroke()
      }
      break
    }
    case 'x': {
      const { width, height } = textSize(data.tx, data.s)
      const left = data.al === 1 ? data.x - width / 2 : data.al === 2 ? data.x - width : data.x
      if (data.r) {
        ctx.translate(left + width / 2, data.y + height / 2)
        ctx.rotate(data.r)
        ctx.translate(-(left + width / 2), -(data.y + height / 2))
      }
      ctx.font = `${data.bd ? 700 : 400} ${data.s}px ${FONT}`
      ctx.fillStyle = data.c
      ctx.textBaseline = 'top'
      ctx.textAlign = data.al === 1 ? 'center' : data.al === 2 ? 'right' : 'left'
      data.tx.split('\n').forEach((line, index) => ctx.fillText(line, data.x, data.y + index * data.s * 1.25))
      break
    }
    case 'f':
      break
  }
  ctx.restore()
}

/** Un cadre : le papier, son bord, son titre et ses « j'aime » ; un cadenas s'il n'est pas à moi. */
export function drawFrame(ctx: CanvasRenderingContext2D, object: CanvasObject, data: FrameData, zoom: number, env: Pick<RenderEnv, 'userId' | 'admin'>): void {
  const border = Math.max(2, 1.4 / zoom)
  ctx.save()
  ctx.shadowColor = 'rgba(40,30,20,0.18)'
  ctx.shadowBlur = 14 / zoom
  ctx.shadowOffsetY = 4 / zoom
  ctx.fillStyle = data.f ?? '#ffffff'
  ctx.fillRect(data.x, data.y, data.w, data.h)
  ctx.restore()
  ctx.strokeStyle = data.c
  ctx.lineWidth = border
  ctx.strokeRect(data.x, data.y, data.w, data.h)
  const mine = object.owner === env.userId || data.co.includes(env.userId) || env.admin
  const size = 22
  ctx.font = `700 ${size}px ${FONT}`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = data.c
  const label = `${mine ? '' : '🔒 '}${data.tt || '·'}`
  ctx.fillText(label, data.x, data.y - 12)
  if (object.likes > 0) {
    ctx.textAlign = 'right'
    ctx.fillStyle = '#e0245e'
    ctx.fillText(`♥ ${object.likes}`, data.x + data.w, data.y - 12)
  }
}

/* ---- Calque de base --------------------------------------------------------------------- */

export class Renderer {
  private readonly baseContext: CanvasRenderingContext2D
  private readonly overlayContext: CanvasRenderingContext2D
  dpr = 1
  /** Objets dessinés à la dernière image (statistique). */
  lastCount = 0

  private readonly base: HTMLCanvasElement
  private readonly overlay: HTMLCanvasElement
  private readonly camera: Camera
  private readonly scene: Scene
  private readonly tiles: TileCache

  constructor(base: HTMLCanvasElement, overlay: HTMLCanvasElement, camera: Camera, scene: Scene, tiles: TileCache) {
    this.base = base
    this.overlay = overlay
    this.camera = camera
    this.scene = scene
    this.tiles = tiles
    this.baseContext = base.getContext('2d', { alpha: false })!
    this.overlayContext = overlay.getContext('2d')!
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr
    for (const canvas of [this.base, this.overlay]) {
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
    }
  }

  /** Repère du monde : pose la transformation caméra sur un contexte. */
  private world(ctx: CanvasRenderingContext2D): void {
    const scale = this.camera.zoom * this.dpr
    ctx.setTransform(scale, 0, 0, scale, -this.camera.x * scale, -this.camera.y * scale)
  }

  drawBase(env: RenderEnv): void {
    const ctx = this.baseContext
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, this.base.width, this.base.height)
    this.drawGrid(ctx)
    const view = this.camera.bounds()
    this.world(ctx)
    if (env.mode === 'tiles') {
      this.drawTiles(ctx, view, env.maxTileLevel)
      this.lastCount = 0
      return
    }
    const objects = this.scene.query(view)
    this.lastCount = objects.length
    const zoom = this.camera.zoom
    for (const object of objects) {
      const data = object.data
      // Trop petit pour se voir : un point de sa couleur.
      const extent = Math.max(object.box.maxX - object.box.minX, object.box.maxY - object.box.minY) * zoom
      if (extent < 0.6) continue
      if (extent < 2.2 && data.t !== 'f') {
        ctx.fillStyle = data.c
        ctx.globalAlpha = 0.7
        ctx.fillRect((object.box.minX + object.box.maxX) / 2 - 0.5 / zoom, (object.box.minY + object.box.maxY) / 2 - 0.5 / zoom, 1 / zoom, 1 / zoom)
        ctx.globalAlpha = 1
        continue
      }
      if (object.hidden) ctx.globalAlpha = 0.35
      if (data.t === 'f') drawFrame(ctx, object, data, zoom, env)
      else drawData(ctx, data)
      if (object.hidden) {
        ctx.globalAlpha = 1
        ctx.save()
        ctx.strokeStyle = '#e0245e'
        ctx.lineWidth = 2 / zoom
        ctx.setLineDash([6 / zoom, 4 / zoom])
        ctx.strokeRect(object.box.minX, object.box.minY, object.box.maxX - object.box.minX, object.box.maxY - object.box.minY)
        ctx.restore()
      }
    }
  }

  /** Points de repère : une grille qui s'adapte au zoom (jamais plus d'un point tous les ~24 px). */
  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const zoom = this.camera.zoom
    let spacing = 25
    while (spacing * zoom < 22) spacing *= 2
    if (spacing * zoom > 400) return
    const view = this.camera.bounds()
    const x0 = Math.floor(view.minX / spacing) * spacing
    const y0 = Math.floor(view.minY / spacing) * spacing
    const columns = Math.ceil((view.maxX - x0) / spacing) + 1
    const rows = Math.ceil((view.maxY - y0) / spacing) + 1
    if (columns * rows > 6000) return
    ctx.fillStyle = 'rgba(70,55,35,0.16)'
    const dot = Math.max(1, this.dpr * 1.2)
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const [sx, sy] = this.camera.toScreen(x0 + column * spacing, y0 + row * spacing)
        ctx.fillRect(Math.round(sx * this.dpr - dot / 2), Math.round(sy * this.dpr - dot / 2), dot, dot)
      }
    }
  }

  private drawTiles(ctx: CanvasRenderingContext2D, view: Box, maxLevel: number): void {
    const level = tileLevelFor(this.camera.zoom, maxLevel)
    const size = tileSize(level)
    const x0 = Math.floor(view.minX / size)
    const x1 = Math.floor(view.maxX / size)
    const y0 = Math.floor(view.minY / size)
    const y1 = Math.floor(view.maxY / size)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) return
    const [cx, cy] = this.camera.center()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const distance = Math.hypot((x + 0.5) * size - cx, (y + 0.5) * size - cy) / size
        const entry = this.tiles.get(level, x, y, distance)
        if (entry.bitmap) {
          ctx.drawImage(entry.bitmap, x * size, y * size, size, size)
        } else if (!entry.empty) {
          this.drawFallback(ctx, level, x, y, maxLevel)
        }
      }
    }
  }

  /** En attendant une tuile : l'image du niveau au-dessus (recadrée) ou celles du dessous. */
  private drawFallback(ctx: CanvasRenderingContext2D, level: number, x: number, y: number, maxLevel: number): void {
    const size = tileSize(level)
    if (level < maxLevel) {
      const parent = this.tiles.peek(level + 1, Math.floor(x / 2), Math.floor(y / 2))
      if (parent?.bitmap) {
        const half = parent.bitmap.width / 2
        ctx.drawImage(parent.bitmap, (x % 2 === 0 ? 0 : half) | 0, (y % 2 === 0 ? 0 : half) | 0, half, half, x * size, y * size, size, size)
        return
      }
    }
    if (level > 0) {
      for (let index = 0; index < 4; index += 1) {
        const dx = index % 2
        const dy = index >> 1
        const child = this.tiles.peek(level - 1, x * 2 + dx, y * 2 + dy)
        if (child?.bitmap) ctx.drawImage(child.bitmap, (x * 2 + dx) * (size / 2), (y * 2 + dy) * (size / 2), size / 2, size / 2)
      }
    }
  }

  /** Le calque du dessus : l'appelant dessine dans le repère du monde (`world`) ou de l'écran (`screen`). */
  drawOverlay(draw: (api: { ctx: CanvasRenderingContext2D; world: () => void; screen: () => void }) => void): void {
    const ctx = this.overlayContext
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    draw({
      ctx,
      world: () => this.world(ctx),
      screen: () => ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0),
    })
  }

  /** La couleur sous un point de l'écran (pipette). */
  pixelAt(sx: number, sy: number): string | null {
    try {
      const [r, g, b, a] = this.baseContext.getImageData(Math.round(sx * this.dpr), Math.round(sy * this.dpr), 1, 1).data
      if (a === 0) return null
      return `#${[r, g, b].map((value) => value!.toString(16).padStart(2, '0')).join('')}`
    } catch {
      return null
    }
  }
}

/* ---- Curseurs ---------------------------------------------------------------------------- */

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** Un curseur d'un autre joueur, en repère d'écran. */
export function drawCursor(ctx: CanvasRenderingContext2D, cursor: CursorView, sx: number, sy: number, now: number, anonymous: string): void {
  const idle = now - cursor.seen
  if (idle > 45_000) return
  ctx.save()
  ctx.globalAlpha = idle > 12_000 ? Math.max(0.25, 1 - (idle - 12_000) / 30_000) : 1
  ctx.translate(sx, sy)
  // Flèche.
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, 17)
  ctx.lineTo(4.4, 13.2)
  ctx.lineTo(7.4, 20)
  ctx.lineTo(10.2, 18.7)
  ctx.lineTo(7.3, 12.2)
  ctx.lineTo(12.6, 12.2)
  ctx.closePath()
  ctx.fillStyle = cursor.color
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.6
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.fill()
  // Étiquette : pastille de la couleur d'encre, pseudo.
  const label = cursor.name || anonymous
  ctx.font = `600 11.5px ${FONT}`
  const width = ctx.measureText(label).width
  const x = 12
  const y = 18
  roundRect(ctx, x, y, width + 30, 20, 10)
  ctx.fillStyle = cursor.color
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x + 10, y + 10, 5.5, 0, Math.PI * 2)
  ctx.fillStyle = cursor.ink
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(label, x + 21, y + 10.5)
  // Bulle de texte.
  if (cursor.bubble && cursor.bubble.until > now) {
    const text = cursor.bubble.text
    ctx.font = `500 13px ${FONT}`
    const w = Math.min(240, ctx.measureText(text).width) + 20
    const fade = Math.min(1, (cursor.bubble.until - now) / 600)
    ctx.globalAlpha *= fade
    roundRect(ctx, x, y + 26, w, 28, 14)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = cursor.color
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#1b1b1f'
    ctx.fillText(text.length > 40 ? `${text.slice(0, 39)}…` : text, x + 10, y + 40.5) // i18n-ignore : ellipse typographique
  }
  ctx.restore()
}

/** Réactions flottantes : montent et s'effacent en deux secondes. */
export function drawReactions(ctx: CanvasRenderingContext2D, cursor: CursorView, camera: Camera, now: number): void {
  cursor.reactions = cursor.reactions.filter((reaction) => now - reaction.at < 2200)
  for (const reaction of cursor.reactions) {
    const t = (now - reaction.at) / 2200
    const [sx, sy] = camera.toScreen(reaction.x, reaction.y)
    ctx.save()
    ctx.globalAlpha = 1 - t * t
    ctx.font = `${22 + (1 - t) * 8}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(reaction.emoji, sx + Math.sin(t * 7 + reaction.at) * 8, sy - t * 70)
    ctx.restore()
  }
}
