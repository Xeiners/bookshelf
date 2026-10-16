import { boundsOf, compose, containsPoint, frameArea, inflate, overlaps, rotation, scaling, textSize, topObjectAt, transformData, translation, unionBox, type Affine } from '../geometry'
import type { Op } from '../history'
import type { BezierData, Box, CanvasObject, Data, LineData, PolyData } from '../types'
import { reach } from '../pointer'
import { editExisting } from './misc'
import type { Overlay, PointerInfo, Tool, ToolContext } from './context'
import { deleteSelected, duplicateSelected, editable, nudgeSelected, restackSelected, selectAllEditable, selectedObjects } from './selection'

/*
 * La sélection : cliquer un objet (Maj pour en ajouter), encadrer une zone, déplacer, redimensionner
 * par les poignées (Maj : proportions gardées), tourner par la poignée du haut (Maj : par 15°).
 * Double-clic : modifier un texte, renommer un cadre, ou éditer les points d'une courbe, d'un
 * polygone ou d'une ligne (déplacer un point ou une poignée ; Suppr retire le point). Pendant un geste
 * les autres voient les objets bouger (aperçu en direct) ; au relâchement, une seule entrée d'historique.
 */

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot'

const HANDLES: Record<Exclude<HandleId, 'rot'>, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
}
const CURSORS: Record<HandleId, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab' }

interface Oriented {
  cx: number
  cy: number
  w: number
  h: number
  angle: number
  /** Une rotation est possible (tout sauf un cadre). */
  turns: boolean
}

type Mode = 'idle' | 'move' | 'marquee' | 'scale' | 'rotate' | 'node'

interface NodeRef {
  /** Indice du point. */
  index: number
  /** `p` : le point, `i` / `o` : poignée d'entrée / de sortie (courbes). */
  part: 'p' | 'i' | 'o'
}

const LIVE_EVERY_MS = 70

export class SelectTool implements Tool {
  cursor = 'default'
  private ctx: ToolContext
  private mode: Mode = 'idle'
  private startX = 0
  private startY = 0
  private originals = new Map<string, CanvasObject>()
  private handle: HandleId | null = null
  private frame0: Oriented | null = null
  private marquee: Box | null = null
  private moved = false
  private lastLive = 0
  private hoverId: string | null = null
  private hoverHandle: HandleId | null = null
  private additive = false
  private angle0 = 0
  /** Édition des points : actif, point choisi. */
  private nodes = false
  private node: NodeRef | null = null

  constructor(ctx: ToolContext) {
    this.ctx = ctx
  }

  /* ---- Cadre de la sélection ------------------------------------------------------------ */

