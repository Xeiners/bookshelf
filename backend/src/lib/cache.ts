interface Slot<V> {
  value: V
  expiresAt: number
}

/**
 * Cache mémoire à durée de vie, borné en taille (éviction de la plus ancienne
 * insertion) et avec déduplication des chargements concurrents : dix swipes qui
 * demandent la même page déclenchent une seule requête MangaDex.
 *
 * Suffisant pour une instance unique. Au-delà : Redis, même interface.
 */
export class TtlCache<V> {
  private readonly slots = new Map<string, Slot<V>>()
  private readonly inflight = new Map<string, Promise<V>>()
  private readonly maxEntries: number
  private readonly defaultTtlMs: number

  constructor(options: { maxEntries: number; ttlMs: number }) {
    this.maxEntries = options.maxEntries
    this.defaultTtlMs = options.ttlMs
  }

  get(key: string): V | undefined {
    const slot = this.slots.get(key)
    if (!slot) return undefined
    if (slot.expiresAt <= Date.now()) {
      this.slots.delete(key)
      return undefined
    }
    return slot.value
  }

  set(key: string, value: V, ttlMs = this.defaultTtlMs): void {
    this.slots.delete(key)
    this.slots.set(key, { value, expiresAt: Date.now() + ttlMs })
    while (this.slots.size > this.maxEntries) {
      const oldest = this.slots.keys().next().value
      if (oldest === undefined) break
      this.slots.delete(oldest)
    }
  }

  /** Renvoie la valeur en cache, ou la charge une seule fois pour tous les appelants. */
  async getOrLoad(key: string, load: () => Promise<V>, ttlMs = this.defaultTtlMs): Promise<V> {
    const cached = this.get(key)
    if (cached !== undefined) return cached

    const pending = this.inflight.get(key)
    if (pending) return pending

    const promise = load()
      .then((value) => {
        this.set(key, value, ttlMs)
        return value
      })
      .finally(() => this.inflight.delete(key))

    this.inflight.set(key, promise)
    return promise
  }
}
