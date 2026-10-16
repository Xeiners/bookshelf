import { hitTest } from '../geometry'
import type { CanvasObject } from '../types'
import type { Op } from '../history'
import type { Overlay, PointerInfo, Tool, ToolContext } from './context'

/*
 * La gomme : on passe sur ses propres dessins pour les effacer (l'objet entier, pas un morceau).
 * Les objets visés s'encadrent en rouge pendant le geste ; au relâchement ils partent d'un coup,
 * et un seul « annuler » les ramène.
 */

export class EraserTool implements Tool {
  cursor = 'none'
  private ctx: ToolContext
  private active = false
  private hit = new Map<string, CanvasObject>()
  private lastX = 0
  private lastY = 0
  private hoverAt: { sx: number; sy: number } | null = null

  constructor(ctx: ToolContext) {
    this.ctx = ctx
  }

  private sweep(x0: number, y0: number, x1: number, y1: number): void {
    const tol = 9 / this.ctx.camera.zoom
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (tol * 0.8)))
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      const x = x0 + (x1 - x0) * t
      const y = y0 + (y1 - y0) * t
      for (const object of this.ctx.scene.find({ minX: x - tol, minY: y - tol, maxX: x + tol, maxY: y + tol })) {
        if (this.hit.has(object.id) || object.data.t === 'f' || !this.ctx.canEdit(object)) continue
        if (hitTest(object.data, x, y, tol)) this.hit.set(object.id, object)
      }
    }
  }

  down(e: PointerInfo): void {
    this.active = true
    this.hit.clear()
    this.lastX = e.x
    this.lastY = e.y
    this.sweep(e.x, e.y, e.x, e.y)
    this.ctx.redraw()
  }

  move(e: PointerInfo): void {
    this.hoverAt = { sx: e.sx, sy: e.sy }
    if (this.active) {
      this.sweep(this.lastX, this.lastY, e.x, e.y)
      this.lastX = e.x
      this.lastY = e.y
    }
    this.ctx.redraw()
  }

  hover(e: PointerInfo): void {
    this.move(e)
  }

  up(): void {
    if (!this.active) return
    this.active = false
    const targets = [...this.hit.values()]
    this.hit.clear()
    if (targets.length > 0) {
      this.ctx.commit({
        undo: targets.map((object): Op => ({ k: 'c', id: object.id, o: object.data })),
        redo: targets.map((object): Op => ({ k: 'd', id: object.id })),
      })
    }
    this.ctx.redraw()
  }

  cancel(): void {
    this.active = false
    this.hit.clear()
    this.ctx.redraw()
  }

  overlay({ ctx, world, screen }: Overlay): void {
    world()
    ctx.strokeStyle = '#e0245e'
    ctx.lineWidth = 2 / this.ctx.camera.zoom
    ctx.setLineDash([5 / this.ctx.camera.zoom, 4 / this.ctx.camera.zoom])
    for (const object of this.hit.values()) ctx.strokeRect(object.box.minX, object.box.minY, object.box.maxX - object.box.minX, object.box.maxY - object.box.minY)
    ctx.setLineDash([])
    if (this.hoverAt) {
      screen()
      ctx.beginPath()
      ctx.arc(this.hoverAt.sx, this.hoverAt.sy, 9, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(224,36,94,0.12)'
      ctx.fill()
      ctx.strokeStyle = '#e0245e'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }
}
