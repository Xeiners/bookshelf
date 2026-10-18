import { create } from 'zustand'
import { socketUrl, type ClientMessage, type ServerMessage, type StackMode, type StackRelay, type StackRoom } from '../lib/stack/net'

/*
 * Salon de Page Stack : un WebSocket par onglet, ouvert à la demande (créer ou rejoindre un
 * salon), fermé en le quittant. Le salon vient du serveur ; les gestes des autres joueurs sont
 * transmis tels quels à l'arène (`onRelay`), qui les rejoue sur leur pile.
 *
 * Sur téléphone, changer d'appli (pour envoyer le lien d'invitation) coupe le WebSocket, voire
 * recharge la page : le code du salon est gardé (onglet) et le salon est rejoint de nouveau, tout
 * seul, à la reconnexion ou au retour sur la page. Le serveur garde la place quelques minutes.
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
/** Salon à retrouver si la connexion tombe ; `null` une fois quitté. */
let activeCode: string | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let attempts = 0
/** Reprise en cours : une erreur « introuvable » veut dire que le salon a disparu. */
let rejoining = false
let hiddenSince: number | null = null
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

const STORAGE_KEY = 'bookshelf:stack:room'
/** Un salon abandonné depuis plus longtemps que ça n'est plus repris. */
const REMEMBER_MS = 10 * 60 * 1000
/** Après tant de tentatives sans succès, on renonce. */
const MAX_ATTEMPTS = 40

function remember(code: string | null): void {
  activeCode = code
  try {
    if (code) sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ code, at: Date.now() }))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Stockage indisponible : la reprise après rechargement n'aura pas lieu, le reste fonctionne.
  }
}

/** Salon laissé par une page rechargée (appli changée, onglet recyclé), s'il est assez récent. */
function recalled(): string | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as { code?: unknown; at?: unknown } | null
    if (stored && typeof stored.code === 'string' && typeof stored.at === 'number' && Date.now() - stored.at < REMEMBER_MS) return stored.code
  } catch {
    // Valeur illisible : ignorée.
  }
  return null
}

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
      if (message.t === 'room') {
        rejoining = false
        attempts = 0
        remember(message.room.code)
        set({ room: message.room, clockOffset: bestOffset(message.room.now) })
      } else if (message.t === 'ev') relayHandler?.(message.e)
      else if (rejoining && message.code === 'not_found') {
        // Le salon n'existe plus (délai dépassé, serveur redémarré) : fin de la reprise.
        rejoining = false
        remember(null)
        set({ room: null, error: message.code })
      } else set({ error: message.code })
    }
    ws.onclose = () => {
      if (socket === ws) {
        socket = null
        if (activeCode) scheduleRejoin(set)
        else set({ status: 'closed' })
      }
      reject(new Error('closed'))
    }
    ws.onerror = () => undefined
  })
}

/** Rouvre le canal et rejoint le salon retenu ; sans succès, on réessaie un peu plus tard. */
function scheduleRejoin(set: (partial: Partial<StackRoomState>) => void, immediately = false): void {
  if (!activeCode) return
  if (retryTimer) clearTimeout(retryTimer)
  if (attempts >= MAX_ATTEMPTS) {
    set({ status: 'closed' })
    return
  }
  set({ status: 'connecting' })
  const delay = immediately || attempts === 0 ? 0 : Math.min(5000, 800 * attempts)
  attempts += 1
  retryTimer = setTimeout(() => {
    retryTimer = null
    const code = activeCode
    if (!code) return
    rejoining = true
    open(set)
      .then((ws) => ws.send(JSON.stringify({ t: 'join', code } satisfies ClientMessage)))
      .catch(() => undefined)
  }, delay)
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
    pendingCode: recalled(),

    setPendingCode: (pendingCode) => set({ pendingCode }),
    clearError: () => set({ error: null }),

    create: async (mode) => {
      remember(null)
      set({ room: null })
      await open(set)
      send({ t: 'create', mode })
    },
    join: async (code) => {
      remember(null)
      rejoining = false
      set({ room: null })
      await open(set)
      send({ t: 'join', code })
    },
    leave: () => {
      remember(null)
      rejoining = false
      attempts = 0
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
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

// Retour sur la page (autre appli quittée, réseau revenu) : si la connexion est tombée, ou risque d'être
// un fantôme après une longue veille, on rejoint le salon tout de suite plutôt que d'attendre.
function resume(): void {
  if (!activeCode) return
  const long = hiddenSince !== null && Date.now() - hiddenSince > 3000
  hiddenSince = null
  const state = useStackRoom
  const set = (partial: Partial<StackRoomState>) => state.setState(partial)
  if (socket?.readyState === WebSocket.OPEN && !long) return
  const ghost = socket
  socket = null
  if (ghost) {
    ghost.onclose = null
    ghost.close()
  }
  attempts = 0
  scheduleRejoin(set, true)
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenSince = Date.now()
    else resume()
  })
  window.addEventListener('online', resume)
  window.addEventListener('pageshow', resume)
}
