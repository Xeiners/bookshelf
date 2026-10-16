import { boundsOf } from '../geometry'
import { reach } from '../pointer'
import { drawData } from '../render'
import type { BezierData, Data, PolyData } from '../types'
import { commonStyle, type Overlay, type PointerInfo, type Tool, type ToolContext } from './context'

/*
 * Tracés point par point. Le polygone : un clic par sommet ; revenir sur le premier le ferme
 * (rempli si le remplissage est actif), Entrée ou double-clic le laisse ouvert. La plume de
 * Bézier : un clic pose un point d'angle, un clic tiré pose un point lisse (les poignées
 * apparaissent en tirant) ; mêmes façons de terminer. Retour arrière retire le dernier point,
 * Échap abandonne.
 */

const closeRadius = () => reach(11)
const LIVE_EVERY_MS = 80

abstract class PathTool implements Tool {
  cursor = 'crosshair'
  protected ctx: ToolContext
  protected id = ''
  protected open = false
  protected cursorAt: { x: number; y: number } | null = null
  private lastLive = 0

  constructor(ctx: ToolContext) {
    this.ctx = ctx
  }

  protected abstract count(): number
  protected abstract build(closed: boolean, cursor: { x: number; y: number } | null): Data | null
  protected abstract removeLast(): void
  protected abstract reset(): void

  protected begin(e: PointerInfo): boolean {
    if (this.open) return true
    if (!this.ctx.canDraw()) {
      this.ctx.notify('cannot_draw')
      return false
    }
    if (this.ctx.lockedAt(e.x, e.y)) {
      this.ctx.notify('frame_locked')
      return false
    }
    this.open = true
    this.id = this.ctx.newId()
    this.ctx.setDrawing(true)
    return true
  }

  protected finish(closed: boolean): void {
    if (!this.open) return
    const data = this.build(closed, null)
    const enough = closed ? this.count() >= 3 : this.count() >= 2
    this.open = false
    this.ctx.setDrawing(false)
    this.ctx.liveEnd(this.id)
    const id = this.id
    this.reset()
    if (data && enough) {
      const box = boundsOf(data)
      if (box.maxX - box.minX > this.ctx.limits.extent || box.maxY - box.minY > this.ctx.limits.extent) this.ctx.notify('too_big')
      else if (this.ctx.lockedAt(0, 0, box)) this.ctx.notify('frame_locked')
      else {
        this.ctx.commit({ undo: [{ k: 'd', id }], redo: [{ k: 'c', id, o: data }] })
      }
    }
    this.ctx.redraw()
  }

  protected live(): void {
    const now = performance.now()
    if (now - this.lastLive < LIVE_EVERY_MS || this.count() < 2) return
    const data = this.build(false, this.cursorAt)
    if (data) this.ctx.liveObject(this.id, data)
    this.lastLive = now
  }

  abstract down(e: PointerInfo): void
  move(e: PointerInfo): void {
    this.cursorAt = { x: e.x, y: e.y }
    if (this.open) {
      this.live()
      this.ctx.redraw()
    }
  }
  hover(e: PointerInfo): void {
    this.move(e)
  }
  up(): void {}

  cancel(): void {
    if (!this.open) return
    this.open = false
    this.ctx.setDrawing(false)
    this.ctx.liveEnd(this.id)
    this.reset()
    this.ctx.redraw()
  }

  key(e: KeyboardEvent): boolean {
    if (!this.open) return false
    if (e.key === 'Enter') {
      this.finish(false)
      return true
    }
    if (e.key === 'Escape') {
      this.cancel()
      return true
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      this.removeLast()
      if (this.count() === 0) this.cancel()
      this.ctx.redraw()
      return true
    }
    return false
  }

  overlay({ ctx, world, screen }: Overlay): void {
    if (!this.open) return
    const data = this.build(false, this.cursorAt)
    if (data) {
      world()
      drawData(ctx, data, 0.9)
    }
    screen()
    this.drawHandles(ctx)
  }

  protected abstract drawHandles(ctx: CanvasRenderingContext2D): void

  dispose(): void {
    this.cancel()
  }
}

export class PolygonTool extends PathTool {
  private points: number[] = []

  protected count(): number {
    return this.points.length / 2
  }

  protected reset(): void {
    this.points = []
    this.cursorAt = null
  }

  protected removeLast(): void {
    this.points.splice(-2, 2)
  }

  protected build(closed: boolean, cursor: { x: number; y: number } | null): Data | null {
    const q = [...this.points]
    if (cursor && q.length >= 2) q.push(cursor.x, cursor.y)
    if (q.length < 4) return null
    const style = this.ctx.style()
    const data: PolyData = { t: 'g', ...commonStyle(style, 'shape'), q: q.map((value) => Math.round(value * 100) / 100) }
    if (closed) data.cl = 1
    else delete data.f
    return data
  }

