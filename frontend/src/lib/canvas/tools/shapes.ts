import { boundsOf, frameArea, normalizedRect, overlaps } from '../geometry'
import { drawData } from '../render'
import type { Data, EllipseData, FrameData, LineData, RectData } from '../types'
import { commonStyle, type Overlay, type PointerInfo, type Tool, type ToolContext } from './context'

/*
 * Formes tracées en tirant : rectangle, ellipse, ligne, flèche, cadre. Majuscule : carré, cercle,
 * ligne à 45°. Alt : depuis le centre. Un simple clic pose une forme de taille par défaut. Les
 * autres voient la forme grandir pendant le geste.
 */

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'frame'

const LIVE_EVERY_MS = 70
const DEFAULT_SIZE = 140

function constrained(kind: ShapeKind, e: PointerInfo, x0: number, y0: number): { x1: number; y1: number } {
  let x1 = e.x
  let y1 = e.y
  if (!e.shift) return { x1, y1 }
  if (kind === 'line' || kind === 'arrow') {
    const angle = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4)
    const length = Math.hypot(x1 - x0, y1 - y0)
    return { x1: x0 + Math.cos(angle) * length, y1: y0 + Math.sin(angle) * length }
  }
  const side = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  x1 = x0 + Math.sign(x1 - x0 || 1) * side
  y1 = y0 + Math.sign(y1 - y0 || 1) * side
  return { x1, y1 }
}

export class ShapeTool implements Tool {
  cursor = 'crosshair'
  private ctx: ToolContext
  private kind: ShapeKind
  private active = false
  private id = ''
  private x0 = 0
  private y0 = 0
  private preview: Data | null = null
  private lastLive = 0
  private blocked = false

  constructor(ctx: ToolContext, kind: ShapeKind) {
    this.ctx = ctx
    this.kind = kind
  }

  /** La forme pour ce geste (null : trop petite ou invalide). */
  private shapeAt(e: PointerInfo, click: boolean): Data | null {
    const style = this.ctx.style()
    let { x1, y1 } = constrained(this.kind, e, this.x0, this.y0)
    let x0 = this.x0
    let y0 = this.y0
    if (e.alt && this.kind !== 'line' && this.kind !== 'arrow') {
      x0 = this.x0 - (x1 - this.x0)
      y0 = this.y0 - (y1 - this.y0)
    }
    if (click) {
      // Un clic : forme de taille par défaut, centrée sur le point.
      const half = (this.kind === 'frame' ? 320 : DEFAULT_SIZE) / 2
      x0 = this.x0 - half
      y0 = this.y0 - half * (this.kind === 'frame' ? 0.75 : 0.6)
      x1 = this.x0 + half
      y1 = this.y0 + half * (this.kind === 'frame' ? 0.75 : 0.6)
      if (this.kind === 'line' || this.kind === 'arrow') {
        x0 = this.x0 - half
        y0 = this.y0
        x1 = this.x0 + half
        y1 = this.y0
      }
    }
    switch (this.kind) {
      case 'rect': {
        const { x, y, w, h } = normalizedRect(x0, y0, x1, y1)
        if (w < 1 || h < 1) return null
        const data: RectData = { t: 'r', ...commonStyle(style, 'shape'), x, y, w: Math.min(w, this.ctx.limits.extent - 40), h: Math.min(h, this.ctx.limits.extent - 40) }
        if (style.radius > 0) data.k = Math.min(style.radius, Math.min(data.w, data.h) / 2)
        return data
      }
      case 'ellipse': {
        const { x, y, w, h } = normalizedRect(x0, y0, x1, y1)
        if (w < 1 || h < 1) return null
        const data: EllipseData = { t: 'e', ...commonStyle(style, 'shape'), x, y, w: Math.min(w, this.ctx.limits.extent - 40), h: Math.min(h, this.ctx.limits.extent - 40) }
        return data
      }
      case 'line':
      case 'arrow': {
        if (Math.hypot(x1 - x0, y1 - y0) < 1) return null
        const data: LineData = { t: this.kind === 'arrow' ? 'a' : 'l', ...commonStyle(style, 'line'), sw: Math.max(0.5, style.width), q: [x0, y0, x1, y1] }
        return data
      }
      case 'frame': {
        const { x, y, w, h } = normalizedRect(x0, y0, x1, y1)
        const clamp = (value: number) => Math.min(2048, Math.max(128, value))
        const data: FrameData = { t: 'f', c: '#1b1b1f', f: '#ffffff', sw: 2, x, y, w: clamp(w), h: clamp(h), tt: '', co: [] }
        return data
      }
    }
  }

