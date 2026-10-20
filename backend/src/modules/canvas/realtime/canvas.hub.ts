import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { cookieOf, originAllowed, refuse } from '../../../core/security/socketAuth.js'
import { authenticate } from '../../../core/security/sessionGuard.js'
import { SESSION_COOKIE } from '../../../core/security/session.js'
import { accessOf, type CanvasAccess } from '../canvas.access.js'
import {
  BRUSHES,
  BRUSH_IDS,
  CHAT_INTERVAL_MS,
  CURSOR_BUCKET,
  CURSOR_TICK_MS,
  FRAME_COLLABORATORS,
  LIVE_BUCKET,
  MAX_CHAT,
  MAX_CONNECTIONS,
  MAX_CONNECTIONS_PER_USER,
  MAX_CURSORS_PER_FRAME,
  MAX_MESSAGE_BYTES,
  MAX_STRIKES,
  MAX_STROKE_POINTS,
  MAX_VIEW_SPAN,
  OPS_BUCKET,
  REACT_INTERVAL_MS,
  VIEW_PADDING,
  WHERE_TICK_MS,
  WORLD_LIMIT,
  CELL,
  FRAMES_PER_USER,
  MAX_EXTENT,
  MAX_OBJECTS_PER_USER,
} from '../canvas.constants.js'
import { CanvasFault, OBJECT_ID, cellKey, normalizeObject, overlaps, type Box } from '../canvas.schema.js'
import { onTileChange, TILE_BASE, TILE_MAX_LEVEL } from './canvas.tiles.js'
import { world, type Actor, type WObject, type WorldEvent } from './canvas.world.js'

/*
 * Temps réel de la toile : un WebSocket par onglet (`/api/canvas/ws`, session par cookie).
 *
 *   serveur → client   welcome, peer (arrivée/départ), cur (curseurs), where, pt (outil),
 *                      objs (objets d'une case), drop, op (création/modif/suppression), lk,
 *                      lp / lo / le (traits et formes en cours d'un autre joueur), chat, react,
 *                      tv (tuile modifiée), season, me, ack, err
 *   client → serveur   view, cur, tool, lp / lo / le, op / ops, chat, react, ping
 *
 * Le curseur part à ~30 Hz du client, le serveur regroupe et renvoie ~15 fois par seconde
 * seulement les curseurs qui ont bougé, et seulement à ceux qui les voient. Un client reçoit les
 * objets des cases qu'il regarde ; très dézoomé (`vec: 0`), il passe par les tuiles raster.
 * Tout ce qui s'écrit passe par `world` : le serveur arbitre, la file de chaque joueur garde
 * l'ordre de ses opérations.
 */

type Json = Record<string, unknown>

const CURSOR_PALETTE = ['#ff4d6d', '#ff8a3d', '#ffc233', '#7bd94a', '#2fd1a0', '#2bc3ff', '#5b8cff', '#9a6bff', '#d65cff', '#ff5cb4', '#00b894', '#e17055'] as const
export const REACTIONS = ['❤️', '😂', '😮', '👏', '🔥', '✨'] as const

const colorOf = (userId: string) => {
  let hash = 7
  for (let index = 0; index < userId.length; index += 1) hash = (hash * 31 + userId.charCodeAt(index)) | 0
  return CURSOR_PALETTE[Math.abs(hash) % CURSOR_PALETTE.length]!
}

class Bucket {
  private tokens: number
  private at = Date.now()
  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
  ) {
    this.tokens = capacity
  }
  take(cost = 1, now = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.at) / 1000) * this.perSecond)
    this.at = now
    if (this.tokens < cost) return false
    this.tokens -= cost
    return true
  }
}

interface Live {
  box: Box
  points: number
  at: number
}

