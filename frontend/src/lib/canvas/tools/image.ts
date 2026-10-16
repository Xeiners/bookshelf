import { reach } from '../pointer'
import type { Reference, ReferenceLayer } from '../references'
import type { Overlay, PointerInfo, Tool, ToolContext } from './context'

/*
 * L'image de référence : on la prend (un appui sur elle), on la déplace, on la redimensionne par
 * ses coins (proportions gardées), on la tourne par la poignée du haut. Rien de tout cela ne passe
 * par le serveur : l'image est privée. Les images verrouillées ne se prennent plus (on dessine
 * dessus sans les bouger).
 */

type Handle = 'nw' | 'ne' | 'se' | 'sw' | 'rot'
const SIGNS: Record<Exclude<Handle, 'rot'>, [number, number]> = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] }
const MIN_SIDE = 24

export interface ImageApi {
  layer: ReferenceLayer
  selected(): string | null
  select(id: string | null): void
}

type Mode = 'idle' | 'move' | 'scale' | 'rotate'

export class ImageTool implements Tool {
  cursor = 'default'
  private ctx: ToolContext
  private api: ImageApi
  private mode: Mode = 'idle'
  private handle: Handle | null = null
  private start = { x: 0, y: 0 }
  private origin: Pick<Reference, 'x' | 'y' | 'w' | 'h' | 'r'> | null = null
  private angle0 = 0
  private hoverHandle: Handle | null = null

  constructor(ctx: ToolContext, api: ImageApi) {
    this.ctx = ctx
    this.api = api
  }

  private current(): Reference | undefined {
    const id = this.api.selected()
    return id ? this.api.layer.get(id) : undefined
  }

  private corner(item: Reference, handle: Handle): [number, number] {
    const cos = Math.cos(item.r)
    const sin = Math.sin(item.r)
    const [sx, sy] = handle === 'rot' ? [0, -1] : SIGNS[handle]
    const lx = (sx * item.w) / 2
    const ly = (sy * item.h) / 2 - (handle === 'rot' ? 34 / this.ctx.camera.zoom : 0)
    return [item.x + item.w / 2 + lx * cos - ly * sin, item.y + item.h / 2 + lx * sin + ly * cos]
  }

  private handleAt(item: Reference, sx: number, sy: number): Handle | null {
    for (const handle of ['rot', 'nw', 'ne', 'se', 'sw'] as const) {
      const [wx, wy] = this.corner(item, handle)
      const [px, py] = this.ctx.camera.toScreen(wx, wy)
      if (Math.hypot(px - sx, py - sy) <= reach(13)) return handle
    }
    return null
  }

  down(e: PointerInfo): void {
    this.start = { x: e.x, y: e.y }
    const item = this.current()
    if (item && !item.locked) {
      const handle = this.handleAt(item, e.sx, e.sy)
      if (handle) {
        this.handle = handle
        this.origin = { x: item.x, y: item.y, w: item.w, h: item.h, r: item.r }
        this.angle0 = Math.atan2(e.y - (item.y + item.h / 2), e.x - (item.x + item.w / 2))
        this.mode = handle === 'rot' ? 'rotate' : 'scale'
        return
      }
    }
    const hit = this.api.layer.hit(e.x, e.y)
    this.api.select(hit?.id ?? null)
    if (!hit) {
      this.mode = 'idle'
      return
    }
    this.api.layer.raise(hit.id)
    this.origin = { x: hit.x, y: hit.y, w: hit.w, h: hit.h, r: hit.r }
    this.mode = 'move'
  }