  private frame(): Oriented | null {
    const objects = editable(this.ctx)
    if (objects.length === 0) return null
    if (objects.length === 1) {
      const { data } = objects[0]!
      if (data.t === 'r' || data.t === 'e') return { cx: data.x + data.w / 2, cy: data.y + data.h / 2, w: data.w, h: data.h, angle: data.r ?? 0, turns: true }
      if (data.t === 'x') {
        const { width, height } = textSize(data.tx, data.s)
        const left = data.al === 1 ? data.x - width / 2 : data.al === 2 ? data.x - width : data.x
        return { cx: left + width / 2, cy: data.y + height / 2, w: width, h: height, angle: data.r ?? 0, turns: true }
      }
      if (data.t === 'f') {
        const area = frameArea(data)
        return { cx: (area.minX + area.maxX) / 2, cy: (area.minY + area.maxY) / 2, w: data.w, h: data.h, angle: 0, turns: false }
      }
    }
    const box = unionBox(objects.map((object) => object.box))
    return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, w: box.maxX - box.minX, h: box.maxY - box.minY, angle: 0, turns: objects.every((object) => object.data.t !== 'f') }
  }

  private handlePoint(frame: Oriented, handle: HandleId): [number, number] {
    const cos = Math.cos(frame.angle)
    const sin = Math.sin(frame.angle)
    let lx: number
    let ly: number
    if (handle === 'rot') {
      lx = 0
      ly = -frame.h / 2 - 30 / this.ctx.camera.zoom
    } else {
      const [sx, sy] = HANDLES[handle]
      lx = (sx * frame.w) / 2
      ly = (sy * frame.h) / 2
    }
    return [frame.cx + lx * cos - ly * sin, frame.cy + lx * sin + ly * cos]
  }

  private handleAt(frame: Oriented, sx: number, sy: number): HandleId | null {
    const list: HandleId[] = frame.turns ? ['rot', ...(Object.keys(HANDLES) as HandleId[])] : (Object.keys(HANDLES) as HandleId[])
    for (const handle of list) {
      const [wx, wy] = this.handlePoint(frame, handle)
      const [px, py] = this.ctx.camera.toScreen(wx, wy)
      if (Math.hypot(px - sx, py - sy) <= reach(10)) return handle
    }
    return null
  }

  /* ---- Cibles --------------------------------------------------------------------------- */

  /** L'objet cliqué ; un cadre ne se prend que par son bandeau ou son bord. */
  private pick(x: number, y: number): CanvasObject | null {
    const tol = this.ctx.tolerance()
    const near = this.ctx.scene.find({ minX: x - tol, minY: y - tol, maxX: x + tol, maxY: y + tol })
    const frames: CanvasObject[] = []
    const others: CanvasObject[] = []
    for (const object of near) (object.data.t === 'f' ? frames : others).push(object)
    const top = topObjectAt(others, x, y, tol)
    if (top) return top
    for (const frame of frames) {
      if (frame.data.t !== 'f') continue
      const area = frameArea(frame.data)
      const header = x >= area.minX && x <= area.maxX && y >= area.minY - 44 && y <= area.minY
      const border = containsPoint(inflate(area, tol * 2), x, y) && !containsPoint(inflate(area, -tol * 2), x, y)
      if (header || border) return frame
    }
    return null
  }

  /* ---- Geste ---------------------------------------------------------------------------- */

  down(e: PointerInfo): void {
    this.startX = e.x
    this.startY = e.y
    this.moved = false
    this.additive = e.shift
    const state = this.ctx.state()
    // Édition des points d'une courbe.
    if (this.nodes) {
      const node = this.nodeAt(e.sx, e.sy)
      if (node) {
        this.node = node
        this.mode = 'node'
        this.snapshot()
        return
      }
      this.nodes = false
      this.node = null
    }
    // Poignées de la sélection.
    const frame = this.frame()
    if (frame && state.selection.length > 0) {
      const handle = this.handleAt(frame, e.sx, e.sy)
      if (handle) {
        this.handle = handle
        this.frame0 = frame
        this.mode = handle === 'rot' ? 'rotate' : 'scale'
        this.angle0 = Math.atan2(e.y - frame.cy, e.x - frame.cx)
        this.snapshot()
        return
      }
    }
    const hit = this.pick(e.x, e.y)
    if (e.detail >= 2 && hit) return this.doubleClick(hit)
    if (hit) {
      const selected = state.selection.includes(hit.id)
      if (e.shift) this.ctx.select(selected ? state.selection.filter((id) => id !== hit.id) : [...state.selection, hit.id])
      else if (!selected) this.ctx.select([hit.id])
      this.mode = 'move'
      this.snapshot()
      return
    }
    if (!e.shift) this.ctx.select([])
    this.mode = 'marquee'
    this.marquee = { minX: e.x, minY: e.y, maxX: e.x, maxY: e.y }
    this.ctx.redraw()
  }

  /** Mémorise l'état de départ des objets modifiables sélectionnés. */
  private snapshot(): void {
    this.originals.clear()
    for (const object of editable(this.ctx)) this.originals.set(object.id, object)
  }

  private doubleClick(hit: CanvasObject): void {
    this.mode = 'idle'
    this.ctx.select([hit.id])
    if (!this.ctx.canEdit(hit)) return
    const { data } = hit
    if (data.t === 'x') return editExisting(this.ctx, hit, data)
    if (data.t === 'f') {
      return this.ctx.editText({
        x: data.x,
        y: data.y - 34,
        size: 22,
        color: data.c,
        bold: true,
        align: 0,
        value: data.tt,
        multiline: false,
        done: (value) => {
          if (value === null || value === data.tt) return
          this.ctx.commit({ undo: [{ k: 'u', id: hit.id, o: data }], redo: [{ k: 'u', id: hit.id, o: { ...data, tt: value.slice(0, 40) } }] })
        },
      })
    }
    if (data.t === 'b' || data.t === 'g' || data.t === 'l' || data.t === 'a') {
      this.nodes = true
      this.node = null
      this.ctx.redraw()
    }
  }

  move(e: PointerInfo): void {
    if (this.mode === 'idle') return this.hover(e)
    const distance = Math.hypot(e.x - this.startX, e.y - this.startY) * this.ctx.camera.zoom
    if (!this.moved && distance < 3) return
    this.moved = true
    switch (this.mode) {
      case 'marquee':
        this.marquee = { minX: Math.min(this.startX, e.x), minY: Math.min(this.startY, e.y), maxX: Math.max(this.startX, e.x), maxY: Math.max(this.startY, e.y) }
        break
      case 'move': {
        let dx = e.x - this.startX
        let dy = e.y - this.startY
        if (e.shift) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0
          else dx = 0
        }
        this.applyAffine(translation(dx, dy))
        break
      }
      case 'scale':
        this.applyAffine(this.scaleAffine(e))
        break
      case 'rotate':
        this.applyAffine(this.rotateAffine(e))
        break
      case 'node':
        this.moveNode(e)
        break
      default:
        break
    }
    this.ctx.redraw()
  }

  hover(e: PointerInfo): void {
    const frame = this.frame()
    const handle = frame && this.ctx.state().selection.length > 0 ? this.handleAt(frame, e.sx, e.sy) : null
    const hit = handle ? null : this.pick(e.x, e.y)
    if (handle !== this.hoverHandle || (hit?.id ?? null) !== this.hoverId) {
      this.hoverHandle = handle
      this.hoverId = hit?.id ?? null
      this.cursor = handle ? CURSORS[handle] : hit ? 'move' : 'default'
      this.ctx.redraw()
    }
  }

  /** Aperçu : les objets d'origine, transformés. Le serveur n'en sait rien avant le relâchement… sauf les spectateurs (aperçu en direct). */
  private applyAffine(m: Affine): void {
    const now = performance.now()
    const send = now - this.lastLive > LIVE_EVERY_MS
    for (const original of this.originals.values()) {
      const data = transformData(original.data, m)
      this.ctx.previewObject({ ...original, data, box: boundsOf(data) })
      if (send && original.data.t !== 'f') this.ctx.liveObject(original.id, data)
    }
    if (send) this.lastLive = now
  }

  private scaleAffine(e: PointerInfo): Affine {
    const frame = this.frame0!
    const [sx, sy] = HANDLES[this.handle as Exclude<HandleId, 'rot'>]
    const cos = Math.cos(-frame.angle)
    const sin = Math.sin(-frame.angle)
    // Le pointeur dans le repère propre du cadre (origine au centre).
    const px = (e.x - frame.cx) * cos - (e.y - frame.cy) * sin
    const py = (e.x - frame.cx) * sin + (e.y - frame.cy) * cos
    const hw = Math.max(frame.w / 2, 0.5)
    const hh = Math.max(frame.h / 2, 0.5)
    let fx = sx === 0 ? 1 : Math.max(0.02, ((px - -sx * hw) * sx) / (2 * hw))
    let fy = sy === 0 ? 1 : Math.max(0.02, ((py - -sy * hh) * sy) / (2 * hh))
    const proportional = e.shift && sx !== 0 && sy !== 0
    if (proportional) fx = fy = Math.max(fx, fy)
    if (e.alt) {
      // Depuis le centre.
      return compose(translation(frame.cx, frame.cy), compose(rotation(frame.angle, 0, 0), compose(scaling(fx, fy, 0, 0), compose(rotation(-frame.angle, 0, 0), translation(-frame.cx, -frame.cy)))))
    }
    const ax = -sx * hw
    const ay = -sy * hh
    return compose(translation(frame.cx, frame.cy), compose(rotation(frame.angle, 0, 0), compose(scaling(fx, fy, ax, ay), compose(rotation(-frame.angle, 0, 0), translation(-frame.cx, -frame.cy)))))
  }

  private rotateAffine(e: PointerInfo): Affine {
    const frame = this.frame0!
    let delta = Math.atan2(e.y - frame.cy, e.x - frame.cx) - this.angle0
    if (e.shift) {
      const step = Math.PI / 12
      delta = Math.round((frame.angle + delta) / step) * step - frame.angle
    }
    return rotation(delta, frame.cx, frame.cy)
  }

  /* ---- Points d'une courbe --------------------------------------------------------------- */

  private pathObject(): CanvasObject | null {
    const objects = editable(this.ctx)
    if (objects.length !== 1) return null
    const object = objects[0]!
    return object.data.t === 'b' || object.data.t === 'g' || object.data.t === 'l' || object.data.t === 'a' ? object : null
  }

  /** Les points modifiables, à l'écran : [indice, partie, x monde, y monde]. */
  private nodeList(object: CanvasObject): { index: number; part: NodeRef['part']; x: number; y: number }[] {
    const { data } = object
    const list: { index: number; part: NodeRef['part']; x: number; y: number }[] = []
    if (data.t === 'b') {
      for (let index = 0; index < data.n.length / 6; index += 1) {
        const base = index * 6
        const x = data.n[base]!
        const y = data.n[base + 1]!
        list.push({ index, part: 'p', x, y })
        if (data.n[base + 2] !== x || data.n[base + 3] !== y) list.push({ index, part: 'i', x: data.n[base + 2]!, y: data.n[base + 3]! })
        if (data.n[base + 4] !== x || data.n[base + 5] !== y) list.push({ index, part: 'o', x: data.n[base + 4]!, y: data.n[base + 5]! })
      }
    } else if (data.t === 'g' || data.t === 'l' || data.t === 'a') {
      for (let index = 0; index < data.q.length / 2; index += 1) list.push({ index, part: 'p', x: data.q[index * 2]!, y: data.q[index * 2 + 1]! })
    }
    return list
  }

  private nodeAt(sx: number, sy: number): NodeRef | null {
    const object = this.pathObject()
    if (!object) return null
    let best: NodeRef | null = null
    let bestDistance = reach(11)
    for (const node of this.nodeList(object)) {
      const [px, py] = this.ctx.camera.toScreen(node.x, node.y)
      const distance = Math.hypot(px - sx, py - sy)
      // Les points l'emportent sur les poignées quand ils se superposent.
      if (distance < bestDistance - (node.part === 'p' ? 2 : 0)) {
        best = { index: node.index, part: node.part }
        bestDistance = distance
      }
    }
    return best
  }

  private moveNode(e: PointerInfo): void {
    const object = this.pathObject()
    const node = this.node
    if (!object || !node) return
    const original = this.originals.get(object.id)
    if (!original) return
    const round = (value: number) => Math.round(value * 100) / 100
    let data: Data
    if (original.data.t === 'b') {
      const n = original.data.n.slice()
      const base = node.index * 6
      if (node.part === 'p') {
        const dx = e.x - n[base]!
        const dy = e.y - n[base + 1]!
        for (const offset of [0, 2, 4]) {
          n[base + offset] = round(n[base + offset]! + dx)
          n[base + offset + 1] = round(n[base + offset + 1]! + dy)
        }
      } else {
        const own = node.part === 'i' ? 2 : 4
        const other = node.part === 'i' ? 4 : 2
        n[base + own] = round(e.x)
        n[base + own + 1] = round(e.y)
        // Poignées liées : l'autre suit en miroir (Alt les détache).
        if (!e.alt) {
          n[base + other] = round(2 * n[base]! - e.x)
          n[base + other + 1] = round(2 * n[base + 1]! - e.y)
        }
      }
      data = { ...original.data, n } satisfies BezierData
    } else if (original.data.t === 'g') {
      const q = original.data.q.slice()
      q[node.index * 2] = round(e.x)
      q[node.index * 2 + 1] = round(e.y)
      data = { ...original.data, q } satisfies PolyData
    } else if (original.data.t === 'l' || original.data.t === 'a') {
      const q = original.data.q.slice()
      q[node.index * 2] = round(e.x)
      q[node.index * 2 + 1] = round(e.y)
      data = { ...original.data, q } satisfies LineData
    } else return
    this.ctx.previewObject({ ...original, data, box: boundsOf(data) })
    if (performance.now() - this.lastLive > LIVE_EVERY_MS) {
      this.ctx.liveObject(original.id, data)
      this.lastLive = performance.now()
    }
  }

  /** Retire le point choisi (Suppr). */
  private removeNode(): boolean {
    const object = this.pathObject()
    if (!object || !this.nodes || !this.node) return false
    const { data } = object
    let next: Data | null = null
    if (data.t === 'b' && data.n.length / 6 > 2) next = { ...data, n: data.n.filter((_, at) => Math.floor(at / 6) !== this.node!.index) }
    else if (data.t === 'g' && data.q.length / 2 > (data.cl ? 3 : 2)) next = { ...data, q: data.q.filter((_, at) => Math.floor(at / 2) !== this.node!.index) }
    if (!next) return false
    this.ctx.commit({ undo: [{ k: 'u', id: object.id, o: data }], redo: [{ k: 'u', id: object.id, o: next }] })
    this.node = null
    return true
  }

  /* ---- Fin du geste ---------------------------------------------------------------------- */

  up(): void {
    const mode = this.mode
    this.mode = 'idle'
    if (mode === 'marquee' && this.marquee) {
      const box = this.marquee
      this.marquee = null
      if (this.moved) {
        const found = this.ctx.scene
          .find(box)
          .filter((object) => !object.hidden && (object.data.t === 'f' ? box.minX <= object.box.minX && box.maxX >= object.box.maxX && box.minY <= object.box.minY && box.maxY >= object.box.maxY : overlaps(object.box, box)))
          .map((object) => object.id)
        const keep = this.additive ? this.ctx.state().selection : []
        this.ctx.select([...new Set([...keep, ...found])])
      }
      this.ctx.redraw()
      return
    }
    if ((mode === 'move' || mode === 'scale' || mode === 'rotate' || mode === 'node') && this.moved) {
      const undo: Op[] = []
      const redo: Op[] = []
      for (const original of this.originals.values()) {
        const current = this.ctx.scene.get(original.id)
        if (!current || current.data === original.data) continue
        undo.push({ k: 'u', id: original.id, o: original.data })
        redo.push({ k: 'u', id: original.id, o: current.data })
        this.ctx.liveEnd(original.id)
      }
      if (redo.length > 0) {
        // L'aperçu local est annulé avant de rejouer l'opération pour de bon.
        for (const original of this.originals.values()) this.ctx.previewObject(original)
        this.ctx.commit({ undo, redo })
      }
    }
    this.originals.clear()
    this.handle = null
    this.frame0 = null
    this.ctx.redraw()
  }

  cancel(): void {
    for (const original of this.originals.values()) {
      this.ctx.previewObject(original)
      this.ctx.liveEnd(original.id)
    }
    this.originals.clear()
    this.mode = 'idle'
    this.marquee = null
    this.ctx.redraw()
  }

  key(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey
    const step = (e.shiftKey ? 10 : 1) / this.ctx.camera.zoom
    switch (e.key) {
      case 'Escape':
        if (this.nodes) {
          this.nodes = false
          this.node = null
        } else this.ctx.select([])
        this.ctx.redraw()
        return true
      case 'Enter': {
        const object = this.pathObject()
        if (!object) return false
        this.nodes = !this.nodes
        this.ctx.redraw()
        return true
      }
      case 'Delete':
      case 'Backspace':
        if (this.nodes && this.removeNode()) return true
        return deleteSelected(this.ctx)
      case 'd':
      case 'D':
        return mod ? duplicateSelected(this.ctx) : false
      case 'a':
      case 'A':
        if (!mod) return false
        selectAllEditable(this.ctx)
        return true
      case 'ArrowLeft':
        return nudgeSelected(this.ctx, -step, 0)
      case 'ArrowRight':
        return nudgeSelected(this.ctx, step, 0)
      case 'ArrowUp':
        return nudgeSelected(this.ctx, 0, -step)
      case 'ArrowDown':
        return nudgeSelected(this.ctx, 0, step)
      case ']':
        return restackSelected(this.ctx, 'front')
      case '[':
        return restackSelected(this.ctx, 'back')
      default:
        return false
    }
  }

  /* ---- Calque du dessus ------------------------------------------------------------------ */

  overlay({ ctx, world, screen }: Overlay): void {
    const { camera } = this.ctx
    const selected = selectedObjects(this.ctx)
    world()
    // Survol.
    if (this.hoverId && !this.ctx.state().selection.includes(this.hoverId)) {
      const hover = this.ctx.scene.get(this.hoverId)
      if (hover) {
        ctx.strokeStyle = 'rgba(43,127,255,0.55)'
        ctx.lineWidth = 1.5 / camera.zoom
        ctx.strokeRect(hover.box.minX, hover.box.minY, hover.box.maxX - hover.box.minX, hover.box.maxY - hover.box.minY)
      }
    }
    // Contours des objets sélectionnés (bleu : les miens ; gris : ceux des autres).
    for (const object of selected) {
      const mine = this.ctx.canEdit(object)
      ctx.strokeStyle = mine ? '#2b7fff' : '#8a8a96'
      ctx.lineWidth = 1.4 / camera.zoom
      ctx.setLineDash(mine ? [] : [5 / camera.zoom, 4 / camera.zoom])
      ctx.strokeRect(object.box.minX, object.box.minY, object.box.maxX - object.box.minX, object.box.maxY - object.box.minY)
    }
    ctx.setLineDash([])
    if (this.marquee) {
      const m = this.marquee
      ctx.fillStyle = 'rgba(43,127,255,0.08)'
      ctx.strokeStyle = '#2b7fff'
      ctx.lineWidth = 1 / camera.zoom
      ctx.fillRect(m.minX, m.minY, m.maxX - m.minX, m.maxY - m.minY)
      ctx.strokeRect(m.minX, m.minY, m.maxX - m.minX, m.maxY - m.minY)
    }
    screen()
    const object = this.pathObject()
    if (this.nodes && object) {
      for (const node of this.nodeList(object)) {
        const [sx, sy] = camera.toScreen(node.x, node.y)
        const current = this.node?.index === node.index && this.node.part === node.part
        if (node.part !== 'p') {
          const point = this.nodeList(object).find((entry) => entry.index === node.index && entry.part === 'p')
          if (point) {
            const [px, py] = camera.toScreen(point.x, point.y)
            ctx.beginPath()
            ctx.moveTo(px, py)
            ctx.lineTo(sx, sy)
            ctx.strokeStyle = '#2b7fff'
            ctx.lineWidth = 1
            ctx.stroke()
          }
        }
        ctx.beginPath()
        if (node.part === 'p') ctx.rect(sx - 4.5, sy - 4.5, 9, 9)
        else ctx.arc(sx, sy, 3.6, 0, Math.PI * 2)
        ctx.fillStyle = current ? '#2b7fff' : '#ffffff'
        ctx.fill()
        ctx.strokeStyle = '#2b7fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      return
    }
    // Poignées du cadre de sélection.
    const frame = this.mode === 'scale' || this.mode === 'rotate' ? this.currentFrame() : this.frame()
    if (!frame) return
    const corners = (['nw', 'ne', 'se', 'sw'] as const).map((handle) => this.handlePoint(frame, handle))
    ctx.beginPath()
    corners.forEach(([wx, wy], index) => {
      const [sx, sy] = camera.toScreen(wx, wy)
      if (index === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    })
    ctx.closePath()
    ctx.strokeStyle = '#2b7fff'
    ctx.lineWidth = 1.2
    ctx.stroke()
    const handles: HandleId[] = frame.turns ? ['rot', ...(Object.keys(HANDLES) as HandleId[])] : (Object.keys(HANDLES) as HandleId[])
    for (const handle of handles) {
      const [wx, wy] = this.handlePoint(frame, handle)
      const [sx, sy] = camera.toScreen(wx, wy)
      if (handle === 'rot') {
        const [tx, ty] = camera.toScreen(...this.handlePoint(frame, 'n'))
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(sx, sy)
        ctx.stroke()
      }
      ctx.beginPath()
      if (handle === 'rot') ctx.arc(sx, sy, 5.5, 0, Math.PI * 2)
      else ctx.rect(sx - 4.5, sy - 4.5, 9, 9)
      ctx.fillStyle = this.hoverHandle === handle ? '#2b7fff' : '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#2b7fff'
      ctx.stroke()
    }
  }

  /** Pendant un redimensionnement, le cadre suit les objets transformés. */
  private currentFrame(): Oriented | null {
    return this.frame()
  }

  dispose(): void {
    this.cancel()
  }
}

