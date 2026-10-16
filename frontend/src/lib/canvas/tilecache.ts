import { API_BASE } from '../../services/api'

/*
 * Les tuiles raster du serveur, côté client : chargées à la demande (quelques-unes à la fois,
 * les plus proches du centre d'abord), gardées en mémoire (plafonnée). Une tuile modifiée voit sa
 * version changer (`bump`) : elle est rechargée, l'ancienne image reste affichée en attendant.
 */

export const TILE_BASE = 1024
const MAX_BITMAPS = 160
const MAX_PARALLEL = 4

interface Entry {
  bitmap: ImageBitmap | null
  /** Le serveur a répondu « rien ici ». */
  empty: boolean
  /** Version de l'image affichée / version attendue. */
  have: number
  want: number
  loading: boolean
  used: number
  failedAt: number
}

export const tileKey = (level: number, x: number, y: number) => `${level}/${x}/${y}`
export const tileSize = (level: number) => TILE_BASE * 2 ** level

export class TileCache {
  private readonly entries = new Map<string, Entry>()
  private queue: { key: string; level: number; x: number; y: number; priority: number }[] = []
  private running = 0
  private clock = 0
  private disposed = false

  private readonly onChange: () => void

  constructor(onChange: () => void) {
    this.onChange = onChange
  }

  /** L'entrée d'une tuile ; lance son chargement si on ne la connaît pas encore (`priority` : distance au centre). */
  get(level: number, x: number, y: number, priority = 0): Entry {
    const key = tileKey(level, x, y)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { bitmap: null, empty: false, have: -1, want: 0, loading: false, used: 0, failedAt: 0 }
      this.entries.set(key, entry)
    }
    entry.used = this.clock += 1
    if (entry.have < entry.want || (entry.have < 0 && !entry.loading)) this.request(key, level, x, y, priority, entry)
    return entry
  }

  /** Lecture sans lancer de chargement (pour les images de repli). */
  peek(level: number, x: number, y: number): Entry | undefined {
    return this.entries.get(tileKey(level, x, y))
  }

  /** Le serveur annonce une nouvelle version de cette tuile. */
  bump(level: number, x: number, y: number, version: number): void {
    const entry = this.entries.get(tileKey(level, x, y))
    if (!entry) return
    entry.want = Math.max(entry.want, version)
    this.onChange()
  }

  private request(key: string, level: number, x: number, y: number, priority: number, entry: Entry): void {
    if (entry.loading || Date.now() - entry.failedAt < 4000) return
    entry.loading = true
    this.queue = this.queue.filter((job) => job.key !== key)
    this.queue.push({ key, level, x, y, priority })
    this.pump()
  }

  private pump(): void {
    while (this.running < MAX_PARALLEL && this.queue.length > 0) {
      this.queue.sort((a, b) => a.priority - b.priority)
      const job = this.queue.shift()!
      this.running += 1
      void this.load(job.key, job.level, job.x, job.y).finally(() => {
        this.running -= 1
        this.pump()
      })
    }
  }

  private async load(key: string, level: number, x: number, y: number): Promise<void> {
    const entry = this.entries.get(key)
    if (!entry || this.disposed) return
    const wanted = entry.want
    try {
      const response = await fetch(`${API_BASE}/canvas/tiles/${level}/${x}/${y}.png?v=${wanted}`, { credentials: 'include' })
      if (response.status === 204) {
        entry.bitmap?.close()
        entry.bitmap = null
        entry.empty = true
      } else if (response.ok) {
        const bitmap = await createImageBitmap(await response.blob())
        entry.bitmap?.close()
        entry.bitmap = bitmap
        entry.empty = false
      } else {
        throw new Error(String(response.status))
      }
      entry.have = wanted
      entry.failedAt = 0
    } catch {
      entry.failedAt = Date.now()
    } finally {
      entry.loading = false
    }
    this.trim()
    if (!this.disposed) this.onChange()
  }

  /** Oublie les plus anciennes images au-delà du plafond. */
  private trim(): void {
    if (this.entries.size <= MAX_BITMAPS) return
    const old = [...this.entries.entries()].filter(([, entry]) => !entry.loading).sort((a, b) => a[1].used - b[1].used)
    for (const [key, entry] of old.slice(0, this.entries.size - MAX_BITMAPS)) {
      entry.bitmap?.close()
      this.entries.delete(key)
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.bitmap?.close()
    this.entries.clear()
    this.queue = []
  }

  dispose(): void {
    this.disposed = true
    this.clear()
  }
}
