import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { config } from '../config.js'

/* Aides communes aux WebSocket de l'API (la toile, Page Stack) : cookie, origine, refus propre. */

export function cookieOf(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/** Un navigateur envoie toujours `Origin` : il doit être celui du site (ou d'une origine autorisée). */
export function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (!origin) return true
  try {
    const url = new URL(origin)
    // Derrière Caddy puis Nginx, `Host` peut avoir perdu son port : on accepte aussi l'hôte annoncé par le proxy.
    const forwarded = String(request.headers['x-forwarded-host'] ?? '').split(',')[0]?.trim()
    if (url.host === request.headers.host || (forwarded && url.host === forwarded)) return true
  } catch {
    return false
  }
  return config.corsOrigins.includes(origin)
}

export function refuse(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