  move(e: PointerInfo): void {
    const item = this.current()
    const origin = this.origin
    if (this.mode === 'idle' || !item || !origin) return this.hover(e)
    if (this.mode === 'move') {
      this.api.layer.update(item.id, { x: origin.x + (e.x - this.start.x), y: origin.y + (e.y - this.start.y) })
    } else if (this.mode === 'rotate') {
      const cx = origin.x + origin.w / 2
      const cy = origin.y + origin.h / 2
      let turn = origin.r + Math.atan2(e.y - cy, e.x - cx) - this.angle0
      if (e.shift) turn = Math.round(turn / (Math.PI / 12)) * (Math.PI / 12)
      this.api.layer.update(item.id, { r: turn })
    } else if (this.mode === 'scale' && this.handle && this.handle !== 'rot') {
      // Le coin opposé reste en place ; le facteur vient de la distance du pointeur à ce coin.
      const [sx, sy] = SIGNS[this.handle]
      const cos = Math.cos(origin.r)
      const sin = Math.sin(origin.r)
      const cx = origin.x + origin.w / 2
      const cy = origin.y + origin.h / 2
      const ax = cx + ((-sx * origin.w) / 2) * cos - ((-sy * origin.h) / 2) * sin
      const ay = cy + ((-sx * origin.w) / 2) * sin + ((-sy * origin.h) / 2) * cos
      const factor = Math.max(MIN_SIDE / Math.min(origin.w, origin.h), Math.hypot(e.x - ax, e.y - ay) / Math.hypot(origin.w, origin.h))
      const w = origin.w * factor
      const h = origin.h * factor
      const ncx = ax + (cx - ax) * factor
      const ncy = ay + (cy - ay) * factor
      this.api.layer.update(item.id, { x: ncx - w / 2, y: ncy - h / 2, w, h })
    }
    this.ctx.redraw()
  }

  hover(e: PointerInfo): void {
    const item = this.current()
    const handle = item && !item.locked ? this.handleAt(item, e.sx, e.sy) : null
    if (handle !== this.hoverHandle) {
      this.hoverHandle = handle
      this.ctx.redraw()
    }
    this.cursor = handle ? (handle === 'rot' ? 'grab' : 'nwse-resize') : this.api.layer.hit(e.x, e.y) ? 'move' : 'default'
  }

  up(): void {
    this.mode = 'idle'
    this.handle = null
    this.origin = null
    this.ctx.redraw()
  }

  cancel(): void {
    const item = this.current()
    if (item && this.origin) this.api.layer.update(item.id, this.origin)
    this.up()
  }

  key(e: KeyboardEvent): boolean {
    const item = this.current()
    if (!item) return false
    if (e.key === 'Escape') {
      this.api.select(null)
      return true
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.api.layer.remove(item.id)
      this.api.select(null)
      return true
    }
    const step = (e.shiftKey ? 10 : 1) / this.ctx.camera.zoom
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const move = moves[e.key]
    if (!move || item.locked) return false
    this.api.layer.update(item.id, { x: item.x + move[0], y: item.y + move[1] })
    return true
  }

  overlay({ ctx, screen }: Overlay): void {
    const item = this.current()
    if (!item) return
    screen()
    const { camera } = this.ctx
    const corners = (['nw', 'ne', 'se', 'sw'] as const).map((handle) => camera.toScreen(...this.corner(item, handle)))
    ctx.beginPath()
    corners.forEach(([px, py], index) => (index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
    ctx.closePath()
    ctx.strokeStyle = item.locked ? '#8a8a96' : '#2b7fff'
    ctx.lineWidth = 1.4
    ctx.setLineDash(item.locked ? [5, 4] : [])
    ctx.stroke()
    ctx.setLineDash([])
    if (item.locked) return
    const [tx, ty] = camera.toScreen(...this.corner(item, 'rot'))
    const [mx, my] = [(corners[0]![0] + corners[1]![0]) / 2, (corners[0]![1] + corners[1]![1]) / 2]
    ctx.beginPath()
    ctx.moveTo(mx, my)
    ctx.lineTo(tx, ty)
    ctx.stroke()
    for (const handle of ['rot', 'nw', 'ne', 'se', 'sw'] as const) {
      const [px, py] = camera.toScreen(...this.corner(item, handle))
      ctx.beginPath()
      if (handle === 'rot') ctx.arc(px, py, 7, 0, Math.PI * 2)
      else ctx.rect(px - 6, py - 6, 12, 12)
      ctx.fillStyle = this.hoverHandle === handle ? '#2b7fff' : '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#2b7fff'
      ctx.stroke()
    }
  }
}