interface Peer {
  conn: number
  ws: WebSocket
  userId: string
  access: CanvasAccess
  actor: Actor
  name: string | null
  color: string
  x: number
  y: number
  hasCursor: boolean
  moved: boolean
  tool: string
  ink: string
  size: number
  /** Zone regardée (avec marge), mode vectoriel ou tuiles, niveau de tuile affiché. */
  view: Box | null
  vec: boolean
  level: number
  /** Cases dont le client a l'état (le serveur lui envoie leurs changements). */
  cells: Set<string>
  wanted: Set<string>
  live: Map<string, Live>
  queue: Promise<void>
  ops: Bucket
  liveBucket: Bucket
  cursorBucket: Bucket
  viewBucket: Bucket
  /** Dernière vue reçue pendant que le seau était vide : appliquée dès qu'il se remplit (jamais perdue). */
  viewLater: Json | null
  viewTimer: ReturnType<typeof setTimeout> | null
  lastChat: number
  lastReact: number
  strikes: number
  alive: boolean
}

const peers = new Map<number, Peer>()
let nextConn = 1
let cursorTimer: ReturnType<typeof setInterval> | null = null
let whereTimer: ReturnType<typeof setInterval> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let sweepTimer: ReturnType<typeof setInterval> | null = null

const send = (peer: Peer, message: Json) => {
  if (peer.ws.readyState === 1) peer.ws.send(JSON.stringify(message))
}

const inside = (view: Box, x: number, y: number) => x >= view.minX && x <= view.maxX && y >= view.minY && y <= view.maxY

const round1 = (value: number) => Math.round(value * 10) / 10

const peerInfo = (peer: Peer): Json => ({ c: peer.conn, u: peer.userId, n: peer.name, av: peer.access.avatar, k: peer.color, tl: peer.tool, ic: peer.ink, sz: peer.size, x: peer.hasCursor ? round1(peer.x) : null, y: peer.hasCursor ? round1(peer.y) : null })

/** Un objet tel que les clients le reçoivent. */
export function wire(object: WObject, admin = false): Json {
  return { id: object.id, o: object.owner, d: object.data, z: object.z, v: object.version, l: object.likes, ...(object.hidden && admin ? { h: 1 } : {}) }
}

/* ---- Diffusion --------------------------------------------------------------------------- */

function broadcast(message: Json, except?: Peer): void {
  const text = JSON.stringify(message)
  for (const peer of peers.values()) if (peer !== except && peer.ws.readyState === 1) peer.ws.send(text)
}

/** Aux joueurs dont la zone regardée touche `box`. */
function broadcastNear(box: Box, message: Json, except?: Peer): void {
  const text = JSON.stringify(message)
  for (const peer of peers.values()) {
    if (peer === except || peer.ws.readyState !== 1 || !peer.view || !overlaps(peer.view, box)) continue
    peer.ws.send(text)
  }
}

function onWorldEvent(event: WorldEvent): void {
  switch (event.type) {
    case 'upsert': {
      const object = event.obj
      const key = cellKey(object.cx, object.cy)
      const kind = event.created ? 'c' : 'u'
      for (const peer of peers.values()) {
        if (!(peer.cells.has(key) || (event.prevKey !== null && peer.cells.has(event.prevKey)))) continue
        if (object.hidden && !peer.access.admin) continue
        send(peer, { t: 'op', k: kind, ...wire(object, peer.access.admin) })
      }
      return
    }
    case 'remove': {
      const key = cellKey(event.obj.cx, event.obj.cy)
      for (const peer of peers.values()) if (peer.cells.has(key)) send(peer, { t: 'op', k: 'd', id: event.obj.id })
      return
    }
    case 'hide': {
      const key = cellKey(event.obj.cx, event.obj.cy)
      for (const peer of peers.values()) {
        if (!peer.cells.has(key)) continue
        if (peer.access.admin) send(peer, { t: 'op', k: 'u', ...wire(event.obj, true) })
        else send(peer, { t: 'op', k: 'd', id: event.obj.id })
      }
      return
    }
    case 'unhide': {
      const key = cellKey(event.obj.cx, event.obj.cy)
      for (const peer of peers.values()) if (peer.cells.has(key)) send(peer, { t: 'op', k: 'c', ...wire(event.obj, peer.access.admin) })
      return
    }
    case 'likes': {
      const key = cellKey(event.obj.cx, event.obj.cy)
      for (const peer of peers.values()) if (peer.cells.has(key)) send(peer, { t: 'lk', id: event.obj.id, n: event.obj.likes })
      return
    }
    case 'season': {
      for (const peer of peers.values()) {
        for (const key of peer.cells) world.unwatch(key)
        peer.cells.clear()
        peer.wanted.clear()
        send(peer, { t: 'season', key: event.key })
      }
      return
    }
  }
}

