import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { z } from 'zod'
import { HttpError } from '../../core/http/errors.js'
import { SESSION_COOKIE } from '../../core/security/session.js'
import { authenticate } from '../../core/security/sessionGuard.js'
import { cookieOf, originAllowed, refuse } from '../../core/security/socketAuth.js'
import { GUEST_COOKIE, readGuestCookie, type Participant } from '../dle/dle.guests.js'
import {
  STACK_MODES,
  createStackRoom,
  disconnectStack,
  joinStackRoom,
  leaveStackRoom,
  rematchStackRoom,
  setStackMode,
  startStackRoom,
  stackOver,
  stackTap,
  stackTick,
  sweepStackRooms,
  type Link,
} from './stack.rooms.js'

/*
 * WebSocket des salons de Page Stack (`/api/stack/ws`). Un compte (cookie de session) ou un
 * invité (cookie signé du BookshelfDLE). Messages JSON ; les gestes (`tk` toutes les ~50 ms,
 * `tp` à chaque page posée) sont relayés aux autres joueurs du salon par `stack.rooms.ts`.
 */

export const STACK_SOCKET_PATH = '/api/stack/ws'
const MAX_MESSAGE_BYTES = 1024
const MAX_CONNECTIONS = 400
/** Messages par seconde au plus (les `tk` à ~20/s laissent de la marge) ; au-delà, ils sont ignorés. */
const RATE_PER_SECOND = 40

const Message = z.discriminatedUnion('t', [
  z.object({ t: z.literal('create'), mode: z.enum(STACK_MODES) }),
  z.object({ t: z.literal('join'), code: z.string().max(20) }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('mode'), mode: z.enum(STACK_MODES) }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('rematch') }),
  z.object({ t: z.literal('tk'), x: z.number().finite(), d: z.union([z.literal(1), z.literal(-1)]), s: z.number().finite(), a: z.number().finite().optional() }),
  z.object({ t: z.literal('tp'), x: z.number().finite(), a: z.number().finite().optional() }),
  z.object({ t: z.literal('over'), score: z.number().finite(), pages: z.number().finite(), perfects: z.number().finite(), combo: z.number().finite() }),
])

let connections = 0
/** Connexions ouvertes par joueur : un compte ou un invité ne monopolise pas les places. */
const perPlayer = new Map<string, number>()
const MAX_PER_PLAYER = 3
/** Un pair muet (pas de « pong » en 2 battements) est coupé : sa place est rendue. */
const HEARTBEAT_MS = 30_000

/** Le joueur derrière une requête d'upgrade : un compte, sinon un invité ; `null` sans l'un ni l'autre. */
async function playerOf(request: IncomingMessage): Promise<Participant | null> {
  const userId = await authenticate(cookieOf(request.headers.cookie, SESSION_COOKIE)).catch(() => null)
  if (userId) return { id: userId, guest: null }
  const guest = readGuestCookie(cookieOf(request.headers.cookie, GUEST_COOKIE))
  return guest ? { id: guest.id, guest: { name: guest.name } } : null
}

function connect(ws: WebSocket, player: Participant): void {
  connections += 1
  perPlayer.set(player.id, (perPlayer.get(player.id) ?? 0) + 1)
  let alive = true
  ws.on('pong', () => {
    alive = true
  })
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate()
    alive = false
    ws.ping()
  }, HEARTBEAT_MS)
  heartbeat.unref?.()
  const link: Link = {
    send: (message) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
    },
    close: () => ws.close(4000, 'replaced'),
  }
  let windowStart = Date.now()
  let count = 0

  const report = (error: unknown) => {
    if (error instanceof HttpError) link.send({ t: 'err', code: error.code, message: error.message })
    else if (error instanceof Error && 'status' in error) link.send({ t: 'err', code: (error as { code?: string }).code ?? 'error', message: error.message })
    else console.error('[stack] message', error)
  }

  ws.on('message', (raw: RawData) => {
    const now = Date.now()
    if (now - windowStart >= 1000) {
      windowStart = now
      count = 0
    }
    if ((count += 1) > RATE_PER_SECOND) return
    let message: z.infer<typeof Message>
    try {
      message = Message.parse(JSON.parse(raw.toString()))
    } catch {
      return link.send({ t: 'err', code: 'bad_message', message: 'Message illisible.' })
    }
    void (async () => {
      switch (message.t) {
        case 'create': {
          const room = await createStackRoom(player, message.mode, link)
          return link.send({ t: 'room', room })
        }
        case 'join': {
          const room = await joinStackRoom(player, message.code, link)
          return link.send({ t: 'room', room })
        }
        case 'leave':
          return leaveStackRoom(player.id)
        case 'mode':
          return void setStackMode(player.id, message.mode)
        case 'start':
          return void (await startStackRoom(player.id))
        case 'rematch':
          return void rematchStackRoom(player.id)
        case 'tk':
          return stackTick(player.id, message.x, message.d, message.s, message.a)
        case 'tp':
          return stackTap(player.id, message.x, message.a)
        case 'over':
          return stackOver(player.id, message)
      }
    })().catch(report)
  })
  ws.on('error', () => undefined)
  ws.on('close', () => {
    clearInterval(heartbeat)
    connections -= 1
    const left = (perPlayer.get(player.id) ?? 1) - 1
    if (left > 0) perPlayer.set(player.id, left)
    else perPlayer.delete(player.id)
    disconnectStack(player.id, link)
  })
}

/** Branche le WebSocket des salons de Page Stack sur le serveur HTTP de l'API. */
export function attachStackSocket(server: Server): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false })
  const handler = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== STACK_SOCKET_PATH) return
    socket.on('error', () => undefined)
    void (async () => {
      if (!originAllowed(request)) return refuse(socket, 403, 'Forbidden')
      if (connections >= MAX_CONNECTIONS) return refuse(socket, 503, 'Busy')
      const player = await playerOf(request)
      if (!player) return refuse(socket, 401, 'Unauthorized')
      if ((perPlayer.get(player.id) ?? 0) >= MAX_PER_PLAYER) return refuse(socket, 429, 'Too Many')
      wss.handleUpgrade(request, socket, head, (ws) => connect(ws, player))
    })().catch((error) => {
      console.error('[stack] connexion', error)
      refuse(socket, 500, 'Error')
    })
  }
  server.on('upgrade', handler)
  const sweeper = setInterval(() => sweepStackRooms(), 10 * 60 * 1000)
  sweeper.unref?.()
  return () => {
    server.off('upgrade', handler)
    clearInterval(sweeper)
    for (const client of wss.clients) client.close(1001, 'shutdown')
    wss.close()
  }
}

