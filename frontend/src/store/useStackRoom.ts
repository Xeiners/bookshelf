import { create } from 'zustand'
import { socketUrl, type ClientMessage, type ServerMessage, type StackMode, type StackRelay, type StackRoom } from '../lib/stack/net'

/*
 * Salon de Page Stack : un WebSocket par onglet, ouvert à la demande (créer ou rejoindre un
 * salon), fermé en le quittant. Le salon vient du serveur ; les gestes des autres joueurs sont
 * transmis tels quels à l'arène (`onRelay`), qui les rejoue sur leur pile.
 */

type Status = 'idle' | 'connecting' | 'open' | 'closed'

interface StackRoomState {
  status: Status
  room: StackRoom | null
  /** Écart d'horloge : heure du serveur moins heure locale (ms). */
  clockOffset: number
  /** Dernière erreur du serveur (`room_full`, `room_started`, `not_found`…), pour l'afficher une fois. */
  error: string | null
  /** Code d'invitation reçu par lien : le salon se rejoint à l'ouverture de Page Stack. */
  pendingCode: string | null

  setPendingCode: (code: string | null) => void
  clearError: () => void
  create: (mode: StackMode) => Promise<void>
  join: (code: string) => Promise<void>
  leave: () => void
  setMode: (mode: StackMode) => void
  start: () => void
  rematch: () => void
  tick: (x: number, d: 1 | -1, score: number) => void
  tap: (x: number) => void
  over: (stats: { score: number; pages: number; perfects: number; combo: number }) => void
  /** L'arène s'abonne aux gestes des autres joueurs. */
  onRelay: (handler: ((event: StackRelay) => void) | null) => void
}

let socket: WebSocket | null = null
let relayHandler: ((event: StackRelay) => void) | null = null

/** Écart entre l'horloge du serveur et la mienne : le meilleur échantillon (le plus grand) est celui du trajet le plus court. */
let offset: number | null = null
function bestOffset(serverNow: number): number {
  const sample = serverNow - Date.now()
  offset = offset === null ? sample : Math.max(offset, sample)
  return offset
}
/** Heure du serveur à l'instant présent, jointe à chaque geste pour que les autres compensent le trajet. */
const sentAt = (): number => Math.round(Date.now() + (offset ?? 0))

function open(set: (partial: Partial<StackRoomState>) => void): Promise<WebSocket> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket)
  socket?.close()
  set({ status: 'connecting', error: null })
  offset = null
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl())
    socket = ws
    ws.onopen = () => {
      set({ status: 'open' })
      resolve(ws)
    }
    ws.onmessage = (event) => {
      let message: ServerMessage
      try {
        message = JSON.parse(String(event.data)) as ServerMessage
      } catch {
        return
      }
      if (message.t === 'room') set({ room: message.room, clockOffset: bestOffset(message.room.now) })
      else if (message.t === 'ev') relayHandler?.(message.e)
      else set({ error: message.code })
    }
    ws.onclose = () => {
      if (socket === ws) {
        socket = null
        set({ status: 'closed' })
      }
      reject(new Error('closed'))
    }
    ws.onerror = () => undefined
  })
}

export const useStackRoom = create<StackRoomState>((set) => {
  const send = (message: ClientMessage): boolean => {
    if (socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }
  return {
    status: 'idle',
    room: null,
    clockOffset: 0,
    error: null,
    pendingCode: null,

    setPendingCode: (pendingCode) => set({ pendingCode }),
    clearError: () => set({ error: null }),

    create: async (mode) => {
      set({ room: null })
      await open(set)
      send({ t: 'create', mode })
    },
    join: async (code) => {
      set({ room: null })
      await open(set)
      send({ t: 'join', code })
    },
    leave: () => {
      send({ t: 'leave' })
      const ws = socket
      socket = null
      ws?.close()
      set({ room: null, status: 'idle', error: null })
    },
    setMode: (mode) => void send({ t: 'mode', mode }),
    start: () => void send({ t: 'start' }),
    rematch: () => void send({ t: 'rematch' }),
    tick: (x, d, s) => void send({ t: 'tk', x: Math.round(x * 10_000) / 10_000, d, s, a: sentAt() }),
    tap: (x) => void send({ t: 'tp', x: Math.round(x * 10_000) / 10_000, a: sentAt() }),
    over: ({ score, pages, perfects, combo }) => void send({ t: 'over', score, pages, perfects, combo }),
    onRelay: (handler) => {
      relayHandler = handler
    },
  }
})