  down(e: PointerInfo): void {
    if (!this.begin(e)) return
    if (e.detail >= 2 && this.count() >= 2) {
      // Le double-clic a déjà posé son premier point : on termine sans le doubler.
      return this.finish(false)
    }
    const near = this.count() >= 3 && Math.hypot(e.x - this.points[0]!, e.y - this.points[1]!) * this.ctx.camera.zoom < closeRadius()
    if (near) return this.finish(true)
    this.points.push(Math.round(e.x * 100) / 100, Math.round(e.y * 100) / 100)
    if (this.points.length / 2 >= 250) this.finish(false)
    this.ctx.redraw()
  }

  protected drawHandles(ctx: CanvasRenderingContext2D): void {
    const { camera } = this.ctx
    for (let index = 0; index < this.points.length; index += 2) {
      const [sx, sy] = camera.toScreen(this.points[index]!, this.points[index + 1]!)
      ctx.beginPath()
      ctx.rect(sx - 4, sy - 4, 8, 8)
      ctx.fillStyle = index === 0 ? '#2b7fff' : '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#2b7fff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }
}

interface Node {
  x: number
  y: number
  ix: number
  iy: number
  ox: number
  oy: number
}

export class BezierTool extends PathTool {
  private nodes: Node[] = []
  private dragging = false

  protected count(): number {
    return this.nodes.length
  }

  protected reset(): void {
    this.nodes = []
    this.cursorAt = null
    this.dragging = false
  }

  protected removeLast(): void {
    this.nodes.pop()
  }

  protected build(closed: boolean, cursor: { x: number; y: number } | null): Data | null {
    const nodes = this.nodes.map((node) => ({ ...node }))
    if (cursor && nodes.length >= 1 && !this.dragging) nodes.push({ x: cursor.x, y: cursor.y, ix: cursor.x, iy: cursor.y, ox: cursor.x, oy: cursor.y })
    if (nodes.length < 2) return null
    const n: number[] = []
    for (const node of nodes) n.push(node.x, node.y, node.ix, node.iy, node.ox, node.oy)
    const data: BezierData = { t: 'b', ...commonStyle(this.ctx.style(), 'shape'), n: n.map((value) => Math.round(value * 100) / 100) }
    if (closed) data.cl = 1
    else delete data.f
    return data
  }

  down(e: PointerInfo): void {
    if (!this.begin(e)) return
    if (e.detail >= 2 && this.nodes.length >= 2) {
      // Le second clic du double-clic : on termine (le premier a déjà posé un point en double).
      this.nodes.pop()
      return this.finish(false)
    }
    const first = this.nodes[0]
    if (first && this.nodes.length >= 3 && Math.hypot(e.x - first.x, e.y - first.y) * this.ctx.camera.zoom < closeRadius()) {
      return this.finish(true)
    }
    this.nodes.push({ x: e.x, y: e.y, ix: e.x, iy: e.y, ox: e.x, oy: e.y })
    this.dragging = true
    if (this.nodes.length >= 120) this.finish(false)
    this.ctx.redraw()
  }

  move(e: PointerInfo): void {
    if (this.dragging) {
      const node = this.nodes[this.nodes.length - 1]
      if (node && Math.hypot(e.x - node.x, e.y - node.y) * this.ctx.camera.zoom > 3) {
        // Tirer fait la poignée de sortie ; celle d'entrée en est le miroir : un point lisse.
        node.ox = e.x
        node.oy = e.y
        node.ix = 2 * node.x - e.x
        node.iy = 2 * node.y - e.y
      }
      this.cursorAt = { x: e.x, y: e.y }
      this.ctx.redraw()
      return
    }
    super.move(e)
  }

  up(): void {
    this.dragging = false
    this.ctx.redraw()
  }

  protected drawHandles(ctx: CanvasRenderingContext2D): void {
    const { camera } = this.ctx
    ctx.lineWidth = 1.2
    for (const [index, node] of this.nodes.entries()) {
      const [sx, sy] = camera.toScreen(node.x, node.y)
      if (node.ix !== node.x || node.iy !== node.y || node.ox !== node.x || node.oy !== node.y) {
        for (const [hx, hy] of [
          [node.ix, node.iy],
          [node.ox, node.oy],
        ] as const) {
          const [px, py] = camera.toScreen(hx, hy)
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(px, py)
          ctx.strokeStyle = '#2b7fff'
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(px, py, 3.5, 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
          ctx.stroke()
        }
      }
      ctx.beginPath()
      ctx.rect(sx - 4.5, sy - 4.5, 9, 9)
      ctx.fillStyle = index === 0 ? '#2b7fff' : '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#2b7fff'
      ctx.stroke()
    }
  }
}