/* ---- Curseurs ---------------------------------------------------------------------------- */

function cursorTick(): void {
  const moved: Peer[] = []
  for (const peer of peers.values()) if (peer.moved) moved.push(peer)
  if (moved.length === 0) return
  for (const recipient of peers.values()) {
    if (!recipient.view) continue
    const list: number[][] = []
    for (const peer of moved) {
      if (peer === recipient || !inside(recipient.view, peer.x, peer.y)) continue
      list.push([peer.conn, round1(peer.x), round1(peer.y)])
      if (list.length >= MAX_CURSORS_PER_FRAME) break
    }
    if (list.length > 0) send(recipient, { t: 'cur', p: list })
  }
  for (const peer of moved) peer.moved = false
}

/** Toutes les quelques secondes : où est chacun (liste des joueurs, « aller vers »). */
function whereTick(): void {
  const list: number[][] = []
  for (const peer of peers.values()) if (peer.hasCursor) list.push([peer.conn, round1(peer.x), round1(peer.y)])
  if (list.length === 0) return
  broadcast({ t: 'where', p: list.slice(0, 400) })
}

function startTimers(): void {
  if (cursorTimer) return
  cursorTimer = setInterval(cursorTick, CURSOR_TICK_MS)
  whereTimer = setInterval(whereTick, WHERE_TICK_MS)
  pingTimer = setInterval(() => {
    for (const peer of peers.values()) {
      if (!peer.alive) {
        peer.ws.terminate()
        continue
      }
      peer.alive = false
      peer.ws.ping()
    }
  }, 20_000)
  sweepTimer = setInterval(() => {
    world.sweep()
    const now = Date.now()
    for (const peer of peers.values()) for (const [id, live] of peer.live) if (now - live.at > 30_000) endLive(peer, id)
  }, 60_000)
  for (const timer of [cursorTimer, whereTimer, pingTimer, sweepTimer]) timer.unref?.()
}

function stopTimers(): void {
  for (const timer of [cursorTimer, whereTimer, pingTimer, sweepTimer]) if (timer) clearInterval(timer)
  cursorTimer = whereTimer = pingTimer = sweepTimer = null
}

/* ---- En direct : traits et formes en cours ------------------------------------------------- */

function endLive(peer: Peer, id: string): void {
  const live = peer.live.get(id)
  if (!live) return
  peer.live.delete(id)
  broadcastNear(live.box, { t: 'le', c: peer.conn, id }, peer)
}