  down(e: PointerInfo): void {
    if (!this.ctx.canDraw()) return this.ctx.notify('cannot_draw')
    this.active = true
    this.blocked = false
    this.id = this.ctx.newId()
    this.x0 = e.x
    this.y0 = e.y
    this.preview = null
    this.ctx.setDrawing(true)
  }

  move(e: PointerInfo): void {
    if (!this.active) return
    const data = this.shapeAt(e, false)
    this.preview = data
    if (data) {
      this.blocked = this.problem(data) !== null
      const now = performance.now()
      if (now - this.lastLive > LIVE_EVERY_MS && !this.blocked && this.kind !== 'frame') {
        this.ctx.liveObject(this.id, data)
        this.lastLive = now
      }
    }
    this.ctx.redraw()
  }

  /** Pourquoi cette forme serait refusée (côté client : le serveur tranche vraiment). */
  private problem(data: Data): string | null {
    const box = boundsOf(data)
    if (box.maxX - box.minX > this.ctx.limits.extent || box.maxY - box.minY > this.ctx.limits.extent) return 'too_big'
    if (data.t === 'f') {
      const area = frameArea(data)
      for (const object of this.ctx.scene.find(area)) {
        if (object.data.t === 'f' && overlaps(area, frameArea(object.data))) return 'frame_overlap'
        if (object.data.t !== 'f' && !object.hidden && object.owner !== this.ctx.meId() && overlaps(area, object.box)) return 'frame_occupied'
      }
      return null
    }
    return this.ctx.lockedAt(0, 0, box) ? 'frame_locked' : null
  }

  up(e: PointerInfo): void {
    if (!this.active) return
    this.active = false
    this.ctx.setDrawing(false)
    const moved = Math.hypot(e.x - this.x0, e.y - this.y0) * this.ctx.camera.zoom
    const data = this.shapeAt(e, moved < 4)
    this.ctx.liveEnd(this.id)
    this.preview = null
    if (!data) return this.ctx.redraw()
    const problem = this.problem(data)
    if (problem) {
      this.ctx.notify(problem)
      return this.ctx.redraw()
    }
    const id = this.id
    this.ctx.commit({ undo: [{ k: 'd', id }], redo: [{ k: 'c', id, o: data }] })
    if (data.t === 'f') {
      // Un cadre se nomme tout de suite.
      this.ctx.editText({
        x: data.x,
        y: data.y - 34,
        size: 22,
        color: data.c,
        bold: true,
        align: 0,
        value: '',
        multiline: false,
        done: (value) => {
          if (value === null) return
          const named: FrameData = { ...data, tt: value.slice(0, 40) }
          this.ctx.commit({ undo: [{ k: 'u', id, o: data }], redo: [{ k: 'u', id, o: named }] })
        },
      })
    }
    this.ctx.redraw()
  }

  cancel(): void {
    if (!this.active) return
    this.active = false
    this.ctx.setDrawing(false)
    this.ctx.liveEnd(this.id)
    this.preview = null
    this.ctx.redraw()
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.active) {
      this.cancel()
      return true
    }
    return false
  }

  overlay({ ctx, world }: Overlay): void {
    if (!this.preview) return
    world()
    if (this.preview.t === 'f') {
      const frame = this.preview
      const bad = this.blocked
      ctx.save()
      ctx.fillStyle = bad ? 'rgba(224,36,94,0.12)' : 'rgba(43,127,255,0.10)'
      ctx.fillRect(frame.x, frame.y, frame.w, frame.h)
      ctx.strokeStyle = bad ? '#e0245e' : '#2b7fff'
      ctx.lineWidth = 2 / this.ctx.camera.zoom
      ctx.setLineDash([8 / this.ctx.camera.zoom, 5 / this.ctx.camera.zoom])
      ctx.strokeRect(frame.x, frame.y, frame.w, frame.h)
      ctx.restore()
      return
    }
    drawData(ctx, this.preview, this.blocked ? 0.35 : 0.9)
  }
}

