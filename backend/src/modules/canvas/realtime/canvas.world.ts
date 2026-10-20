import { prisma } from '../../../core/db.js'
import type { Prisma } from '../../../generated/prisma/client.js'
import { FRAMES_PER_USER, MAX_OBJECTS_PER_USER } from '../canvas.constants.js'
import { BRUSHES } from '../canvas.constants.js'
import { CanvasFault, OBJECT_ID, anchorRange, cellKey, cellOf, frameBox, normalizeObject, overlaps, type Box, type ObjectData, type ObjectType } from '../canvas.schema.js'

/*
 * Le monde de la toile, en mémoire. Chaque objet vit dans la case (`CELL` unités de côté) de son
 * coin supérieur gauche : un client qui regarde une zone reçoit les objets des cases voisines.
 * Les cases se chargent à la demande depuis la base et s'évacuent quand personne ne les regarde ;
 * les écritures sont groupées (toutes les 1,5 s) : la base ne voit jamais la cadence des traits.
 * Une seule instance de l'API tient la toile (comme les salons de la Bombe).
 *
 * Les règles d'écriture sont ici, au même endroit pour le temps réel, l'administration et les
 * « j'aime » : propriétaire de l'objet, cadres réservés, budget d'encre, pinceaux débloqués.
 */

export interface WObject {
  id: string
  type: ObjectType
  owner: string
  data: ObjectData
  box: Box
  cx: number
  cy: number
  z: number
  version: number
  likes: number
  hidden: boolean
  hiddenReason: string | null
  createdAt: number
  /** Écrit en base ? Sinon un « j'aime » ou un signalement doit attendre la prochaine écriture. */
  persisted: boolean
}

export interface Actor {
  id: string
  admin: boolean
  /** Pinceaux que ce compte peut utiliser (hors ceux de départ). */
  brushes: ReadonlySet<string>
}

export type WorldEvent =
  /** Créé ou modifié (`prevKey` : sa case avant, si elle a changé). */
  | { type: 'upsert'; obj: WObject; prevKey: string | null; created: boolean; by: string | null; invited: string[]; prevBox: Box | null }
  | { type: 'remove'; obj: WObject; by: string | null }
  /** Masqué par des signalements ou un administrateur : les autres joueurs ne le voient plus. */
  | { type: 'hide'; obj: WObject }
  | { type: 'unhide'; obj: WObject }
  | { type: 'likes'; obj: WObject }
  | { type: 'season'; key: string }

interface Cell {
  key: string
  cx: number
  cy: number
  objects: Map<string, WObject>
  loading: Promise<void> | null
  loaded: boolean
  usedAt: number
}

const FLUSH_MS = 1500
/** Case sans spectateur ni écriture en attente : évacuée après ce délai. */
const IDLE_MS = 3 * 60_000
const FLUSH_BATCH = 200

type Listener = (event: WorldEvent) => void

const coOf = (object: WObject): string[] => ((object.data.co as string[] | undefined) ?? []).slice()