function grow(box: Box, x: number, y: number, margin: number): void {
  if (x - margin < box.minX) box.minX = x - margin
  if (y - margin < box.minY) box.minY = y - margin
  if (x + margin > box.maxX) box.maxX = x + margin
  if (y + margin > box.maxY) box.maxY = y + margin
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= WORLD_LIMIT

function handleLivePoints(peer: Peer, message: Json): void {
  const id = message.id
  if (typeof id !== 'string' || !OBJECT_ID.test(id) || !Array.isArray(message.p) || message.p.length === 0 || message.p.length > 150 || message.p.length % 3 !== 0) return strike(peer)
  let live = peer.live.get(id)
  const style = message.st as Json | undefined
  if (!live) {
    if (peer.live.size >= 4 || typeof style !== 'object' || style === null) return
    if (!/^#[0-9a-fA-F]{6}$/.test(String(style.c)) || !isNumber(style.sw) || style.sw < 0.25 || style.sw > 256) return strike(peer)
    live = { box: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, points: 0, at: Date.now() }
    peer.live.set(id, live)
  }
  if (live.points + message.p.length / 3 > MAX_STROKE_POINTS) return
  const margin = isNumber(style?.sw) ? Math.min(256, style.sw as number) : 4
  for (let index = 0; index < message.p.length; index += 3) {
    const x = message.p[index]
    const y = message.p[index + 1]
    // Le 3ᵉ nombre (pression) est relayé tel quel aux voisins : il doit être un nombre, rien d'autre.
    if (!isNumber(x) || !isNumber(y) || !isNumber(message.p[index + 2])) return strike(peer)
    grow(live.box, x, y, margin)
  }
  live.points += message.p.length / 3
  live.at = Date.now()
  if (live.box.maxX - live.box.minX > MAX_EXTENT || live.box.maxY - live.box.minY > MAX_EXTENT) return
  if (world.isLocked(peer.actor, live.box)) return
  // Seuls les champs connus du style partent aux voisins (jamais ce qu'un client invente).
  const safe = style
    ? { c: String(style.c).toLowerCase(), sw: style.sw, ...(isNumber(style.a) && style.a >= 0.05 && style.a <= 1 ? { a: style.a } : {}), ...(typeof style.b === 'string' && BRUSH_IDS.includes(style.b) ? { b: style.b } : {}) }
    : null
  broadcastNear(live.box, { t: 'lp', c: peer.conn, id, ...(safe ? { st: safe } : {}), p: message.p }, peer)
}

function handleLiveObject(peer: Peer, message: Json): void {
  const id = message.id
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) return strike(peer)
  let normalized
  try {
    normalized = normalizeObject(message.o)
  } catch {
    return strike(peer)
  }
  if (!peer.live.has(id) && peer.live.size >= 8) return
  peer.live.set(id, { box: normalized.box, points: 0, at: Date.now() })
  if (normalized.data.t === 'f' ? false : world.isLocked(peer.actor, normalized.box)) return
  broadcastNear(normalized.box, { t: 'lo', c: peer.conn, id, o: normalized.data }, peer)
}

/* ---- Vue : quelles cases le client regarde ------------------------------------------------- */

const MAX_CELLS_PER_VIEW = 64
const OBJECTS_PER_MESSAGE = 250

async function syncCells(peer: Peer): Promise<void> {
  if (!peer.view || !peer.vec) {
    dropCells(peer, [...peer.cells])
    peer.wanted.clear()
    return
  }
  const keys = world.keysOf(peer.view).slice(0, MAX_CELLS_PER_VIEW)
  const want = new Set(keys)
  peer.wanted = want
  dropCells(peer, [...peer.cells].filter((key) => !want.has(key)))
  for (const key of keys) {
    if (peer.cells.has(key)) continue
    const objects = await world.objectsOfCell(key)
    // Le client a bougé, ou s'est déconnecté, pendant le chargement.
    if (peer.ws.readyState !== 1 || !peer.wanted.has(key) || peer.cells.has(key)) continue
    peer.cells.add(key)
    world.watch(key)
    const visible = objects.filter((object) => !object.hidden || peer.access.admin)
    if (visible.length === 0) send(peer, { t: 'objs', k: key, o: [] })
    for (let at = 0; at < visible.length; at += OBJECTS_PER_MESSAGE) {
      send(peer, { t: 'objs', k: key, o: visible.slice(at, at + OBJECTS_PER_MESSAGE).map((object) => wire(object, peer.access.admin)), ...(at === 0 ? { first: 1 } : {}) })
    }
  }
}

function dropCells(peer: Peer, keys: string[]): void {
  if (keys.length === 0) return
  for (const key of keys) {
    if (peer.cells.delete(key)) world.unwatch(key)
  }
  send(peer, { t: 'drop', k: keys })
}

function handleView(peer: Peer, message: Json): void {
  const b = message.b
  if (!Array.isArray(b) || b.length !== 4 || !b.every(isNumber)) return strike(peer)
  if (!peer.viewBucket.take()) {
    // Trop de vues d'affilée (zoom prolongé) : on garde la dernière, sinon le serveur resterait sur une vue périmée
    // et les objets n'arriveraient plus au retour du zoom.
    peer.viewLater = message
    peer.viewTimer ??= setTimeout(() => {
      peer.viewTimer = null
      const later = peer.viewLater
      peer.viewLater = null
      if (later && peer.ws.readyState === 1) handleView(peer, later)
    }, 250)
    return
  }
  const [x0, y0, x1, y1] = b as [number, number, number, number]
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, y1 - y0)
  peer.view = {
    minX: Math.min(x0, x1) - width * VIEW_PADDING,
    minY: Math.min(y0, y1) - height * VIEW_PADDING,
    maxX: Math.max(x0, x1) + width * VIEW_PADDING,
    maxY: Math.max(y0, y1) + height * VIEW_PADDING,
  }
  peer.vec = message.vec !== 0 && width <= MAX_VIEW_SPAN && height <= MAX_VIEW_SPAN
  peer.level = typeof message.m === 'number' && Number.isInteger(message.m) && message.m >= 0 && message.m <= TILE_MAX_LEVEL ? message.m : 0
  void syncCells(peer).catch((error) => console.error('[canvas] vue', error))
}

