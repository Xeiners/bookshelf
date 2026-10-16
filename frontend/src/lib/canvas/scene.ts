import RBush from 'rbush'
import { boundsOf, drawOrder, overlaps } from './geometry'
import type { Box, CanvasObject, Data, Ghost } from './types'

/*
 * Les objets que ce client connaît : ceux des cases qu'il regarde, plus ses propres créations
 * en attente. Un index spatial (R-tree) donne en un instant ceux qui touchent l'écran. Chaque
 * objet est rangé avec sa case d'ancrage (`cell`) : quand le serveur dit qu'une case sort de
 * la vue (`drop`), ses objets s'en vont.
 */

interface Entry extends Box {
  object: CanvasObject
}

export interface WireObject {
  id: string
  o: string
  d: Data
  z: number
  v: number
  l: number
  h?: number
}

/** Un objet reçu du serveur, prêt pour la scène. */
export function fromWire(wire: WireObject): CanvasObject {
  return { id: wire.id, owner: wire.o, data: wire.d, z: wire.z, v: wire.v, likes: wire.l, hidden: wire.h === 1, box: boundsOf(wire.d) }
}

export class Scene {
  private readonly tree = new RBush<Entry>()
  private readonly byId = new Map<string, CanvasObject>()
  private readonly entries = new Map<string, Entry>()
  private readonly cells = new Map<string, Set<string>>()
  private readonly cellOf = new Map<string, string>()
  /** Aperçus des autres joueurs (clé : `conn:id`). */
  readonly ghosts = new Map<string, Ghost>()
  /** Incrémenté à chaque changement : le moteur sait qu'il faut redessiner. */
  revision = 0

  get size(): number {
    return this.byId.size
  }

  get(id: string): CanvasObject | undefined {
    return this.byId.get(id)
  }

  all(): IterableIterator<CanvasObject> {
    return this.byId.values()
  }

  /** Crée ou remplace (si la version n'est pas plus ancienne). `cell` : la case d'ancrage, si connue. */
  upsert(object: CanvasObject, cell?: string): boolean {
    const known = this.byId.get(object.id)
    if (known && object.v < known.v) return false
    if (known) this.detach(known)
    this.byId.set(object.id, object)
    const entry: Entry = { ...object.box, object }
    this.entries.set(object.id, entry)
    this.tree.insert(entry)
    if (cell) this.setCell(object.id, cell)
    this.revision += 1
    return true
  }

  private detach(object: CanvasObject): void {
    const entry = this.entries.get(object.id)
    if (entry) this.tree.remove(entry)
    this.entries.delete(object.id)
  }

  private setCell(id: string, cell: string): void {
    const previous = this.cellOf.get(id)
    if (previous && previous !== cell) this.cells.get(previous)?.delete(id)
    this.cellOf.set(id, cell)
    let members = this.cells.get(cell)
    if (!members) {
      members = new Set()
      this.cells.set(cell, members)
    }
    members.add(id)
  }

  remove(id: string): boolean {
    const object = this.byId.get(id)
    if (!object) return false
    this.detach(object)
    this.byId.delete(id)
    const cell = this.cellOf.get(id)
    if (cell) this.cells.get(cell)?.delete(id)
    this.cellOf.delete(id)
    this.revision += 1
    return true
  }

  /** Une case quitte la vue : on oublie ses objets (sauf ceux que le client a posés lui-même et que le serveur n'a pas encore confirmés). */
  dropCell(cell: string, keep: (id: string) => boolean = () => false): void {
    const members = this.cells.get(cell)
    if (!members) return
    for (const id of [...members]) if (!keep(id)) this.remove(id)
    this.cells.delete(cell)
  }

  clear(): void {
    this.tree.clear()
    this.byId.clear()
    this.entries.clear()
    this.cells.clear()
    this.cellOf.clear()
    this.ghosts.clear()
    this.revision += 1
  }

  /** Les objets qui touchent la zone, dans l'ordre de dessin. */
  query(box: Box): CanvasObject[] {
    return this.tree.search(box).map((entry) => entry.object).sort(drawOrder)
  }

  /** Les objets touchant la zone (sans tri). */
  find(box: Box): CanvasObject[] {
    return this.tree.search(box).map((entry) => entry.object)
  }

  touching(box: Box, predicate: (object: CanvasObject) => boolean): CanvasObject[] {
    return this.find(box).filter((object) => overlaps(object.box, box) && predicate(object))
  }

  setGhost(ghost: Ghost): void {
    this.ghosts.set(`${ghost.conn}:${ghost.id}`, ghost)
    this.revision += 1
  }

  endGhost(conn: number, id: string): void {
    if (this.ghosts.delete(`${conn}:${id}`)) this.revision += 1
  }

  endGhostsOf(conn: number): void {
    for (const key of [...this.ghosts.keys()]) if (key.startsWith(`${conn}:`)) this.ghosts.delete(key)
    this.revision += 1
  }

  /** Aperçus oubliés (un joueur parti sans prévenir). */
  expireGhosts(now: number, maxAge = 20_000): void {
    for (const [key, ghost] of this.ghosts) if (now - ghost.at > maxAge) this.ghosts.delete(key)
  }
}
