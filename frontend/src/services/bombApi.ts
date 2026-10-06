import type { Rarity } from '../lib/boosters'
import { API_BASE, api } from './api'

/** Anime Bomb Party (cf. `backend/src/modules/bomb`). */

export const BOMB_MODES = ['classic', 'manga'] as const
export type BombMode = (typeof BOMB_MODES)[number]

export type WordRefusal = 'short' | 'syllable' | 'unknown' | 'used' | 'late'
export type WordVerdict = { ok: true; key: string; display: string } | { ok: false; reason: WordRefusal }

export interface BombReward {
  reward: number
  capped: boolean
  balance: number
  receipts: string[]
  record: boolean
  best: number
}

export interface BombRecords {
  bestClassic: number
  bestManga: number
  games: number
  wins: number
  earnedToday: number
  dailyCap: number
}

export interface BombOverview {
  records: BombRecords
  currentRoom: string | null
}

export interface SoloView {
  id: string
  mode: BombMode
  syllable: string
  lives: number
  words: number
  fuseMs: number
  /** Explosion, à l'heure du serveur (ms). */
  fuseEndsAt: number
  serverTime: number
  missed: { syllable: string; example: string | null; at: number } | null
  over: (BombReward & { words: number }) | null
}

export type BombEventKind = 'word' | 'fail' | 'explode' | 'eliminated' | 'join' | 'leave'

export interface BombEvent {
  id: number
  kind: BombEventKind
  playerId: string
  word?: string
  reason?: WordRefusal
  syllable?: string
  example?: string | null
  at: number
}

export interface BombPlayer {
  id: string
  name: string | null
  avatarUrl: string | null
  avatar: { imageUrl: string; rarity: Rarity } | null
  lives: number
  alive: boolean
  words: number
  connected: boolean
}

export type BombPhase = 'lobby' | 'countdown' | 'playing' | 'over'

export interface BombRoomView {
  code: string
  mode: BombMode
  phase: BombPhase
  hostId: string
  players: BombPlayer[]
  turn: string | null
  syllable: string | null
  fuseMs: number
  fuseEndsAt: number
  startsAt: number
  serverTime: number
  typing: { playerId: string; text: string } | null
  events: BombEvent[]
  winnerId: string | null
  mine: BombReward | null
  limits: { min: number; max: number }
}

const room = (code: string) => `/bomb/rooms/${encodeURIComponent(code)}`

export const bombApi = {
  overview: () => api<BombOverview>('/bomb'),
  startSolo: (mode: BombMode) => api<SoloView>('/bomb/solo', { method: 'POST', body: { mode } }),
  soloWord: (id: string, word: string) => api<{ verdict: WordVerdict | null; view: SoloView }>(`/bomb/solo/${id}/word`, { method: 'POST', body: { word } }),
  soloExplode: (id: string) => api<SoloView>(`/bomb/solo/${id}/explode`, { method: 'POST' }),
  soloQuit: (id: string) => api<SoloView>(`/bomb/solo/${id}/quit`, { method: 'POST' }),

  createRoom: (mode: BombMode) => api<BombRoomView>('/bomb/rooms', { method: 'POST', body: { mode } }),
  joinRoom: (code: string) => api<BombRoomView>(`${room(code)}/join`, { method: 'POST' }),
  leaveRoom: (code: string) => api<void>(`${room(code)}/leave`, { method: 'POST' }),
  setMode: (code: string, mode: BombMode) => api<BombRoomView>(`${room(code)}/mode`, { method: 'POST', body: { mode } }),
  start: (code: string) => api<BombRoomView>(`${room(code)}/start`, { method: 'POST' }),
  typing: (code: string, text: string) => api<void>(`${room(code)}/typing`, { method: 'POST', body: { text } }),
  word: (code: string, word: string) => api<{ verdict: WordVerdict; view: BombRoomView }>(`${room(code)}/word`, { method: 'POST', body: { word } }),
  /** Flux temps réel du salon (Server-Sent Events) : l'état à chaque changement, la frappe en direct. */
  stream: (code: string) => new EventSource(`${API_BASE}${room(code)}/stream`, { withCredentials: true }),
}