/* ---- Opérations --------------------------------------------------------------------------- */

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 40

async function runOp(peer: Peer, op: Json): Promise<{ id?: string }> {
  switch (op.k) {
    case 'c':
      return { id: (await world.create(peer.actor, op.id, op.o)).id }
    case 'u':
      return { id: (await world.update(peer.actor, op.id, op.o)).id }
    case 'd':
      return { id: (await world.remove(peer.actor, op.id)).id }
    case 'z':
      if (op.to !== 'front' && op.to !== 'back') throw new CanvasFault('bad_shape')
      return { id: (await world.restack(peer.actor, op.id, op.to)).id }
    default:
      throw new CanvasFault('bad_shape')
  }
}

function enqueue(peer: Peer, job: () => Promise<void>): void {
  peer.queue = peer.queue.then(job).catch((error) => console.error('[canvas] opération', error))
}

function handleOps(peer: Peer, message: Json, many: boolean): void {
  const cid = typeof message.cid === 'number' ? message.cid : null
  const ops = many ? message.ops : [message]
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 100) return strike(peer)
  if (!peer.access.canDraw) {
    send(peer, { t: 'ack', cid, ok: false, e: peer.access.reason ?? 'forbidden' })
    return
  }
  if (!peer.ops.take(ops.length)) {
    send(peer, { t: 'ack', cid, ok: false, e: 'slow_down' })
    return
  }
  enqueue(peer, async () => {
    const failures: { id?: string; e: string }[] = []
    for (const raw of ops) {
      const op = raw as Json
      try {
        await runOp(peer, op)
      } catch (error) {
        if (!(error instanceof CanvasFault)) throw error
        failures.push({ ...(isId(op.id) ? { id: op.id } : {}), e: error.code })
        // Le client rétablit ce qu'il avait modifié : l'état réel de l'objet lui est renvoyé.
        if (isId(op.id)) {
          const real = world.peek(op.id)
          if (real && (!real.hidden || peer.access.admin)) send(peer, { t: 'op', k: 'u', ...wire(real, peer.access.admin) })
          else if (op.k === 'c') send(peer, { t: 'op', k: 'd', id: op.id })
        }
      }
      // Fin d'un aperçu : l'objet est devenu (ou n'est pas devenu) définitif.
      if (isId(op.id) && (op.k === 'c' || op.k === 'u')) endLive(peer, op.id)
    }
    send(peer, { t: 'ack', cid, ok: failures.length === 0, ...(failures.length > 0 ? { e: failures[0]!.e, fails: failures } : {}) })
  })
}

/* ---- Messages ------------------------------------------------------------------------------ */

function strike(peer: Peer): void {
  peer.strikes += 1
  if (peer.strikes > MAX_STRIKES) peer.ws.close(1008, 'invalid')
}

const TOOLS = new Set(['hand', 'select', 'pen', 'eraser', 'rect', 'ellipse', 'line', 'arrow', 'polygon', 'bezier', 'text', 'frame', 'pick', 'heart', 'image'])

