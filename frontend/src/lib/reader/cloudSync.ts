/**
 * Synchronisation de la position de lecture d'un roman du compte — pure,
 * testée (`frontend/test/cloudSync.test.ts`).
 *
 * À chaque page tournée : la position (CFI) est écrite TOUT DE SUITE sur
 * l'appareil (lisible hors-ligne, survit à une fermeture brutale), puis
 * envoyée à l'API une seconde après le dernier mouvement. Hors-ligne, elle
 * reste « en attente » et repart dès que possible. Entre deux appareils, la
 * plus récente gagne (l'API arbitre aussi, cf. `saveProgress`).
 */
import type { CloudBook, CloudPosition } from '../../types/novel'

/** Délai après la dernière page tournée avant l'envoi à l'API. */
export const SYNC_DELAY_MS = 1000

/** Position enregistrée sur le serveur, `null` si le livre n'a jamais été ouvert. */
export function serverPosition(book: Pick<CloudBook, 'lastCfi' | 'progressPercent' | 'progressAt'>): CloudPosition | null {
  if (!book.lastCfi || book.progressAt === null) return null
  return { cfi: book.lastCfi, percent: book.progressPercent, at: book.progressAt }
}

/**
 * Où reprendre : la plus récente des deux positions. À égalité, celle du
 * serveur (c'est elle que les autres appareils voient).
 */
export function newestPosition(local: CloudPosition | null, server: CloudPosition | null): CloudPosition | null {
  if (!local) return server
  if (!server) return local
  return local.at > server.at ? local : server
}

/**
 * Avancement 0 → 100 (au dixième) d'après epub.js (0 → 1). `null` tant que
 * les positions du livre ne sont pas calculées : on garde alors le précédent
 * plutôt que d'écrire un 0 % trompeur sur le serveur.
 */
export function percentFrom(ratio: number | null, previous: number): number {
  if (ratio === null || !Number.isFinite(ratio)) return previous
  return Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10
}

export interface SyncTransport {
  /** Écrit la position sur l'appareil ; `pending` : pas encore confirmée par l'API. */
  persist: (position: CloudPosition, pending: boolean) => Promise<void> | void
  /**
   * Envoie la position à l'API (rejette hors-ligne). `keepalive` : l'envoi
   * doit survivre à la fermeture de la page.
   */
  send: (position: CloudPosition, options: { keepalive: boolean }) => Promise<unknown>
}

export interface SyncTimers {
  set: (callback: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

const browserTimers: SyncTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Position d'un roman ouvert : écriture locale immédiate, envoi à l'API regroupé. */
export class ProgressSync {
  private readonly transport: SyncTransport
  private readonly delayMs: number
  private readonly timers: SyncTimers
  private latest: CloudPosition | null = null
  /** `latest` n'a pas encore été confirmée par l'API. */
  private unsent = false
  private timer: unknown = null

  constructor(transport: SyncTransport, options: { delayMs?: number; timers?: SyncTimers } = {}) {
    this.transport = transport
    this.delayMs = options.delayMs ?? SYNC_DELAY_MS
    this.timers = options.timers ?? browserTimers
  }

  /** Nouvelle position (page tournée, saut dans le sommaire…). */
  push(position: CloudPosition): void {
    if (this.latest && this.latest.cfi === position.cfi && this.latest.percent === position.percent) return
    this.latest = position
    this.unsent = true
    void Promise.resolve(this.transport.persist(position, true)).catch(() => {})
    this.cancelTimer()
    this.timer = this.timers.set(() => {
      this.timer = null
      void this.flush()
    }, this.delayMs)
  }

  /**
   * Envoie maintenant la dernière position non confirmée. `true` si l'API l'a
   * reçue (ou s'il n'y avait rien à envoyer) ; `false` : elle reste en attente.
   */
  async flush(options: { keepalive?: boolean } = {}): Promise<boolean> {
    this.cancelTimer()
    const position = this.latest
    if (!position || !this.unsent) return true
    try {
      await this.transport.send(position, { keepalive: options.keepalive ?? false })
    } catch {
      return false
    }
    // Une page tournée pendant l'envoi reste à envoyer.
    if (this.latest === position) {
      this.unsent = false
      await Promise.resolve(this.transport.persist(position, false)).catch(() => {})
    }
    return true
  }

  get pending(): boolean {
    return this.unsent
  }

  get position(): CloudPosition | null {
    return this.latest
  }

  dispose(): void {
    this.cancelTimer()
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
  }
}
