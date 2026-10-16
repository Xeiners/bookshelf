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
  /** Le doigt / le stylet est posé, même si rien ne se trace (on est dans un cadre réservé). */
  private held = false
  private warned = false
  /** Le trait reprend après un cadre réservé : un point isolé n'est qu'une bavure, on ne le garde pas. */
  private resumed = false
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
    this.held = true
    this.warned = false
    this.resumed = false
    this.pointerType = e.pointerType
    if (this.blocked(e.x, e.y, e.x, e.y)) return this.warn()
    this.begin(e.x, e.y, e.pressure)
  }

  private begin(x: number, y: number, pressure: number): void {
    this.active = true
    this.id = this.ctx.newId()
    this.points = []
    this.sent = 0
    this.lastX = x
    this.lastY = y
    this.add(x, y, pressure)
    this.ctx.redraw()
  }

  /** Le serveur refuse tout trait dont l'emprise (épaisseur comprise) touche un cadre réservé à un autre. */
  private blocked(fromX: number, fromY: number, x: number, y: number): boolean {
    const box = boundsOf({ ...this.style(), p: [fromX, fromY, 0.5, x, y, 0.5] })
    return this.ctx.lockedAt(0, 0, { minX: box.minX - 1, minY: box.minY - 1, maxX: box.maxX + 1, maxY: box.maxY + 1 })
  }

  private warn(): void {
    if (this.warned) return
    this.warned = true
    this.ctx.notify('frame_locked')
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
    if (!this.held) return
    const gap = 0.8 / this.ctx.camera.zoom
    const samples = e.coalesced.length > 0 ? e.coalesced : [{ x: e.x, y: e.y, pressure: e.pressure }]
    for (const sample of samples) {
      if (this.active && Math.hypot(sample.x - this.lastX, sample.y - this.lastY) < gap) continue
      // Un cadre réservé : le trait s'arrête à son bord (il reste ce qui est déjà tracé) et reprend
      // dehors. Sans cela le serveur refuserait tout le trait et il disparaîtrait d'un coup.
      if (this.blocked(this.active ? this.lastX : sample.x, this.active ? this.lastY : sample.y, sample.x, sample.y)) {
        if (this.active) this.finish()
        this.warn()
        continue
      }
      if (this.active) this.add(sample.x, sample.y, sample.pressure)
      else {
        this.begin(sample.x, sample.y, sample.pressure)
        this.resumed = true
      }
    }
    if (!this.active) {
      this.ctx.redraw()
      return
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
    if (this.resumed && this.points.length < 9) {
      this.ctx.liveEnd(this.id)
      this.points = []
      return
    }
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
    this.held = false
    this.finish()
    this.ctx.redraw()
  }

  cancel(): void {
    this.held = false
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