function onMessage(peer: Peer, raw: RawData): void {
  const size = Array.isArray(raw) ? raw.reduce((sum, chunk) => sum + chunk.length, 0) : raw instanceof ArrayBuffer ? raw.byteLength : raw.length
  if (size > MAX_MESSAGE_BYTES) return peer.ws.close(1009, 'too big')
  let message: Json
  try {
    const parsed: unknown = JSON.parse(raw.toString())
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return strike(peer)
    message = parsed as Json
  } catch {
    return strike(peer)
  }
  switch (message.t) {
    case 'cur': {
      if (!isNumber(message.x) || !isNumber(message.y)) return strike(peer)
      if (!peer.cursorBucket.take()) return
      peer.x = message.x
      peer.y = message.y
      peer.hasCursor = true
      peer.moved = true
      return
    }
    case 'view':
      return handleView(peer, message)
    case 'tool': {
      if (typeof message.tool !== 'string' || !TOOLS.has(message.tool)) return strike(peer)
      if (typeof message.ink === 'string' && /^#[0-9a-fA-F]{6}$/.test(message.ink)) peer.ink = message.ink.toLowerCase()
      if (isNumber(message.size)) peer.size = Math.min(256, Math.max(0.25, message.size))
      peer.tool = message.tool
      if (!peer.liveBucket.take()) return
      broadcast({ t: 'pt', c: peer.conn, tl: peer.tool, ic: peer.ink, sz: peer.size }, peer)
      return
    }
    case 'lp':
    case 'lo': {
      if (!peer.access.canDraw || !peer.liveBucket.take()) return
      return message.t === 'lp' ? handleLivePoints(peer, message) : handleLiveObject(peer, message)
    }
    case 'le':
      if (isId(message.id)) endLive(peer, message.id)
      return
    case 'op':
      return handleOps(peer, message, false)
    case 'ops':
      return handleOps(peer, message, true)
    case 'chat': {
      const now = Date.now()
      if (typeof message.text !== 'string' || now - peer.lastChat < CHAT_INTERVAL_MS || !peer.access.canDraw) return
      // eslint-disable-next-line no-control-regex
      const text = message.text.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').trim().slice(0, MAX_CHAT)
      if (!text || !peer.hasCursor) return
      peer.lastChat = now
      const near: Box = { minX: peer.x, minY: peer.y, maxX: peer.x, maxY: peer.y }
      broadcastNear(near, { t: 'chat', c: peer.conn, text }, peer)
      return
    }
    case 'react': {
      const now = Date.now()
      if (typeof message.e !== 'string' || !(REACTIONS as readonly string[]).includes(message.e) || now - peer.lastReact < REACT_INTERVAL_MS || !peer.hasCursor) return
      peer.lastReact = now
      broadcastNear({ minX: peer.x, minY: peer.y, maxX: peer.x, maxY: peer.y }, { t: 'react', c: peer.conn, e: message.e, x: round1(peer.x), y: round1(peer.y) }, peer)
      return
    }
    case 'ping':
      send(peer, { t: 'pong', n: message.n ?? null })
      return
    default:
      return strike(peer)
  }
}

/* ---- Connexions ---------------------------------------------------------------------------- */

function limitsMessage(): Json {
  return {
    cell: CELL,
    world: WORLD_LIMIT,
    extent: MAX_EXTENT,
    strokePoints: MAX_STROKE_POINTS,
    inkMax: MAX_OBJECTS_PER_USER,
    frames: { max: FRAMES_PER_USER, collaborators: FRAME_COLLABORATORS },
    tile: { base: TILE_BASE, maxLevel: TILE_MAX_LEVEL },
    reactions: REACTIONS,
    chat: MAX_CHAT,
    brushes: BRUSHES,
  }
}

function connect(ws: WebSocket, access: CanvasAccess): void {
  const actor: Actor = { id: access.userId, admin: access.admin, brushes: access.brushes }
  const peer: Peer = {
    conn: nextConn++,
    ws,
    userId: access.userId,
    access,
    actor,
    name: access.name,
    color: colorOf(access.userId),
    x: 0,
    y: 0,
    hasCursor: false,
    moved: false,
    tool: 'pen',
    ink: '#1b1b1f',
    size: 4,
    view: null,
    vec: true,
    level: 0,
    cells: new Set(),
    wanted: new Set(),
    live: new Map(),
    queue: Promise.resolve(),
    ops: new Bucket(OPS_BUCKET.capacity, OPS_BUCKET.refillPerSecond),
    liveBucket: new Bucket(LIVE_BUCKET.capacity, LIVE_BUCKET.refillPerSecond),
    cursorBucket: new Bucket(CURSOR_BUCKET.capacity, CURSOR_BUCKET.refillPerSecond),
    viewBucket: new Bucket(10, 6),
    viewLater: null,
    viewTimer: null,
    lastChat: 0,
    lastReact: 0,
    strikes: 0,
    alive: true,
  }
  peers.set(peer.conn, peer)
  startTimers()
  send(peer, {
    t: 'welcome',
    me: { c: peer.conn, u: peer.userId, n: peer.name, k: peer.color, admin: access.admin, draw: access.canDraw, reason: access.reason, wait: access.waitMs },
    season: world.seasonKey,
    limits: limitsMessage(),
    brushes: [...access.brushes],
    peers: [...peers.values()].filter((other) => other !== peer).map(peerInfo),
  })
  broadcast({ t: 'peer', a: peerInfo(peer) }, peer)
  ws.on('pong', () => {
    peer.alive = true
  })
  ws.on('message', (raw) => onMessage(peer, raw))
  ws.on('error', () => undefined)
  ws.on('close', () => {
    peers.delete(peer.conn)
    if (peer.viewTimer) clearTimeout(peer.viewTimer)
    peer.viewLater = null
    for (const key of peer.cells) world.unwatch(key)
    peer.cells.clear()
    for (const id of [...peer.live.keys()]) endLive(peer, id)
    broadcast({ t: 'peer', d: peer.conn })
    if (peers.size === 0) stopTimers()
  })
}

export const CANVAS_SOCKET_PATH = '/api/canvas/ws'

/** Branche le WebSocket de la toile sur le serveur HTTP de l'API. */
export function attachCanvasSocket(server: Server, ready: () => Promise<void>): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false })
  const unsubscribe = world.on(onWorldEvent)
  const handler = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== CANVAS_SOCKET_PATH) return
    socket.on('error', () => undefined)
    void (async () => {
      if (!originAllowed(request)) return refuse(socket, 403, 'Forbidden')
      if (peers.size >= MAX_CONNECTIONS) return refuse(socket, 503, 'Busy')
      let userId: string | null = null
      try {
        userId = await authenticate(cookieOf(request.headers.cookie, SESSION_COOKIE))
      } catch {
        return refuse(socket, 401, 'Unauthorized')
      }
      if (!userId) return refuse(socket, 401, 'Unauthorized')
      if ([...peers.values()].filter((peer) => peer.userId === userId).length >= MAX_CONNECTIONS_PER_USER) return refuse(socket, 429, 'Too Many')
      const access = await accessOf(userId)
      if (!access) return refuse(socket, 401, 'Unauthorized')
      await ready()
      wss.handleUpgrade(request, socket, head, (ws) => connect(ws, access))
    })().catch((error) => {
      console.error('[canvas] connexion', error)
      refuse(socket, 500, 'Error')
    })
  }
  server.on('upgrade', handler)
  const tileOff = onTileChange((changes) => {
    for (const peer of peers.values()) {
      if (peer.vec || !peer.view) continue
      const list = changes.filter(([level]) => level === peer.level)
      if (list.length > 0) send(peer, { t: 'tv', k: list })
    }
  })
  return () => {
    server.off('upgrade', handler)
    unsubscribe()
    tileOff()
    for (const peer of peers.values()) peer.ws.close(1001, 'shutdown')
    wss.close()
    stopTimers()
  }
}

/* ---- Appels depuis les routes et l'administration ------------------------------------------- */

export function onlineCount(): number {
  return peers.size
}

export function onlineUsers(): string[] {
  return [...new Set([...peers.values()].map((peer) => peer.userId))]
}

/** Les droits d'un compte ont changé (exclusion, pinceau acheté) : ses connexions suivent. */
export async function refreshAccess(userId: string): Promise<void> {
  const access = await accessOf(userId)
  if (!access) return
  for (const peer of peers.values()) {
    if (peer.userId !== userId) continue
    peer.access = access
    peer.actor.brushes = access.brushes
    peer.actor.admin = access.admin
    send(peer, { t: 'me', draw: access.canDraw, reason: access.reason, wait: access.waitMs, brushes: [...access.brushes] })
  }
}

/** Un compte exclu ou supprimé : ses aperçus s'éteignent aussitôt. */
export function silence(userId: string): void {
  for (const peer of peers.values()) {
    if (peer.userId !== userId) continue
    for (const id of [...peer.live.keys()]) endLive(peer, id)
  }
}
