import { containsPoint, frameArea, topObjectAt } from '../geometry'
import type { CanvasObject, TextData } from '../types'
import { textData, type Overlay, type PointerInfo, type Tool, type ToolContext } from './context'

/** La main : le moteur déplace la vue ; l'outil n'a rien d'autre à faire. */
export class HandTool implements Tool {
  cursor = 'grab'
  down(): void {}
  move(): void {}
  up(): void {}
  cancel(): void {}
}

/** La pipette : prend la couleur affichée sous le doigt (Alt : pour le remplissage). */
export class PickTool implements Tool {
  cursor = 'crosshair'
  private ctx: ToolContext

  constructor(ctx: ToolContext) {
    this.ctx = ctx
  }

  down(e: PointerInfo): void {
    const color = this.ctx.pickColor(e.sx, e.sy)
    if (!color) return
    this.ctx.setStyle(e.alt ? { fill: color, fillOn: true } : { ink: color })
    this.ctx.setTool('pen')
  }
  move(): void {}
  up(): void {}
  cancel(): void {}
}

/** L'objet à aimer : le cadre qui contient le point (l'œuvre), sinon l'objet touché. */
function likeTarget(ctx: ToolContext, x: number, y: number): CanvasObject | null {
  const near = ctx.scene.find({ minX: x - 2, minY: y - 2, maxX: x + 2, maxY: y + 2 })
  const frame = near.find((object) => object.data.t === 'f' && containsPoint(frameArea(object.data), x, y))
  if (frame) return frame
  return topObjectAt(near, x, y, ctx.tolerance())
}

/** Le cœur : aimer un dessin (et faire gagner une Poussière à son auteur). */
export class HeartTool implements Tool {
  cursor = 'pointer'
  private ctx: ToolContext
  private over: CanvasObject | null = null

  constructor(ctx: ToolContext) {
    this.ctx = ctx
  }

  down(e: PointerInfo): void {
    const target = likeTarget(this.ctx, e.x, e.y)
    if (!target) return
    if (target.owner === this.ctx.meId()) return this.ctx.notify('own_object')
    this.ctx.like(target.id, e.x, e.y)
  }

  hover(e: PointerInfo): void {
    const next = likeTarget(this.ctx, e.x, e.y)
    if (next?.id !== this.over?.id) {
      this.over = next
      this.ctx.redraw()
    }
  }

  move(e: PointerInfo): void {
    this.hover(e)
  }
  up(): void {}
  cancel(): void {}

  overlay({ ctx, world }: Overlay): void {
    if (!this.over) return
    world()
    const { box } = this.over
    ctx.strokeStyle = '#e0245e'
    ctx.lineWidth = 2.5 / this.ctx.camera.zoom
    ctx.setLineDash([])
    ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
  }
}

/** Le texte : un clic pose un champ de saisie ; un clic sur un de mes textes le modifie. */
export class TextTool implements Tool {
  cursor = 'text'
  private ctx: ToolContext

  constructor(ctx: ToolContext) {
    this.ctx = ctx
  }

  down(e: PointerInfo): void {
    const existing = topObjectAt(this.ctx.scene.find({ minX: e.x - 2, minY: e.y - 2, maxX: e.x + 2, maxY: e.y + 2 }), e.x, e.y, this.ctx.tolerance())
    if (existing && existing.data.t === 'x' && this.ctx.canEdit(existing)) return editExisting(this.ctx, existing, existing.data)
    if (!this.ctx.canDraw()) return this.ctx.notify('cannot_draw')
    if (this.ctx.lockedAt(e.x, e.y)) return this.ctx.notify('frame_locked')
    const style = this.ctx.style()
    const id = this.ctx.newId()
    this.ctx.editText({
      x: e.x,
      y: e.y,
      size: style.fontSize,
      color: style.ink,
      bold: style.bold,
      align: style.align,
      value: '',
      multiline: true,
      done: (value) => {
        if (value === null || value.trim() === '') return
        const data = textData(style, e.x, e.y, value.slice(0, 200))
        this.ctx.commit({ undo: [{ k: 'd', id }], redo: [{ k: 'c', id, o: data }] })
      },
    })
  }
  move(): void {}
  up(): void {}
  cancel(): void {}
}

/** Modifier un texte existant (outil Texte, ou double-clic avec la sélection). */
export function editExisting(ctx: ToolContext, object: CanvasObject, data: TextData): void {
  ctx.editText({
    x: data.x,
    y: data.y,
    size: data.s,
    color: data.c,
    bold: data.bd === 1,
    align: data.al ?? 0,
    value: data.tx,
    multiline: true,
    done: (value) => {
      if (value === null || value.trim() === '' || value === data.tx) return
      const next: TextData = { ...data, tx: value.slice(0, 200) }
      ctx.commit({ undo: [{ k: 'u', id: object.id, o: data }], redo: [{ k: 'u', id: object.id, o: next }] })
    },
  })
}
