import { boundsOf, simplifyStroke } from '../geometry'
import type { StrokeData } from '../types'
import { commonStyle, type PointerInfo, type Tool, type ToolContext } from './context'
import { drawData } from '../render'

/*
 * Le pinceau : un trait à main levée. Chaque point garde sa pression (stylet) ; à la souris la
 * pression reste constante et c'est la vitesse qui fait l'épaisseur. Pendant le tracé les autres
 * voient le trait se former (aperçu en direct, par petits paquets) ; au relâchement le tracé est
 * allégé (Douglas-Peucker) et devient un objet. Un trait trop long ou trop étendu est coupé en deux
 * sans que le doigt ne s'en aperçoive.
 */

const LIVE_EVERY_MS = 55
const LIVE_POINTS = 120

export class PenTool implements Tool {
  cursor = 'none'
  private ctx: ToolContext
  private points: number[] = []
  private id = ''
  private active = false
  private lastX = 0
  private lastY = 0
  private sent = 0
  private lastSend = 0
  private pointerType = 'mouse'
  private hoverAt: { sx: number; sy: number } | null = null

  constructor(ctx: ToolContext) {
    this.ctx = ctx
  }

  private style(): StrokeData {
    const style = this.ctx.style()
    const common = commonStyle(style, 'stroke')
    const data: StrokeData = { t: 's', ...common, p: this.points }
    if (style.brush !== 'pen') data.b = style.brush
    return data
  }

  down(e: PointerInfo): void {
    if (!this.ctx.canDraw()) return this.ctx.notify('cannot_draw')
    if (this.ctx.lockedAt(e.x, e.y)) return this.ctx.notify('frame_locked')
    this.active = true
    this.id = this.ctx.newId()
    this.pointerType = e.pointerType
    this.points = []
    this.sent = 0
    this.lastX = e.x
    this.lastY = e.y
    this.add(e.x, e.y, e.pressure)
    this.ctx.redraw()
  }

  private add(x: number, y: number, pressure: number): void {
    // Souris : pression constante (la vitesse fait l'épaisseur) ; stylet / doigt : la vraie.
    const value = this.pointerType === 'mouse' ? 0.5 : Math.min(1, Math.max(0.05, pressure || 0.5))
    this.points.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(value * 100) / 100)
    this.lastX = x
    this.lastY = y
  }

  move(e: PointerInfo): void {
    this.hoverAt = { sx: e.sx, sy: e.sy }
    if (!this.active) return
    const gap = 0.8 / this.ctx.camera.zoom
    const samples = e.coalesced.length > 0 ? e.coalesced : [{ x: e.x, y: e.y, pressure: e.pressure }]
    for (const sample of samples) {
      if (Math.hypot(sample.x - this.lastX, sample.y - this.lastY) < gap) continue
      this.add(sample.x, sample.y, sample.pressure)
    }
    this.splitIfTooBig()
    this.flushLive(false)
    this.ctx.redraw()
  }

  hover(e: PointerInfo): void {
    this.hoverAt = { sx: e.sx, sy: e.sy }
    this.ctx.redraw()
  }

  /** Trop de points, ou trop étendu pour le serveur : ce qui est fait part, le trait continue d'un point. */
  private splitIfTooBig(): void {
    const count = this.points.length / 3
    const box = boundsOf(this.style())
    const big = box.maxX - box.minX > this.ctx.limits.extent - 120 || box.maxY - box.minY > this.ctx.limits.extent - 120
    if (count < this.ctx.limits.strokePoints - 40 && !big) return
    const x = this.lastX
    const y = this.lastY
    const pressure = this.points[this.points.length - 1]!
    this.finish()
    this.active = true
    this.id = this.ctx.newId()
    this.points = []
    this.sent = 0
    this.add(x, y, pressure)
  }

  private flushLive(force: boolean): void {
    const now = performance.now()
    if (!force && now - this.lastSend < LIVE_EVERY_MS) return
    const pending = this.points.length - this.sent
    if (pending <= 0) return
    const take = Math.min(pending, LIVE_POINTS * 3)
    const style = this.style()
    this.ctx.liveStroke(this.id, this.points.slice(this.sent, this.sent + take), { c: style.c, sw: style.sw, ...(style.a ? { a: style.a } : {}), ...(style.b ? { b: style.b } : {}) })
    this.sent += take
    this.lastSend = now
  }

  private finish(): void {
    if (!this.active) return
    this.active = false
    this.flushLive(true)
    while (this.sent < this.points.length) this.flushLive(true)
    const tolerance = Math.max(0.25, 0.45 / this.ctx.camera.zoom)
    const simplified = this.points.length >= 9 ? simplifyStroke(this.points, tolerance) : this.points
    const data = { ...this.style(), p: simplified }
    this.ctx.commit({ undo: [{ k: 'd', id: this.id }], redo: [{ k: 'c', id: this.id, o: data }] })
    this.ctx.liveEnd(this.id)
    this.points = []
  }

  up(): void {
    this.finish()
    this.ctx.redraw()
  }

  cancel(): void {
    if (!this.active) return
    this.active = false
    this.ctx.liveEnd(this.id)
    this.points = []
    this.ctx.redraw()
  }

  overlay({ ctx, world, screen }: Parameters<NonNullable<Tool['overlay']>>[0]): void {
    if (this.active && this.points.length >= 3) {
      world()
      drawData(ctx, this.style())
    }
    // Le pinceau, à la taille qu'il aura (rond de la couleur d'encre).
    if (this.hoverAt && this.pointerType !== 'touch') {
      screen()
      const style = this.ctx.style()
      const radius = Math.max(2, (style.width * (style.brush === 'highlighter' ? 1.8 : 1) * this.ctx.camera.zoom) / 2)
      ctx.beginPath()
      ctx.arc(this.hoverAt.sx, this.hoverAt.sy, radius, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.strokeStyle = style.ink
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
  }

  dispose(): void {
    this.cancel()
  }
}
