import { canvasApi } from '../../services/canvasApi'
import { useCanvasStore } from '../../store/useCanvasStore'
import { Camera, MAX_ZOOM, MIN_ZOOM, VECTOR_ENTER, VECTOR_LEAVE, tileLevelFor } from './camera'
import { boundsOf, containsPoint, frameArea, inflate, overlaps, unionBox } from './geometry'
import { History, type Entry, type Op } from './history'
import { CanvasSocket, type SocketStatus } from './net'
import { Renderer, drawCursor, drawData, drawReactions, type CursorView, type RenderEnv } from './render'
import { Scene, fromWire, type WireObject } from './scene'
import { TileCache } from './tilecache'
import { HeartTool, HandTool, PickTool, TextTool } from './tools/misc'
import { BezierTool, PolygonTool } from './tools/paths'
import { EraserTool } from './tools/eraser'
import { PenTool } from './tools/pen'
import { SelectTool } from './tools/select'
import { deleteSelected, duplicateSelected, nudgeSelected, restackSelected, selectAllEditable } from './tools/selection'
import { ShapeTool } from './tools/shapes'
import type { Overlay, PointerInfo, TextEditOptions, Tool, ToolContext } from './tools/context'
import type { Box, CanvasObject, Common, Data, Limits, PeerInfo, StrokeData, ToolId } from './types'

/*
 * Le moteur de la toile : relie la caméra, la scène, le rendu, le réseau et les outils.
 *
 * - Il reçoit les messages du serveur (objets, curseurs, aperçus, tuiles) et les range.
 * - Il traduit les gestes (souris, doigt, stylet) en appels aux outils, ou en déplacement de vue
 *   (main, Espace, bouton du milieu, deux doigts, molette).
 * - Il applique tout de suite en local ce que fait l'utilisateur (« optimiste »), l'envoie par lots,
 *   et se laisse corriger par le serveur, seul arbitre.
 * Rien ici ne passe par React : l'interface lit le store (`useCanvasStore`) et appelle les méthodes.
 */

const store = useCanvasStore

