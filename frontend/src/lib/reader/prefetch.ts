/**
 * Logique de préchargement des pages — pure et testée (`frontend/test/prefetch.test.ts`).
 * Exécutée dans un Web Worker (`workers/prefetch.worker.ts`) : les téléchargements
 * ne disputent jamais le fil principal aux gestes et aux animations.
 */

export interface PrefetchOptions {
  /** Pages suivantes, prioritaires (sens de lecture). */
  ahead?: number
  /** Pages précédentes : un retour en arrière reste instantané. */
  behind?: number
  /**
   * Tout le chapitre, après la fenêtre prioritaire : il reste lisible
   * hors-ligne une fois chargé (cf. cache du Service Worker).
   */
  whole?: boolean
}

/**
 * Index à précharger, du plus urgent au moins urgent : les `ahead` pages
 * suivantes, puis les `behind` précédentes, puis (option `whole`) le reste du
 * chapitre, en avançant d'abord.
 */
export function prefetchOrder(current: number, total: number, { ahead = 4, behind = 1, whole = false }: PrefetchOptions = {}): number[] {
  if (total <= 0) return []
  const start = Math.min(Math.max(0, current), total - 1)
  const order: number[] = []
  const seen = new Set<number>([start])
  const add = (index: number) => {
    if (index < 0 || index >= total || seen.has(index)) return
    seen.add(index)
    order.push(index)
  }
  for (let step = 1; step <= ahead; step += 1) add(start + step)
  for (let step = 1; step <= behind; step += 1) add(start - step)
  if (whole) {
    for (let index = start + 1; index < total; index += 1) add(index)
    for (let index = start - 1; index >= 0; index -= 1) add(index)
  }
  return order
}

export type PrefetchLoader = (url: string, signal: AbortSignal) => Promise<void>

export interface PrefetchEvents {
  onLoaded?: (url: string) => void
  onFailed?: (url: string) => void
}

/**
 * File de téléchargements à priorité, dédupliquée et annulable.
 *
 * - `update(urls)` remplace la liste d'attente (ordre = priorité) ; un
 *   téléchargement en cours qui n'y figure plus est annulé (l'utilisateur a
 *   sauté vingt pages : inutile de finir l'ancienne fenêtre).
 * - Une URL chargée ne l'est jamais deux fois ; une URL en échec est retentée
 *   seulement si elle revient dans une liste ultérieure.
 * - `concurrency` borne les téléchargements simultanés : la page affichée garde
 *   la bande passante.
 */
export class PrefetchQueue {
  private readonly load: PrefetchLoader
  private readonly concurrency: number
  private readonly events: PrefetchEvents
  private readonly loaded = new Set<string>()
  private readonly inflight = new Map<string, AbortController>()
  private pending: string[] = []
  private disposed = false

  constructor(load: PrefetchLoader, options: { concurrency?: number } & PrefetchEvents = {}) {
    this.load = load
    this.concurrency = Math.max(1, options.concurrency ?? 2)
    this.events = { onLoaded: options.onLoaded, onFailed: options.onFailed }
  }

  update(urls: readonly string[]): void {
    if (this.disposed) return
    const wanted = new Set(urls)
    for (const [url, controller] of this.inflight) {
      if (!wanted.has(url)) {
        controller.abort()
        this.inflight.delete(url)
      }
    }
    this.pending = [...wanted].filter((url) => !this.loaded.has(url) && !this.inflight.has(url))
    this.pump()
  }

  /** Marque une URL comme déjà chargée (ex. affichée par le lecteur). */
  markLoaded(url: string): void {
    this.loaded.add(url)
    this.pending = this.pending.filter((pending) => pending !== url)
  }

  isLoaded(url: string): boolean {
    return this.loaded.has(url)
  }

  get size(): { pending: number; inflight: number; loaded: number } {
    return { pending: this.pending.length, inflight: this.inflight.size, loaded: this.loaded.size }
  }

  dispose(): void {
    this.disposed = true
    for (const controller of this.inflight.values()) controller.abort()
    this.inflight.clear()
    this.pending = []
  }

  private pump(): void {
    while (!this.disposed && this.inflight.size < this.concurrency && this.pending.length > 0) {
      const url = this.pending.shift()
      if (url === undefined || this.loaded.has(url) || this.inflight.has(url)) continue
      const controller = new AbortController()
      this.inflight.set(url, controller)
      this.load(url, controller.signal).then(
        () => this.settle(url, controller, true),
        () => this.settle(url, controller, false),
      )
    }
  }

  private settle(url: string, controller: AbortController, ok: boolean): void {
    // Annulé entre-temps (ou remplacé par un nouveau téléchargement) : on ne rapporte rien.
    if (this.inflight.get(url) !== controller) return
    this.inflight.delete(url)
    if (ok) {
      this.loaded.add(url)
      this.events.onLoaded?.(url)
    } else {
      this.events.onFailed?.(url)
    }
    this.pump()
  }
}
