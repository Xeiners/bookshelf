import { API_BASE } from '../../services/api'

/*
 * La connexion de la toile : un WebSocket par onglet, qui se rétablit tout seul (attente de plus
 * en plus longue, jamais plus de 12 s). Les opérations (`op`, `ops`) attendent leur accusé ; le
 * curseur et les aperçus partent « au mieux » (perdus s'ils ne partent pas, ce n'est pas grave).
 */

export type SocketStatus = 'connecting' | 'open' | 'closed'

export interface Ack {
  t: 'ack'
  cid: number | null
  ok: boolean
  e?: string
  fails?: { id?: string; e: string }[]
}

type Message = { t: string; [field: string]: unknown }

export interface SocketHandlers {
  onStatus: (status: SocketStatus) => void
  onMessage: (message: Message) => void
}

export function socketUrl(): string {
  const base = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`
  return `${base.replace(/^http/, 'ws')}/canvas/ws`
}

export class CanvasSocket {
  private ws: WebSocket | null = null
  private status: SocketStatus = 'connecting'
  private attempts = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private nextCid = 1
  private readonly pending = new Map<number, { resolve: (ack: Ack) => void; timer: ReturnType<typeof setTimeout> }>()
  private readonly handlers: SocketHandlers

  constructor(handlers: SocketHandlers) {
    this.handlers = handlers
  }

  get open(): boolean {
    return this.status === 'open'
  }

  connect(): void {
    if (this.disposed || this.ws) return
    this.setStatus('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(socketUrl())
    } catch {
      this.scheduleRetry()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.attempts = 0
      this.setStatus('open')
    }
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as Message
        if (message.t === 'ack') this.settle(message as unknown as Ack)
        else this.handlers.onMessage(message)
      } catch {
        // Message illisible : ignoré.
      }
    }
    ws.onclose = () => {
      this.ws = null
      this.failPending()
      if (this.disposed) return
      this.setStatus('closed')
      this.scheduleRetry()
    }
    ws.onerror = () => undefined
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return
    this.status = status
    this.handlers.onStatus(status)
  }

  private scheduleRetry(): void {
    if (this.disposed || this.timer) return
    this.attempts += 1
    const wait = Math.min(12_000, 700 * 2 ** Math.min(this.attempts, 5)) * (0.75 + Math.random() * 0.5)
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, wait)
  }

  /** Reconnecte tout de suite (retour au premier plan, réseau revenu). */
  reconnectNow(): void {
    if (this.disposed || this.ws) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.connect()
  }

  /** Message sans accusé (curseur, aperçus, vue). */
  send(message: Message): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(message))
    return true
  }

  /** Opérations avec accusé : résout par la réponse du serveur (ou `ok: false` si la connexion tombe). */
  request(message: Message): Promise<Ack> {
    const cid = this.nextCid++
    return new Promise((resolve) => {
      if (!this.send({ ...message, cid })) {
        resolve({ t: 'ack', cid, ok: false, e: 'offline' })
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(cid)
        resolve({ t: 'ack', cid, ok: false, e: 'timeout' })
      }, 15_000)
      this.pending.set(cid, { resolve, timer })
    })
  }

  private settle(ack: Ack): void {
    if (ack.cid === null) return
    const entry = this.pending.get(ack.cid)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(ack.cid)
    entry.resolve(ack)
  }

  private failPending(): void {
    for (const [cid, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.resolve({ t: 'ack', cid, ok: false, e: 'offline' })
    }
    this.pending.clear()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.ws?.close()
    this.ws = null
    this.failPending()
  }
}