export const monthKey = (date = new Date()) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`

function toRow(seasonId: string, object: WObject): Prisma.CanvasObjectUncheckedCreateInput {
  return {
    id: object.id,
    seasonId,
    ownerId: object.owner,
    type: object.type,
    data: JSON.stringify(object.data),
    minX: object.box.minX,
    minY: object.box.minY,
    maxX: object.box.maxX,
    maxY: object.box.maxY,
    cx: object.cx,
    cy: object.cy,
    z: object.z,
    version: object.version,
    likes: object.likes,
    hiddenAt: object.hidden ? new Date() : null,
    hiddenReason: object.hiddenReason,
    createdAt: new Date(object.createdAt),
  }
}

export function fromRow(row: { id: string; type: string; ownerId: string; data: string; minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number; z: number; version: number; likes: number; hiddenAt: Date | null; hiddenReason: string | null; createdAt: Date }): WObject {
  return {
    id: row.id,
    type: row.type as ObjectType,
    owner: row.ownerId,
    data: JSON.parse(row.data) as ObjectData,
    box: { minX: row.minX, minY: row.minY, maxX: row.maxX, maxY: row.maxY },
    cx: row.cx,
    cy: row.cy,
    z: row.z,
    version: row.version,
    likes: row.likes,
    hidden: row.hiddenAt !== null,
    hiddenReason: row.hiddenReason,
    createdAt: row.createdAt.getTime(),
    persisted: true,
  }
}

class World {
  seasonId = ''
  seasonKey = ''
  private cells = new Map<string, Cell>()
  private byId = new Map<string, WObject>()
  private frames = new Map<string, WObject>()
  private counts = new Map<string, number>()
  private watchers = new Map<string, number>()
  private dirty = new Map<string, 'u' | 'd'>()
  private topZ = 0
  private bottomZ = 0
  private listeners = new Set<Listener>()
  private flushing: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: WorldEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  /* ---- Saison -------------------------------------------------------------------------- */

  /** Charge (ou crée) la saison du mois : ses cadres, ses bornes d'empilement. */
  async open(key = monthKey()): Promise<void> {
    const season = await prisma.canvasSeason.upsert({ where: { key }, update: {}, create: { key } })
    this.cells.clear()
    this.byId.clear()
    this.frames.clear()
    this.counts.clear()
    this.dirty.clear()
    this.seasonId = season.id
    this.seasonKey = season.key
    const [bounds, frames] = await Promise.all([
      prisma.canvasObject.aggregate({ where: { seasonId: season.id }, _max: { z: true }, _min: { z: true } }),
      prisma.canvasObject.findMany({ where: { seasonId: season.id, type: 'f' } }),
    ])
    this.topZ = bounds._max.z ?? 0
    this.bottomZ = bounds._min.z ?? 0
    for (const row of frames) {
      const object = fromRow(row)
      this.frames.set(object.id, object)
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush().catch((error) => console.error('[canvas] écriture', error)), FLUSH_MS)
      this.timer.unref?.()
    }
  }

  get ready(): boolean {
    return this.seasonId !== ''
  }

  /* ---- Cases --------------------------------------------------------------------------- */

  private cell(cx: number, cy: number): Cell {
    const key = cellKey(cx, cy)
    let cell = this.cells.get(key)
    if (!cell) {
      cell = { key, cx, cy, objects: new Map(), loading: null, loaded: false, usedAt: Date.now() }
      this.cells.set(key, cell)
    }
    return cell
  }

  /** Charge une case depuis la base (une seule requête, même demandée par plusieurs). */
  async ensureCell(cx: number, cy: number): Promise<Cell> {
    const cell = this.cell(cx, cy)
    cell.usedAt = Date.now()
    if (cell.loaded) return cell
    if (!cell.loading) {
      const seasonId = this.seasonId
      cell.loading = (async () => {
        const rows = await prisma.canvasObject.findMany({ where: { seasonId, cx, cy } })
        // La saison a pu changer, ou la case être évacuée pendant la lecture.
        if (seasonId !== this.seasonId || this.cells.get(cell.key) !== cell) return
        for (const row of rows) {
          // Un objet créé ou supprimé depuis (écriture en attente) fait foi, pas la base.
          if (cell.objects.has(row.id) || this.dirty.get(row.id) === 'd') continue
          // Un cadre déjà connu (chargé avec la saison) reste le même objet : un seul exemplaire en mémoire.
          const object = (row.type === 'f' ? this.frames.get(row.id) : undefined) ?? fromRow(row)
          cell.objects.set(object.id, object)
          this.byId.set(object.id, object)
        }
        cell.loaded = true
      })().finally(() => {
        cell.loading = null
      })
    }
    await cell.loading
    return cell
  }

  /** Charge toutes les cases qui peuvent contenir un objet touchant `box`. */
  async ensureRange(box: Box): Promise<Cell[]> {
    const { x0, x1, y0, y1 } = anchorRange(box)
    const pending: Promise<Cell>[] = []
    for (let cy = y0; cy <= y1; cy += 1) for (let cx = x0; cx <= x1; cx += 1) pending.push(this.ensureCell(cx, cy))
    return Promise.all(pending)
  }

  /** Cases (clés) d'une zone, sans les charger. */
  keysOf(box: Box): string[] {
    const { x0, x1, y0, y1 } = anchorRange(box)
    const keys: string[] = []
    for (let cy = y0; cy <= y1; cy += 1) for (let cx = x0; cx <= x1; cx += 1) keys.push(cellKey(cx, cy))
    return keys
  }

  /** Objets d'une case déjà chargée (vide sinon). */
  objectsOf(key: string): WObject[] {
    const cell = this.cells.get(key)
    return cell?.loaded ? [...cell.objects.values()] : []
  }

  async objectsOfCell(key: string): Promise<WObject[]> {
    const [cx, cy] = key.split(':').map(Number) as [number, number]
    const cell = await this.ensureCell(cx, cy)
    return [...cell.objects.values()]
  }

  watch(key: string): void {
    this.watchers.set(key, (this.watchers.get(key) ?? 0) + 1)
  }

  unwatch(key: string): void {
    const next = (this.watchers.get(key) ?? 1) - 1
    if (next <= 0) this.watchers.delete(key)
    else this.watchers.set(key, next)
  }

  /** Évacue les cases que personne ne regarde, propres, inutilisées depuis un moment. */
  sweep(now = Date.now()): number {
    let dropped = 0
    for (const [key, cell] of this.cells) {
      if (!cell.loaded || this.watchers.has(key) || now - cell.usedAt < IDLE_MS) continue
      let pending = false
      for (const id of cell.objects.keys()) if (this.dirty.has(id)) pending = true
      if (pending) continue
      for (const id of cell.objects.keys()) this.byId.delete(id)
      this.cells.delete(key)
      dropped += 1
    }
    return dropped
  }

  /* ---- Lecture ------------------------------------------------------------------------- */

  /** Un objet : en mémoire, ou chargé avec sa case. */
  async find(id: string): Promise<WObject | null> {
    const known = this.byId.get(id)
    if (known) return known
    if (this.dirty.get(id) === 'd') return null
    const row = await prisma.canvasObject.findFirst({ where: { id, seasonId: this.seasonId } })
    if (!row) return null
    // Charger sa case entière : l'objet y est alors rangé, comme tous les autres.
    await this.ensureCell(row.cx, row.cy)
    return this.byId.get(id) ?? null
  }

  peek(id: string): WObject | undefined {
    return this.byId.get(id)
  }

  frameList(): WObject[] {
    return [...this.frames.values()]
  }

  /** « J'aime » ou signalement : l'objet doit être en base. */
  async persisted(object: WObject): Promise<void> {
    if (!object.persisted) await this.flush()
  }

  /* ---- Règles ------------------------------------------------------------------------- */

  private canDrawIn(actor: Actor, frame: WObject): boolean {
    return actor.admin || frame.owner === actor.id || ((frame.data.co as string[] | undefined) ?? []).includes(actor.id)
  }

  /** Un cadre réservé recouvre `box` sans que `actor` y ait droit ? (aperçus en direct) */
  isLocked(actor: Actor, box: Box): boolean {
    return this.lockedBy(actor, box) !== null
  }

  private lockedBy(actor: Actor, box: Box, ignore?: string): WObject | null {
    for (const frame of this.frames.values()) {
      if (frame.id === ignore || frame.hidden) continue
      if (overlaps(box, frameBox(frame.data)) && !this.canDrawIn(actor, frame)) return frame
    }
    return null
  }

  private async countOf(owner: string): Promise<number> {
    const known = this.counts.get(owner)
    if (known !== undefined) return known
    await this.flush()
    const count = await prisma.canvasObject.count({ where: { seasonId: this.seasonId, ownerId: owner } })
    // Une création pendant la lecture ne doit pas être comptée deux fois.
    if (this.counts.has(owner)) return this.counts.get(owner)!
    this.counts.set(owner, count)
    return count
  }

  private bump(owner: string, delta: number): void {
    const known = this.counts.get(owner)
    if (known !== undefined) this.counts.set(owner, Math.max(0, known + delta))
  }

  /** Règles propres aux cadres : taille (déjà vérifiée), chevauchement, objets d'autrui, quota. */
  private checkFrame(actor: Actor, data: ObjectData, self: string | null, existing: number): void {
    const area = frameBox(data)
    for (const other of this.frames.values()) {
      if (other.id !== self && overlaps(area, frameBox(other.data))) throw new CanvasFault('frame_overlap')
    }
    if (existing >= FRAMES_PER_USER) throw new CanvasFault('frame_quota')
    for (const key of this.keysOf(area)) {
      for (const object of this.cells.get(key)?.objects.values() ?? []) {
        if (object.type !== 'f' && !object.hidden && object.owner !== actor.id && overlaps(area, object.box)) throw new CanvasFault('frame_occupied')
      }
    }
  }

  private framesOf(owner: string, ignore: string | null): number {
    let count = 0
    for (const frame of this.frames.values()) if (frame.owner === owner && frame.id !== ignore) count += 1
    return count
  }

  private checkBrush(actor: Actor, data: ObjectData): void {
    const brush = data.b
    if (typeof brush !== 'string') return
    const free = BRUSHES.find((entry) => entry.id === brush)?.price === 0
    if (!free && !actor.admin && !actor.brushes.has(brush)) throw new CanvasFault('brush_locked')
  }

  /* ---- Écriture ------------------------------------------------------------------------ */

  async create(actor: Actor, id: unknown, raw: unknown, now = Date.now()): Promise<WObject> {
    if (typeof id !== 'string' || !OBJECT_ID.test(id)) throw new CanvasFault('bad_id')
    const { data, box } = normalizeObject(raw)
    this.checkBrush(actor, data)
    const cx = cellOf(box.minX)
    const cy = cellOf(box.minY)
    if (data.t === 'f') await this.ensureRange(frameBox(data))
    else await this.ensureCell(cx, cy)
    const owned = await this.countOf(actor.id)
    if (this.byId.has(id) || (this.dirty.get(id) !== 'd' && (await this.existsInDatabase(id)))) throw new CanvasFault('id_taken')
    // ---- Section sans attente : les vérifications et l'insertion vont ensemble.
    if (owned >= MAX_OBJECTS_PER_USER) throw new CanvasFault('ink_empty')
    if (data.t === 'f') this.checkFrame(actor, data, null, this.framesOf(actor.id, null))
    else if (this.lockedBy(actor, box)) throw new CanvasFault('frame_locked')
    if (this.byId.has(id)) throw new CanvasFault('id_taken')
    const object: WObject = {
      id,
      type: data.t,
      owner: actor.id,
      data,
      box,
      cx,
      cy,
      z: (this.topZ += 1),
      version: 1,
      likes: 0,
      hidden: false,
      hiddenReason: null,
      createdAt: now,
      persisted: false,
    }
    this.insert(object)
    this.bump(actor.id, 1)
    this.dirty.set(id, 'u')
    this.emit({ type: 'upsert', obj: object, prevKey: null, created: true, by: actor.id, prevBox: null, invited: object.type === 'f' ? coOf(object).filter((id) => id !== actor.id) : [] })
    return object
  }

  private async existsInDatabase(id: string): Promise<boolean> {
    return (await prisma.canvasObject.count({ where: { id } })) > 0
  }

  private insert(object: WObject): void {
    this.cell(object.cx, object.cy).objects.set(object.id, object)
    this.byId.set(object.id, object)
    if (object.type === 'f') this.frames.set(object.id, object)
  }

  private detach(object: WObject): void {
    this.cells.get(cellKey(object.cx, object.cy))?.objects.delete(object.id)
    this.byId.delete(object.id)
    this.frames.delete(object.id)
  }

  /** Remplace la géométrie d'un objet (déplacement, redimensionnement, couleur…). */
  async update(actor: Actor, id: unknown, raw: unknown): Promise<WObject> {
    if (typeof id !== 'string') throw new CanvasFault('bad_id')
    const object = await this.find(id)
    if (!object) throw new CanvasFault('gone')
    if (object.owner !== actor.id && !actor.admin) throw new CanvasFault('not_yours')
    if (object.hidden && !actor.admin) throw new CanvasFault('hidden')
    const { data, box } = normalizeObject(raw)
    if (data.t !== object.type) throw new CanvasFault('bad_shape')
    this.checkBrush(actor, data)
    const cx = cellOf(box.minX)
    const cy = cellOf(box.minY)
    if (data.t === 'f') await this.ensureRange(frameBox(data))
    else await this.ensureCell(cx, cy)
    // ---- Section sans attente.
    if (this.byId.get(id) !== object) throw new CanvasFault('gone')
    if (data.t === 'f') this.checkFrame(actor, data, id, this.framesOf(object.owner, id))
    else if (this.lockedBy(actor, box)) throw new CanvasFault('frame_locked')
    const prevKey = cellKey(object.cx, object.cy)
    const before = object.type === 'f' ? coOf(object) : []
    const prevBox = object.box
    this.detach(object)
    object.data = data
    object.box = box
    object.cx = cx
    object.cy = cy
    object.version += 1
    this.insert(object)
    this.dirty.set(id, 'u')
    object.persisted = false
    const invited = object.type === 'f' ? coOf(object).filter((id) => !before.includes(id) && id !== object.owner) : []
    this.emit({ type: 'upsert', obj: object, prevKey: prevKey === cellKey(cx, cy) ? null : prevKey, created: false, by: actor.id, invited, prevBox })
    return object
  }

  /** Passe un objet devant tous les autres, ou derrière. */
  async restack(actor: Actor, id: unknown, to: 'front' | 'back'): Promise<WObject> {
    if (typeof id !== 'string') throw new CanvasFault('bad_id')
    const object = await this.find(id)
    if (!object) throw new CanvasFault('gone')
    if (object.owner !== actor.id && !actor.admin) throw new CanvasFault('not_yours')
    object.z = to === 'front' ? (this.topZ += 1) : (this.bottomZ -= 1)
    object.version += 1
    this.dirty.set(id, 'u')
    this.emit({ type: 'upsert', obj: object, prevKey: null, created: false, by: actor.id, invited: [], prevBox: null })
    return object
  }

  async remove(actor: Actor, id: unknown): Promise<WObject> {
    if (typeof id !== 'string') throw new CanvasFault('bad_id')
    const object = await this.find(id)
    if (!object) throw new CanvasFault('gone')
    if (object.owner !== actor.id && !actor.admin) {
      // Le propriétaire d'un cadre peut effacer ce qu'on y a laissé.
      const frame = [...this.frames.values()].find((candidate) => candidate.owner === actor.id && object.type !== 'f' && overlaps(object.box, frameBox(candidate.data)))
      if (!frame) throw new CanvasFault('not_yours')
    }
    return this.drop(object, actor.id)
  }

  /** Supprime sans question (administration, fin de compte). */
  drop(object: WObject, by: string | null): WObject {
    this.detach(object)
    this.bump(object.owner, -1)
    this.dirty.set(object.id, 'd')
    this.emit({ type: 'remove', obj: object, by })
    return object
  }

  /** Efface tout ce qu'un compte a dessiné cette saison. Rend le nombre d'objets effacés. */
  async purge(owner: string, by: string | null): Promise<number> {
    await this.flush()
    const rows = await prisma.canvasObject.findMany({ where: { seasonId: this.seasonId, ownerId: owner }, select: { id: true, cx: true, cy: true } })
    const cells = new Set(rows.map((row) => cellKey(row.cx, row.cy)))
    for (const key of cells) {
      const [cx, cy] = key.split(':').map(Number) as [number, number]
      await this.ensureCell(cx, cy)
    }
    let removed = 0
    for (const row of rows) {
      const object = this.byId.get(row.id)
      if (object) {
        this.drop(object, by)
        removed += 1
      }
    }
    return removed
  }

  /** Masque (ou rend visible) un objet : l'état change, les joueurs sont prévenus. */
  async setHidden(id: string, hidden: boolean, reason: string | null): Promise<WObject | null> {
    const object = await this.find(id)
    if (!object || object.hidden === hidden) return object
    object.hidden = hidden
    object.hiddenReason = hidden ? reason : null
    object.version += 1
    object.persisted = false
    this.dirty.set(id, 'u')
    this.emit({ type: hidden ? 'hide' : 'unhide', obj: object })
    return object
  }

  /** Compteur de « j'aime » (la base est déjà à jour). */
  setLikes(object: WObject, likes: number): void {
    object.likes = likes
    this.emit({ type: 'likes', obj: object })
  }

  /* ---- Persistance --------------------------------------------------------------------- */

  /** Écrit les changements en attente. Plusieurs appels simultanés se suivent. */
  async flush(): Promise<void> {
    while (this.flushing) await this.flushing
    if (this.dirty.size === 0) return
    const batch = new Map(this.dirty)
    this.dirty.clear()
    const seasonId = this.seasonId
    this.flushing = (async () => {
      const upserts: WObject[] = []
      const deletes: string[] = []
      for (const [id, state] of batch) {
        if (state === 'd') deletes.push(id)
        else {
          const object = this.byId.get(id)
          if (object) upserts.push(object)
        }
      }
      try {
        for (let at = 0; at < deletes.length; at += FLUSH_BATCH) await prisma.canvasObject.deleteMany({ where: { id: { in: deletes.slice(at, at + FLUSH_BATCH) } } })
        for (let at = 0; at < upserts.length; at += FLUSH_BATCH) {
          const slice = upserts.slice(at, at + FLUSH_BATCH)
          await prisma.$transaction(
            slice.map((object) => {
              const row = toRow(seasonId, object)
              // Les « j'aime » se comptent à part (table CanvasLike) : ne jamais les écraser.
              const { likes: _likes, createdAt: _createdAt, id: _id, ...update } = row
              void _likes
              void _createdAt
              void _id
              return prisma.canvasObject.upsert({ where: { id: object.id }, create: row, update })
            }),
          )
          for (const object of slice) object.persisted = true
        }
      } catch (error) {
        // Rien n'est perdu : ce qui n'a pas pu partir repart au prochain tour (sans écraser du plus récent).
        for (const [id, state] of batch) if (!this.dirty.has(id)) this.dirty.set(id, state)
        throw error
      }
    })().finally(() => {
      this.flushing = null
    })
    await this.flushing
  }

  /** Arrêt : écrit ce qui reste. */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.flush()
  }

  stats(): { cells: number; objects: number; frames: number; pending: number } {
    return { cells: this.cells.size, objects: this.byId.size, frames: this.frames.size, pending: this.dirty.size }
  }
}

export const world = new World()
