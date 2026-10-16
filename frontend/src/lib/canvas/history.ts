/*
 * Annuler / rétablir. Chaque geste de l'utilisateur laisse une entrée : de quoi le défaire et de
 * quoi le refaire, sous forme d'opérations envoyées au serveur (jamais d'état local : l'annulation
 * est elle-même une création ou une suppression comme les autres, vue par tous).
 */

export type Op =
  | { k: 'c'; id: string; o: unknown }
  | { k: 'u'; id: string; o: unknown }
  | { k: 'd'; id: string }
  | { k: 'z'; id: string; to: 'front' | 'back' }

export interface Entry {
  /** Pour défaire. */
  undo: Op[]
  /** Pour refaire. */
  redo: Op[]
}

const MAX = 200

export class History {
  private past: Entry[] = []
  private future: Entry[] = []

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Un nouveau geste : l'avenir (ce qu'on pouvait rétablir) s'efface. */
  push(entry: Entry): void {
    this.past.push(entry)
    if (this.past.length > MAX) this.past.shift()
    this.future = []
  }

  undo(): Entry | null {
    const entry = this.past.pop() ?? null
    if (entry) this.future.push(entry)
    return entry
  }

  redo(): Entry | null {
    const entry = this.future.pop() ?? null
    if (entry) this.past.push(entry)
    return entry
  }

  /** Un geste que le serveur a refusé : il ne doit pas pouvoir être « annulé » ou « rétabli ». */
  discard(entry: Entry): void {
    this.past = this.past.filter((candidate) => candidate !== entry)
    this.future = this.future.filter((candidate) => candidate !== entry)
  }

  clear(): void {
    this.past = []
    this.future = []
  }

  /** Un objet n'existe plus (effacé par un administrateur…) : on retire ce qui s'y rapportait. */
  forget(id: string): void {
    const touches = (entry: Entry) => [...entry.undo, ...entry.redo].some((op) => op.id === id)
    this.past = this.past.filter((entry) => !touches(entry))
    this.future = this.future.filter((entry) => !touches(entry))
  }
}
