import { API_BASE } from '../../services/api'

/*
 * Salons de Page Stack (cf. `backend/src/modules/stack/stack.rooms.ts`) : les types échangés par
 * WebSocket, et l'adresse du serveur.
 */

export type StackMode = 'versus' | 'coop'
export type StackPhase = 'lobby' | 'countdown' | 'playing' | 'over'

export interface StackRoomPlayer {
  id: string
  name: string | null
  avatarUrl: string | null
  avatar: { imageUrl: string; rarity: string } | null
  connected: boolean
  over: boolean
  score: number
  pages: number
}

export interface StackRanking {
  id: string
  score: number
  pages: number
  perfects: number
  bestCombo: number
  placed: number
}

export interface StackResults {
  mode: StackMode
  ranking: StackRanking[]
  winnerIds: string[]
  team: { score: number; pages: number; perfects: number; bestCombo: number } | null
}

export interface StackRoom {
  code: string
  mode: StackMode
  phase: StackPhase
  hostId: string
  max: number
  seed: number
  covers: number[]
  startsAt: number | null
  turn: string | null
  /** Heure du serveur à l'envoi. */
  now: number
  players: StackRoomPlayer[]
  results: StackResults | null
}

/** Gestes des autres joueurs, relayés par le serveur. */
export type StackRelay =
  | { k: 'tk'; p: string; x: number; d: 1 | -1; s: number }
  | { k: 'tp'; p: string; x: number; next: string | null }
  | { k: 'over'; p: string; score: number; pages: number; perfects: number; combo: number }
  | { k: 'turn'; p: string | null }

export type ServerMessage = { t: 'room'; room: StackRoom } | { t: 'ev'; e: StackRelay } | { t: 'err'; code: string; message: string }

export type ClientMessage =
  | { t: 'create'; mode: StackMode }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'mode'; mode: StackMode }
  | { t: 'start' }
  | { t: 'rematch' }
  | { t: 'tk'; x: number; d: 1 | -1; s: number }
  | { t: 'tp'; x: number }
  | { t: 'over'; score: number; pages: number; perfects: number; combo: number }

/** Couleur de chaque joueur d'un salon (pastille du nom, cadre du tour), dans l'ordre d'arrivée. */
export const PLAYER_COLORS = ['#ff8fb8', '#7ad7ff', '#ffd35c', '#8fffb0'] as const

export function socketUrl(): string {
  const base = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`
  return `${base.replace(/^http/, 'ws')}/stack/ws`
}

/* ---- Lien d'invitation `?stack=<code>` ------------------------------------------------ */

const PARAM = 'stack'

export const stackLink = (code: string, origin: string, pathname = '/') => `${origin}${pathname}?${PARAM}=${code}`

export function stackCodeFromSearch(search: string, parse: (value: string) => string | null): string | null {
  const value = new URLSearchParams(search).get(PARAM)
  return value ? parse(value) : null
}

export function withoutStackParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete(PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}