const hex = () => {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const cellKey = (limits: Limits, box: Box) => `${Math.floor(box.minX / limits.cell)}:${Math.floor(box.minY / limits.cell)}`

const TOOL_KEYS: Record<string, ToolId> = { v: 'select', h: 'hand', b: 'pen', e: 'eraser', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', g: 'polygon', p: 'bezier', t: 'text', f: 'frame', i: 'pick', k: 'heart' }

interface Float {
  emoji: string
  x: number
  y: number
  at: number
}

export class CanvasEngine {
  readonly camera = new Camera()
  readonly scene = new Scene()
  readonly history = new History()
  readonly peers = new Map<number, CursorView>()
  /** Où l'on a vu chaque joueur pour la dernière fois (même loin) : « aller vers ». */
  readonly places = new Map<number, { x: number; y: number }>()
  limits: Limits | null = null

  private readonly container: HTMLElement
  private readonly base: HTMLCanvasElement
  private readonly overlay: HTMLCanvasElement
  private readonly tiles: TileCache
  private readonly socket: CanvasSocket
  private readonly renderer: Renderer
  private tools = new Map<ToolId, Tool>()
  private toolId: ToolId = 'pen'
  private tool: Tool
  private mode: 'vector' | 'tiles' = 'vector'
  private raf = 0
  private lastFrame = 0
  private baseDirty = true
  private overlayDirty = true
  private seenRevision = -1
  private viewDirty = true
  private lastView = 0
  private lastZoomPush = 0
  private lastCursorSend = 0
  private cursorTimer: ReturnType<typeof setTimeout> | null = null
  private lastCursor: [number, number] | null = null
  private lastToolSend = 0
  private disposed = false
  private ownDeletes = new Set<string>()
  private localZ = 0
  private floats: Float[] = []
  private editor: { element: HTMLElement; x: number; y: number; size: number; align: 0 | 1 | 2 } | null = null
  private unsubscribe: (() => void) | null = null
  private resizeObserver: ResizeObserver | null = null
  private pointers = new Map<number, { sx: number; sy: number; type: string }>()
  private pinch: { distance: number; cx: number; cy: number } | null = null
  private panning: { sx: number; sy: number; samples: { t: number; sx: number; sy: number }[] } | null = null
  private toolActive = false
  private spaceDown = false
  private penSeenAt = 0
  /** Dernier appui (les événements « pointer » n'ont pas de compteur de clics : on le tient). */
  private lastDown = { time: 0, sx: 0, sy: 0, count: 0 }

  constructor(container: HTMLElement, base: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.container = container
    this.base = base
    this.overlay = overlay
    this.tiles = new TileCache(() => {
      this.baseDirty = true
    })
    this.renderer = new Renderer(base, overlay, this.camera, this.scene, this.tiles)
    this.socket = new CanvasSocket({ onStatus: (status) => this.onStatus(status), onMessage: (message) => this.onMessage(message) })
    this.tool = this.makeTool('pen')
    this.tools.set('pen', this.tool)
  }

  /* ---- Cycle de vie ---------------------------------------------------------------------- */

  start(): void {
    this.resize()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.overlay.addEventListener('pointerdown', this.onPointerDown)
    this.overlay.addEventListener('pointermove', this.onPointerMove)
    this.overlay.addEventListener('pointerup', this.onPointerUp)
    this.overlay.addEventListener('pointercancel', this.onPointerUp)
    this.overlay.addEventListener('wheel', this.onWheel, { passive: false })
    this.overlay.addEventListener('contextmenu', this.preventDefault)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('online', this.onOnline)
    this.unsubscribe = store.subscribe((state, previous) => {
      if (state.tool !== previous.tool) this.useTool(state.tool)
      if (state.tool !== previous.tool || state.ink !== previous.ink || state.width !== previous.width) this.sendTool()
      this.overlayDirty = true
    })
    this.useTool(store.getState().tool)
    this.camera.setCenter(0, 0)
    this.socket.connect()
    this.lastFrame = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver?.disconnect()
    this.overlay.removeEventListener('pointerdown', this.onPointerDown)
    this.overlay.removeEventListener('pointermove', this.onPointerMove)
    this.overlay.removeEventListener('pointerup', this.onPointerUp)
    this.overlay.removeEventListener('pointercancel', this.onPointerUp)
    this.overlay.removeEventListener('wheel', this.onWheel)
    this.overlay.removeEventListener('contextmenu', this.preventDefault)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('online', this.onOnline)
    this.unsubscribe?.()
    for (const tool of this.tools.values()) tool.dispose?.()
    this.closeEditor()
    if (this.cursorTimer) clearTimeout(this.cursorTimer)
    this.socket.dispose()
    this.tiles.dispose()
    store.getState().reset()
  }

  private preventDefault = (event: Event) => event.preventDefault()

  private resize(): void {
    const rect = this.container.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.camera.setSize(rect.width, rect.height)
    this.renderer.resize(rect.width, rect.height, dpr)
    this.baseDirty = true
    this.overlayDirty = true
    this.viewDirty = true
  }

  /* ---- Boucle ---------------------------------------------------------------------------- */

  private loop = (now: number) => {
    if (this.disposed) return
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    this.update(dt, now)
    this.raf = requestAnimationFrame(this.loop)
  }

  private update(dt: number, now: number): void {
    const state = store.getState()
    // Suivre un joueur : la caméra glisse vers son curseur.
    if (state.following !== null) {
      const peer = this.peers.get(state.following) ?? null
      const place = peer ? { x: peer.x, y: peer.y } : this.places.get(state.following)
      if (place) {
        const [cx, cy] = this.camera.center()
        const k = 1 - Math.exp(-dt * 4)
        this.camera.setCenter(cx + (place.x - cx) * k, cy + (place.y - cy) * k)
        this.baseDirty = true
        this.viewDirty = true
      }
    }
    if (this.camera.tick(dt, now)) {
      this.baseDirty = true
      this.viewDirty = true
    }
    this.updateMode()
    if (this.scene.revision !== this.seenRevision) {
      this.seenRevision = this.scene.revision
      this.baseDirty = true
    }
    if (this.viewDirty && now - this.lastView > 140) this.sendView(now)
    if (now - this.lastZoomPush > 150) {
      this.lastZoomPush = now
      if (Math.abs(state.zoom - this.camera.zoom) > 1e-6) store.setState({ zoom: this.camera.zoom })
    }
    this.scene.expireGhosts(now)
    if (this.editor) this.placeEditor()
    if (this.baseDirty) {
      this.baseDirty = false
      this.renderer.drawBase(this.env())
    }
    const animating = this.moveCursors(dt, now) || this.scene.ghosts.size > 0 || this.floats.length > 0 || this.toolActive || this.camera.moving
    if (animating || this.overlayDirty) {
      this.overlayDirty = false
      this.drawOverlay(now)
    }
  }

  private env(): RenderEnv {
    const me = store.getState().me
    return { userId: me?.userId ?? '', admin: me?.admin ?? false, mode: this.mode, maxTileLevel: this.limits?.tile.maxLevel ?? 11 }
  }

  /** Vecteur ou tuiles, avec hystérésis : pas de bascule nerveuse autour du seuil. */
  private updateMode(): void {
    const zoom = this.camera.zoom
    const next = this.mode === 'vector' ? (zoom < VECTOR_LEAVE ? 'tiles' : 'vector') : zoom >= VECTOR_ENTER ? 'vector' : 'tiles'
    if (next === this.mode) return
    this.mode = next
    store.setState({ mode: next })
    this.baseDirty = true
    this.viewDirty = true
  }

  private moveCursors(dt: number, now: number): boolean {
    let moving = false
    const k = 1 - Math.exp(-dt * 16)
    for (const cursor of this.peers.values()) {
      const dx = cursor.targetX - cursor.x
      const dy = cursor.targetY - cursor.y
      if (Math.abs(dx) + Math.abs(dy) > 0.01 / this.camera.zoom) {
        cursor.x += dx * k
        cursor.y += dy * k
        moving = true
      }
      if (cursor.bubble && cursor.bubble.until > now) moving = true
      if (cursor.reactions.length > 0) moving = true
      if (now - cursor.seen < 1000) moving = true
    }
    return moving
  }

  private drawOverlay(now: number): void {
    const state = store.getState()
    this.floats = this.floats.filter((float) => now - float.at < 1400)
    this.renderer.drawOverlay((api) => {
      api.world()
      // Aperçus des autres joueurs : leurs traits en cours.
      for (const ghost of this.scene.ghosts.values()) drawData(api.ctx, ghost.data, 0.85)
      this.tool.overlay?.(api as Overlay)
      api.screen()
      for (const float of this.floats) {
        const t = (now - float.at) / 1400
        const [sx, sy] = this.camera.toScreen(float.x, float.y)
        api.ctx.save()
        api.ctx.globalAlpha = 1 - t * t
        api.ctx.font = `${26 + t * 10}px sans-serif` // i18n-ignore : police CSS
        api.ctx.textAlign = 'center'
        api.ctx.textBaseline = 'middle'
        api.ctx.fillText(float.emoji, sx, sy - t * 60)
        api.ctx.restore()
      }
      const view = this.camera.bounds()
      const margin = 60 / this.camera.zoom
      for (const cursor of this.peers.values()) {
        if (!containsPoint(inflate(view, margin), cursor.x, cursor.y)) continue
        const [sx, sy] = this.camera.toScreen(cursor.x, cursor.y)
        drawCursor(api.ctx, cursor, sx, sy, now, state.me?.name ? '…' : '…')
        drawReactions(api.ctx, cursor, this.camera, now)
      }
    })
  }

  /* ---- Réseau ---------------------------------------------------------------------------- */

  private onStatus(status: SocketStatus): void {
    store.setState({ status })
    if (status === 'open') {
      // Nouvelle connexion : le serveur ne sait rien de nous, on repart d'une scène propre.
      this.scene.clear()
      this.peers.clear()
      this.places.clear()
      this.viewDirty = true
      this.baseDirty = true
    }
  }

  private sendView(now: number): void {
    if (!this.socket.open) return
    const box = this.camera.bounds()
    const level = tileLevelFor(this.camera.zoom, this.limits?.tile.maxLevel ?? 11)
    this.socket.send({ t: 'view', b: [Math.round(box.minX), Math.round(box.minY), Math.round(box.maxX), Math.round(box.maxY)], vec: this.mode === 'vector' ? 1 : 0, m: level })
    this.viewDirty = false
    this.lastView = now
  }

  private sendTool(): void {
    const now = performance.now()
    if (!this.socket.open || now - this.lastToolSend < 120) return
    const { tool, ink, width } = store.getState()
    this.lastToolSend = now
    this.socket.send({ t: 'tool', tool, ink, size: width })
  }

  private onMessage(message: { t: string; [field: string]: unknown }): void {
    const now = performance.now()
    switch (message.t) {
      case 'welcome':
        return this.onWelcome(message)
      case 'objs': {
        const list = message.o as WireObject[]
        for (const wire of list) this.scene.upsert(fromWire(wire), String(message.k))
        return
      }
      case 'drop': {
        for (const key of message.k as string[]) this.scene.dropCell(key)
        this.dropSelectionGone()
        return
      }
      case 'op': {
        this.onOp(message)
        return
      }
      case 'lk': {
        const object = this.scene.get(String(message.id))
        if (object) {
          object.likes = Number(message.n)
          this.scene.revision += 1
        }
        return
      }
      case 'cur': {
        for (const [conn, x, y] of message.p as number[][]) this.moveCursor(conn!, x!, y!, now)
        return
      }
      case 'where': {
        for (const [conn, x, y] of message.p as number[][]) {
          this.places.set(conn!, { x: x!, y: y! })
          const cursor = this.peers.get(conn!)
          if (cursor && now - cursor.seen > 4000) {
            cursor.targetX = x!
            cursor.targetY = y!
          }
        }
        return
      }
      case 'peer': {
        if (message.a) this.addPeer(message.a as Record<string, unknown>)
        else this.removePeer(Number(message.d))
        return
      }
      case 'pt': {
        const conn = Number(message.c)
        const cursor = this.peers.get(conn)
        if (cursor) {
          cursor.tool = message.tl as ToolId
          cursor.ink = String(message.ic)
          cursor.size = Number(message.sz)
        }
        const info = store.getState().peers[conn]
        if (info) store.setState({ peers: { ...store.getState().peers, [conn]: { ...info, tool: message.tl as ToolId, ink: String(message.ic), size: Number(message.sz) } } })
        this.overlayDirty = true
        return
      }
      case 'chat': {
        const cursor = this.peers.get(Number(message.c))
        if (cursor) cursor.bubble = { text: String(message.text), until: now + 5000 }
        return
      }
      case 'react': {
        const cursor = this.peers.get(Number(message.c))
        if (cursor) cursor.reactions.push({ emoji: String(message.e), x: Number(message.x), y: Number(message.y), at: now })
        return
      }
      case 'lp': {
        this.onLivePoints(message, now)
        return
      }
      case 'lo': {
        this.scene.setGhost({ conn: Number(message.c), id: String(message.id), data: message.o as Data, at: now })
        return
      }
      case 'le': {
        this.scene.endGhost(Number(message.c), String(message.id))
        return
      }
      case 'tv': {
        for (const [level, x, y, version] of message.k as number[][]) this.tiles.bump(level!, x!, y!, version!)
        return
      }
      case 'season': {
        this.scene.clear()
        this.tiles.clear()
        this.history.clear()
        this.syncHistory()
        store.setState({ season: String(message.key), selection: [] })
        store.getState().notify('season_changed', 'info')
        this.viewDirty = true
        this.baseDirty = true
        return
      }
      case 'me': {
        const me = store.getState().me
        if (me) store.setState({ me: { ...me, draw: Boolean(message.draw), reason: (message.reason as 'young' | 'banned' | null) ?? null, waitMs: Number(message.wait ?? 0) }, brushes: (message.brushes as string[]) ?? store.getState().brushes })
        return
      }
      default:
        return
    }
  }

  private onWelcome(message: { [field: string]: unknown }): void {
    const me = message.me as { c: number; u: string; n: string | null; k: string; admin: boolean; draw: boolean; reason: 'young' | 'banned' | null; wait: number }
    this.limits = message.limits as Limits
    const peers: Record<number, PeerInfo> = {}
    for (const raw of message.peers as Record<string, unknown>[]) this.addPeer(raw, peers)
    store.setState({
      me: { conn: me.c, userId: me.u, name: me.n, color: me.k, admin: me.admin, draw: me.draw, reason: me.reason, waitMs: me.wait },
      limits: this.limits,
      season: String(message.season),
      brushes: message.brushes as string[],
      peers: { ...peers },
    })
    this.sendTool()
    this.viewDirty = true
  }

  private addPeer(raw: Record<string, unknown>, into?: Record<number, PeerInfo>): void {
    const conn = Number(raw.c)
    const info: PeerInfo = { conn, userId: String(raw.u), name: (raw.n as string | null) ?? null, avatar: (raw.av as string | null) ?? null, color: String(raw.k), tool: raw.tl as ToolId, ink: String(raw.ic), size: Number(raw.sz) }
    if (into) into[conn] = info
    else store.setState({ peers: { ...store.getState().peers, [conn]: info } })
    const x = typeof raw.x === 'number' ? raw.x : null
    const y = typeof raw.y === 'number' ? raw.y : null
    if (x !== null && y !== null) this.places.set(conn, { x, y })
    this.peers.set(conn, { conn, name: info.name ?? '', color: info.color, tool: info.tool, ink: info.ink, size: info.size, x: x ?? 0, y: y ?? 0, targetX: x ?? 0, targetY: y ?? 0, seen: x === null ? 0 : performance.now() - 5000, bubble: null, reactions: [], avatar: null })
  }

  private removePeer(conn: number): void {
    this.peers.delete(conn)
    this.places.delete(conn)
    this.scene.endGhostsOf(conn)
    const peers = { ...store.getState().peers }
    delete peers[conn]
    store.setState({ peers, ...(store.getState().following === conn ? { following: null } : {}) })
    this.overlayDirty = true
  }

  private moveCursor(conn: number, x: number, y: number, now: number): void {
    const cursor = this.peers.get(conn)
    if (!cursor) return
    // Premier mouvement : il apparaît à sa place, sans traverser l'écran.
    if (cursor.seen === 0 || now - cursor.seen > 8000) {
      cursor.x = x
      cursor.y = y
    }
    cursor.targetX = x
    cursor.targetY = y
    cursor.seen = now
    this.places.set(conn, { x, y })
  }

  private onLivePoints(message: { [field: string]: unknown }, now: number): void {
    const conn = Number(message.c)
    const id = String(message.id)
    const style = message.st as (Common & { b?: string }) | undefined
    const key = `${conn}:${id}`
    const known = this.scene.ghosts.get(key)
    const previous = known?.data.t === 's' ? known.data : null
    const base: StrokeData | null = previous ?? (style ? { t: 's', c: style.c, sw: style.sw, ...(style.a ? { a: style.a } : {}), ...(style.b ? { b: style.b } : {}), p: [] } : null)
    if (!base) return
    this.scene.setGhost({ conn, id, data: { ...base, p: base.p.concat(message.p as number[]) }, at: now })
  }

  private onOp(message: { [field: string]: unknown }): void {
    const limits = this.limits
    if (!limits) return
    const kind = String(message.k)
    if (kind === 'd') {
      const id = String(message.id)
      this.scene.remove(id)
      // Effacé par quelqu'un d'autre (administrateur, propriétaire du cadre) : on ne peut plus l'annuler.
      if (!this.ownDeletes.delete(id)) this.history.forget(id)
      this.dropSelectionGone()
      this.syncHistory()
      return
    }
    const wire = message as unknown as WireObject
    const object = fromWire(wire)
    this.scene.upsert(object, cellKey(limits, object.box))
    for (const [key, ghost] of this.scene.ghosts) if (ghost.id === object.id) this.scene.ghosts.delete(key)
    this.localZ = Math.max(this.localZ, object.z)
  }

  private dropSelectionGone(): void {
    const { selection } = store.getState()
    const alive = selection.filter((id) => this.scene.get(id))
    if (alive.length !== selection.length) store.setState({ selection: alive })
  }

  /* ---- Opérations ------------------------------------------------------------------------ */

  private applyLocal(op: Op): void {
    const limits = this.limits
    if (!limits) return
    const me = store.getState().me
    switch (op.k) {
      case 'c': {
        const data = op.o as Data
        const box = boundsOf(data)
        this.scene.upsert({ id: op.id, owner: me?.userId ?? '', data, z: (this.localZ += 1), v: 0, likes: 0, hidden: false, box }, cellKey(limits, box))
        return
      }
      case 'u': {
        const known = this.scene.get(op.id)
        if (!known) return
        const data = op.o as Data
        this.scene.upsert({ ...known, data, box: boundsOf(data) }, cellKey(limits, boundsOf(data)))
        return
      }
      case 'd':
        this.ownDeletes.add(op.id)
        this.scene.remove(op.id)
        this.dropSelectionGone()
        return
      case 'z': {
        const known = this.scene.get(op.id)
        if (!known) return
        let z = known.z
        if (op.to === 'front') z = this.localZ += 1
        else {
          let low = 0
          for (const object of this.scene.all()) low = Math.min(low, object.z)
          z = low - 1
        }
        this.scene.upsert({ ...known, z })
        return
      }
    }
  }

  private async send(ops: Op[], entry: Entry | null): Promise<void> {
    for (let at = 0; at < ops.length; at += 100) {
      const ack = await this.socket.request({ t: 'ops', ops: ops.slice(at, at + 100) })
      if (!ack.ok) {
        if (entry) this.history.discard(entry)
        this.syncHistory()
        store.getState().notify(ack.e ?? 'unknown')
        // Ce que le serveur refuse n'a pas existé : l'aperçu local d'une création ratée disparaît.
        if (ack.e === 'offline' || ack.e === 'timeout') for (const op of ops) if (op.k === 'c') this.scene.remove(op.id)
        return
      }
    }
  }

  /** Un geste de l'utilisateur : appliqué ici, envoyé au serveur, noté dans l'historique. */
  commit(entry: Entry): void {
    this.history.push(entry)
    for (const op of entry.redo) this.applyLocal(op)
    this.syncHistory()
    void this.send(entry.redo, entry)
    this.requestRedraw()
  }

  undo(): void {
    const entry = this.history.undo()
    if (!entry) return
    for (const op of entry.undo) this.applyLocal(op)
    this.syncHistory()
    void this.send(entry.undo, null)
  }

  redo(): void {
    const entry = this.history.redo()
    if (!entry) return
    for (const op of entry.redo) this.applyLocal(op)
    this.syncHistory()
    void this.send(entry.redo, null)
  }

  private syncHistory(): void {
    const { canUndo, canRedo } = store.getState()
    if (canUndo !== this.history.canUndo || canRedo !== this.history.canRedo) store.setState({ canUndo: this.history.canUndo, canRedo: this.history.canRedo })
  }

  private requestRedraw(): void {
    this.overlayDirty = true
  }

  /* ---- Outils ----------------------------------------------------------------------------- */

  private makeTool(id: ToolId): Tool {
    const ctx = this.toolContext()
    switch (id) {
      case 'pen':
        return new PenTool(ctx)
      case 'select':
        return new SelectTool(ctx)
      case 'eraser':
        return new EraserTool(ctx)
      case 'rect':
      case 'ellipse':
      case 'line':
      case 'arrow':
      case 'frame':
        return new ShapeTool(ctx, id)
      case 'polygon':
        return new PolygonTool(ctx)
      case 'bezier':
        return new BezierTool(ctx)
      case 'text':
        return new TextTool(ctx)
      case 'pick':
        return new PickTool(ctx)
      case 'heart':
        return new HeartTool(ctx)
      case 'hand':
        return new HandTool()
    }
  }

  private useTool(id: ToolId): void {
    this.tool.cancel()
    this.toolActive = false
    this.toolId = id
    let next = this.tools.get(id)
    if (!next) {
      next = this.makeTool(id)
      this.tools.set(id, next)
    }
    this.tool = next
    this.overlay.style.cursor = this.spaceDown ? 'grab' : next.cursor
    this.overlayDirty = true
  }

  private toolContext(): ToolContext {
    const engine = this
    return {
      camera: this.camera,
      scene: this.scene,
      get limits() {
        return engine.limits ?? { cell: 4096, world: 2_000_000, extent: 4096, strokePoints: 3000, inkMax: 25_000, frames: { max: 3, collaborators: 8 }, tile: { base: 1024, maxLevel: 11 }, reactions: [], chat: 80, brushes: [] }
      },
      container: this.container,
      style: () => store.getState(),
      state: () => store.getState(),
      meId: () => store.getState().me?.userId ?? '',
      isAdmin: () => store.getState().me?.admin ?? false,
      canDraw: () => engine.canDraw(),
      newId: hex,
      canEdit: (object) => object.owner === store.getState().me?.userId || (store.getState().me?.admin ?? false) || engine.ownsFrameOver(object),
      lockedAt: (x, y, box) => engine.lockedAt(x, y, box),
      tolerance: () => 7 / this.camera.zoom,
      commit: (entry) => this.commit(entry),
      previewObject: (object) => {
        this.scene.upsert(object)
      },
      liveStroke: (id, points, style) => {
        this.socket.send({ t: 'lp', id, st: style, p: points })
      },
      liveObject: (id, data) => {
        this.socket.send({ t: 'lo', id, o: data })
      },
      liveEnd: (id) => {
        this.socket.send({ t: 'le', id })
      },
      redraw: () => this.requestRedraw(),
      notify: (code) => store.getState().notify(code),
      select: (ids) => store.setState({ selection: ids }),
      setDrawing: (drawing) => store.setState({ drawing }),
      setTool: (tool) => store.getState().setTool(tool),
      setStyle: (patch) => store.getState().setStyle(patch),
      pickColor: (sx, sy) => this.renderer.pixelAt(sx, sy),
      editText: (options) => this.openEditor(options),
      like: (id, x, y) => void this.like(id, x, y),
      panBy: (dx, dy) => this.camera.panBy(dx, dy),
    }
  }

  private canDraw(): boolean {
    const state = store.getState()
    if (state.status !== 'open') {
      state.notify('offline')
      return false
    }
    if (!state.me?.draw) return false
    return true
  }

  /** Un cadre dont je suis le propriétaire recouvre cet objet : je peux l'effacer. */
  private ownsFrameOver(object: CanvasObject): boolean {
    if (object.data.t === 'f') return false
    const me = store.getState().me?.userId
    return this.scene.find(object.box).some((frame) => frame.data.t === 'f' && frame.owner === me && overlaps(object.box, frameArea(frame.data)))
  }

  private lockedAt(x: number, y: number, box?: Box): boolean {
    const me = store.getState().me
    if (!me || me.admin) return false
    const area: Box = box ?? { minX: x, minY: y, maxX: x, maxY: y }
    for (const frame of this.scene.find(area)) {
      if (frame.data.t !== 'f' || frame.hidden) continue
      if (frame.owner === me.userId || frame.data.co.includes(me.userId)) continue
      if (overlaps(area, frameArea(frame.data))) return true
    }
    return false
  }

  private async like(id: string, x: number, y: number): Promise<void> {
    try {
      const result = await canvasApi.like(id)
      const object = this.scene.get(id)
      if (object) {
        object.likes = result.likes
        this.scene.revision += 1
      }
      this.floats.push({ emoji: '❤️', x, y, at: performance.now() })
      this.overlayDirty = true
      store.getState().notify(result.rewarded ? 'liked_reward' : 'liked', 'info')
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'unknown'
      store.getState().notify(code)
    }
  }

  /* ---- Saisie de texte ------------------------------------------------------------------- */

  private openEditor(options: TextEditOptions): void {
    this.closeEditor()
    const element = document.createElement(options.multiline ? 'textarea' : 'input') as HTMLTextAreaElement | HTMLInputElement
    element.value = options.value
    element.maxLength = options.multiline ? 200 : 40
    Object.assign(element.style, {
      position: 'absolute',
      zIndex: '30',
      margin: '0',
      padding: '2px 4px',
      border: '1.5px dashed #2b7fff',
      borderRadius: '4px',
      outline: 'none',
      background: 'rgba(255,255,255,0.85)',
      color: options.color,
      fontFamily: 'Inter, system-ui, sans-serif', // i18n-ignore : police CSS
      fontWeight: options.bold ? '700' : '400',
      lineHeight: options.multiline ? '1.25' : '1.1',
      resize: 'none',
      overflow: 'hidden',
      whiteSpace: 'pre',
      minWidth: '60px',
      transformOrigin: 'top left',
    })
    this.container.appendChild(element)
    this.editor = { element, x: options.x, y: options.y, size: options.size, align: options.align }
    let finished = false
    const finish = (value: string | null) => {
      if (finished) return
      finished = true
      element.remove()
      if (this.editor?.element === element) this.editor = null
      options.done(value)
      this.overlay.focus()
    }
    const fit = () => {
      if (element instanceof HTMLTextAreaElement) {
        element.rows = Math.max(1, element.value.split('\n').length)
        element.style.height = `${element.scrollHeight}px`
      }
      element.style.width = `${Math.max(80, element.value.length * options.size * this.camera.zoom * 0.62 + 20)}px`
    }
    const field: HTMLElement = element
    field.addEventListener('input', fit)
    field.addEventListener('keydown', (event: KeyboardEvent) => {
      event.stopPropagation()
      if (event.key === 'Escape') finish(null)
      else if (event.key === 'Enter' && (!options.multiline || event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        finish(element.value)
      }
    })
    field.addEventListener('blur', () => finish(element.value))
    this.placeEditor()
    fit()
    requestAnimationFrame(() => element.focus())
  }

  private placeEditor(): void {
    const editor = this.editor
    if (!editor) return
    const [sx, sy] = this.camera.toScreen(editor.x, editor.y)
    const size = Math.max(10, editor.size * this.camera.zoom)
    const element = editor.element as HTMLElement
    element.style.left = `${sx - 4}px`
    element.style.top = `${sy - 3}px`
    element.style.fontSize = `${size}px`
    element.style.textAlign = editor.align === 1 ? 'center' : editor.align === 2 ? 'right' : 'left'
  }

  private closeEditor(): void {
    if (!this.editor) return
    this.editor.element.remove()
    this.editor = null
  }

  /* ---- Gestes ----------------------------------------------------------------------------- */

  private info(event: PointerEvent): PointerInfo {
    const rect = this.overlay.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    const [x, y] = this.camera.toWorld(sx, sy)
    const coalesced = (event.getCoalescedEvents?.() ?? []).map((sample) => {
      const [wx, wy] = this.camera.toWorld(sample.clientX - rect.left, sample.clientY - rect.top)
      return { x: wx, y: wy, pressure: sample.pressure }
    })
    return { sx, sy, x, y, pressure: event.pressure, pointerType: event.pointerType, shift: event.shiftKey, alt: event.altKey, mod: event.ctrlKey || event.metaKey, button: event.button, detail: this.lastDown.count || 1, time: event.timeStamp, coalesced }
  }

  private onPointerDown = (event: PointerEvent) => {
    this.overlay.setPointerCapture(event.pointerId)
    if (event.pointerType === 'pen') this.penSeenAt = performance.now()
    const rect = this.overlay.getBoundingClientRect()
    this.pointers.set(event.pointerId, { sx: event.clientX - rect.left, sy: event.clientY - rect.top, type: event.pointerType })
    if (store.getState().following !== null) store.setState({ following: null })
    this.camera.stop()
    if (this.pointers.size >= 2) {
      this.tool.cancel()
      this.toolActive = false
      this.panning = null
      this.startPinch()
      return
    }
    const penMode = event.pointerType === 'touch' && performance.now() - this.penSeenAt < 60_000
    const handMode = this.toolId === 'hand' || this.spaceDown || event.button === 1 || penMode
    if (handMode) {
      this.panning = { sx: event.clientX - rect.left, sy: event.clientY - rect.top, samples: [] }
      this.overlay.style.cursor = 'grabbing'
      return
    }
    if (event.button !== 0 && event.pointerType === 'mouse') return
    // Double-clic : deux appuis rapprochés dans le temps et dans l'espace.
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    const again = event.timeStamp - this.lastDown.time < 380 && Math.hypot(sx - this.lastDown.sx, sy - this.lastDown.sy) < 10
    this.lastDown = { time: event.timeStamp, sx, sy, count: again ? this.lastDown.count + 1 : 1 }
    this.toolActive = true
    this.tool.down(this.info(event))
  }

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.overlay.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    const known = this.pointers.get(event.pointerId)
    if (known) {
      known.sx = sx
      known.sy = sy
    }
    if (this.pinch && this.pointers.size >= 2) return this.movePinch()
    if (this.panning) {
      this.camera.panBy(sx - this.panning.sx, sy - this.panning.sy)
      this.panning.sx = sx
      this.panning.sy = sy
      this.panning.samples.push({ t: event.timeStamp, sx, sy })
      if (this.panning.samples.length > 6) this.panning.samples.shift()
      this.baseDirty = true
      this.viewDirty = true
      return
    }
    const info = this.info(event)
    this.sendCursor(info.x, info.y)
    if (this.toolActive) this.tool.move(info)
    else this.tool.hover?.(info)
  }

  private onPointerUp = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId)
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null
      return
    }
    if (this.panning) {
      const samples = this.panning.samples
      const first = samples[0]
      const last = samples[samples.length - 1]
      if (first && last && last.t - first.t > 10 && last.t - first.t < 200) {
        this.camera.fling(((last.sx - first.sx) / (last.t - first.t)) * 1000, ((last.sy - first.sy) / (last.t - first.t)) * 1000)
      }
      this.panning = null
      this.overlay.style.cursor = this.spaceDown ? 'grab' : this.tool.cursor
      return
    }
    if (!this.toolActive) return
    this.toolActive = false
    this.tool.up(this.info(event))
  }

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()]
    if (!a || !b) return
    this.pinch = { distance: Math.hypot(a.sx - b.sx, a.sy - b.sy), cx: (a.sx + b.sx) / 2, cy: (a.sy + b.sy) / 2 }
  }

  private movePinch(): void {
    const [a, b] = [...this.pointers.values()]
    if (!a || !b || !this.pinch) return
    const distance = Math.hypot(a.sx - b.sx, a.sy - b.sy)
    const cx = (a.sx + b.sx) / 2
    const cy = (a.sy + b.sy) / 2
    this.camera.panBy(cx - this.pinch.cx, cy - this.pinch.cy)
    if (this.pinch.distance > 4 && distance > 4) this.camera.zoomAt(cx, cy, distance / this.pinch.distance)
    this.pinch = { distance, cx, cy }
    this.baseDirty = true
    this.viewDirty = true
  }

  private onWheel = (event: WheelEvent) => {
    event.preventDefault()
    if (store.getState().following !== null) store.setState({ following: null })
    const rect = this.overlay.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    const trackpad = event.deltaMode === 0 && (event.deltaX !== 0 || (Math.abs(event.deltaY) < 40 && !Number.isInteger(event.deltaY)))
    if (event.ctrlKey || event.metaKey) {
      // Pincement du pavé tactile (ctrl + molette synthétique) ou ctrl + molette.
      this.camera.zoomAt(sx, sy, Math.exp(-event.deltaY * 0.01))
    } else if (trackpad) {
      this.camera.panBy(-event.deltaX, -event.deltaY)
    } else {
      this.camera.zoomSmooth(sx, sy, Math.exp(-Math.sign(event.deltaY) * 0.22))
    }
    this.baseDirty = true
    this.viewDirty = true
  }

  /** Le curseur part au plus toutes les ~33 ms (le dernier mouvement part toujours). */
  private sendCursor(x: number, y: number): void {
    this.lastCursor = [x, y]
    const now = performance.now()
    if (now - this.lastCursorSend >= 33) {
      this.lastCursorSend = now
      this.socket.send({ t: 'cur', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })
      return
    }
    if (!this.cursorTimer) {
      this.cursorTimer = setTimeout(() => {
        this.cursorTimer = null
        if (this.lastCursor) this.sendCursor(this.lastCursor[0], this.lastCursor[1])
      }, 40)
    }
  }

  /* ---- Clavier ---------------------------------------------------------------------------- */

  private typing(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null
    return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (this.typing(event)) return
    const mod = event.ctrlKey || event.metaKey
    if (event.key === ' ' && !event.repeat) {
      event.preventDefault()
      this.spaceDown = true
      this.overlay.style.cursor = 'grab'
      return
    }
    if (this.tool.key?.(event)) {
      event.preventDefault()
      return
    }
    const ctx = this.toolContext()
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) this.redo()
      else this.undo()
      return
    }
    if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      this.redo()
      return
    }
    // Actions sur la sélection, quel que soit l'outil.
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (deleteSelected(ctx)) event.preventDefault()
      return
    }
    if (mod && event.key.toLowerCase() === 'd') {
      event.preventDefault()
      duplicateSelected(ctx)
      return
    }
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selectAllEditable(ctx)
      return
    }
    if (event.key === '[' || event.key === ']') {
      restackSelected(ctx, event.key === ']' ? 'front' : 'back')
      return
    }
    if (event.key.startsWith('Arrow') && store.getState().selection.length > 0) {
      const step = (event.shiftKey ? 10 : 1) / this.camera.zoom
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      if (nudgeSelected(ctx, dx, dy)) event.preventDefault()
      return
    }
    if (event.key === 'Escape') {
      store.setState({ selection: [] })
      return
    }
    if (mod) return
    if (event.key === '+' || event.key === '=') return this.zoomBy(1.4)
    if (event.key === '-') return this.zoomBy(1 / 1.4)
    if (event.key === '0') return this.resetZoom()
    const tool = TOOL_KEYS[event.key.toLowerCase()]
    if (tool) store.getState().setTool(tool)
  }

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.key === ' ') {
      this.spaceDown = false
      this.overlay.style.cursor = this.tool.cursor
    }
  }

  private onBlur = () => {
    this.spaceDown = false
    this.tool.cancel()
    this.toolActive = false
  }

  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.socket.reconnectNow()
  }

  private onOnline = () => this.socket.reconnectNow()

  /* ---- Appels de l'interface ----------------------------------------------------------------- */

  zoomBy(factor: number): void {
    this.camera.zoomSmooth(this.camera.width / 2, this.camera.height / 2, factor)
  }

  resetZoom(): void {
    const [cx, cy] = this.camera.center()
    this.camera.flyTo(cx, cy, 1, 400)
  }

  flyTo(x: number, y: number, zoom?: number): void {
    store.setState({ following: null })
    this.camera.flyTo(x, y, zoom ?? Math.max(this.camera.zoom, 0.6))
  }

  /** Cadre toutes les choses connues (ou une zone). */
  fit(box?: Box): void {
    const target = box ?? (this.scene.size > 0 ? unionBox([...this.scene.all()].map((object) => object.box)) : { minX: -600, minY: -400, maxX: 600, maxY: 400 })
    this.camera.fit(target)
  }

  follow(conn: number | null): void {
    store.setState({ following: conn })
  }

  goToPeer(conn: number): void {
    const place = this.peers.get(conn) ?? this.places.get(conn)
    if (place) this.flyTo(place.x, place.y)
  }

  sendChat(text: string): void {
    this.socket.send({ t: 'chat', text })
    const me = store.getState().me
    // Sa propre bulle s'affiche chez soi aussi (le serveur ne la renvoie pas à l'envoyeur).
    if (me && this.lastCursor) this.floats.push({ emoji: '💬', x: this.lastCursor[0], y: this.lastCursor[1], at: performance.now() })
  }

  react(emoji: string): void {
    this.socket.send({ t: 'react', e: emoji })
    if (this.lastCursor) this.floats.push({ emoji, x: this.lastCursor[0], y: this.lastCursor[1], at: performance.now() })
  }

  restack(to: 'front' | 'back'): void {
    restackSelected(this.toolContext(), to)
  }

  deleteSelection(): void {
    deleteSelected(this.toolContext())
  }

  duplicateSelection(): void {
    duplicateSelected(this.toolContext())
  }

  /**
   * Change le style de la sélection (couleur, épaisseur…) : un geste annulable. Chaque type
   * d'objet ne prend que les champs qui le concernent ; une valeur « neutre » retire le champ.
   */
  restyleSelection(patch: Record<string, unknown>): void {
    const allowed: Record<string, string[]> = {
      s: ['c', 'a', 'sw', 'b'],
      r: ['c', 'f', 'a', 'sw', 'd', 'k'],
      e: ['c', 'f', 'a', 'sw', 'd'],
      g: ['c', 'f', 'a', 'sw', 'd'],
      b: ['c', 'f', 'a', 'sw', 'd'],
      l: ['c', 'a', 'sw', 'd'],
      a: ['c', 'a', 'sw', 'd'],
      x: ['c', 'a', 's', 'bd', 'al'],
      f: ['c', 'f'],
    }
    const neutral: Record<string, unknown> = { a: 1, d: 0, k: 0, bd: 0, al: 0, b: 'pen' }
    const context = this.toolContext()
    const undo: Op[] = []
    const redo: Op[] = []
    for (const id of store.getState().selection) {
      const object = this.scene.get(id)
      if (!object || !context.canEdit(object)) continue
      const next: Record<string, unknown> = { ...object.data }
      for (const key of allowed[object.data.t] ?? []) {
        if (!(key in patch)) continue
        if (patch[key] === undefined || patch[key] === neutral[key]) delete next[key]
        else next[key] = patch[key]
      }
      // Un rectangle de 10 de large ne peut pas avoir un coin de 40 : le rayon suit.
      if (object.data.t === 'r' && typeof next.k === 'number') next.k = Math.min(next.k, Math.min(object.data.w, object.data.h) / 2)
      undo.push({ k: 'u', id, o: object.data })
      redo.push({ k: 'u', id, o: next })
    }
    if (redo.length > 0) this.commit({ undo, redo })
  }

  /** Un cadre : change son titre ou ses invités (le propriétaire seulement : le serveur vérifie). */
  updateFrame(id: string, patch: { tt?: string; co?: string[]; f?: string }): void {
    const object = this.scene.get(id)
    if (!object || object.data.t !== 'f') return
    const next = { ...object.data, ...patch }
    this.commit({ undo: [{ k: 'u', id, o: object.data }], redo: [{ k: 'u', id, o: next }] })
  }

  /** L'image de ce qui est affiché (PNG). */
  exportPng(): Promise<Blob | null> {
    return new Promise((resolve) => this.base.toBlob((blob) => resolve(blob), 'image/png'))
  }

  /** Pour la mini-carte : la vue, les curseurs. */
  viewBox(): Box {
    return this.camera.bounds()
  }

  get online(): boolean {
    return this.socket.open
  }
}

export { MAX_ZOOM, MIN_ZOOM }
