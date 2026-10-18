import { config } from '../../config.js'
import { HttpError, conflict, notFound } from '../../lib/errors.js'
import { seededRandom, shuffle } from '../../lib/seeded.js'
import { normalizeRoomCode, roomCode, ROOM_CODE } from '../dle/dle.logic.js'
import { profileOf, type PlayerProfile } from '../dle/dle.rooms.js'
import type { Participant } from '../dle/dle.guests.js'
import { stackCovers, type StackCover } from './stack.covers.js'

/*
 * Salons de Page Stack, de 2 à 4 joueurs, en temps réel (WebSocket, cf. `stack.socket.ts`).
 *
 *  - VERSUS : chacun empile SA pile, en même temps, avec la même suite d'affiches ; les écrans
 *    sont partagés (chaque joueur voit celui des autres). Le meilleur score gagne.
 *  - COOP : une seule pile pour tous ; chacun pose une page à son tour (l'ordre d'arrivée).
 *
 * Chaque client fait tourner son moteur (`frontend/src/lib/stack/engine.ts`) : le serveur ne
 * simule rien, il RELAIE les gestes — la position de la page au moment d'un toucher, et un point
 * régulier pour la suivre — et arbitre ce qui doit l'être : qui est dans le salon, le départ,
 * le tour (coop), la fin de partie. Un salon n'accorde ni Poussières ni record : c'est un jeu entre amis.
 */

export const STACK_MODES = ['versus', 'coop'] as const
export type StackMode = (typeof STACK_MODES)[number]
export type StackPhase = 'lobby' | 'countdown' | 'playing' | 'over'

export const MAX_PLAYERS = 4
export const MIN_PLAYERS = 2
/** Entre l'appui sur « Lancer » et le départ : le temps de charger les affiches. */
export const COUNTDOWN_MS = config.env === 'test' ? 40 : 3500
/** Une partie versus s'arrête d'elle-même passé ce délai (le meilleur score du moment gagne) ; la coop est plus patiente. */
export const VERSUS_LIMIT_MS = 4 * 60 * 1000
export const COOP_LIMIT_MS = 20 * 60 * 1000
/** Tomes communs à tous les joueurs d'une partie. */
const COVERS_PER_GAME = 12
const IDLE_MS = 60 * 60 * 1000

/** Ce que le serveur sait d'un joueur : le dernier état annoncé ou le bilan final. */
interface RoomPlayer {
  id: string
  profile: PlayerProfile
  connected: boolean
  over: boolean
  score: number
  pages: number
  perfects: number
  bestCombo: number
  /** Pages posées par ce joueur (coop). */
  placed: number
}

/** Un canal vers un joueur (un WebSocket en production, un simple tableau en test). */
export interface Link {
  send: (message: ServerMessage) => void
  close: () => void
}

interface Room {
  code: string
  mode: StackMode
  hostId: string
  phase: StackPhase
  players: Map<string, RoomPlayer>
  links: Map<string, Link>
  seed: number
  covers: StackCover[]
  startsAt: number | null
  /** Coop : à qui de poser. */
  turn: string | null
  /** Coop : score et pages de la pile commune. */
  team: { score: number; pages: number; perfects: number; bestCombo: number }
  results: StackResults | null
  timer: ReturnType<typeof setTimeout> | null
  limit: ReturnType<typeof setTimeout> | null
  touchedAt: number
}

export interface StackRoomPlayerView {
  id: string
  name: string | null
  avatarUrl: string | null
  avatar: PlayerProfile['avatar']
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
  /** Coop : pages posées par ce joueur. */
  placed: number
}

export interface StackResults {
  mode: StackMode
  ranking: StackRanking[]
  /** Versus : les joueurs au meilleur score (plusieurs en cas d'égalité) ; coop : tous. */
  winnerIds: string[]
  team: { score: number; pages: number; perfects: number; bestCombo: number } | null
}

export interface StackRoomView {
  code: string
  mode: StackMode
  phase: StackPhase
  hostId: string
  max: number
  seed: number
  covers: StackCover[]
  /** Heure (ms, horloge du serveur) du départ de la partie. */
  startsAt: number | null
  turn: string | null
  /** Heure du serveur à l'envoi : les clients en déduisent leur écart d'horloge. */
  now: number
  players: StackRoomPlayerView[]
  results: StackResults | null
}

/** Gestes relayés aux autres joueurs. */
export type StackRelay =
  | { k: 'tk'; p: string; x: number; d: 1 | -1; s: number; a?: number }
  | { k: 'tp'; p: string; x: number; next: string | null; a?: number }
  | { k: 'over'; p: string; score: number; pages: number; perfects: number; combo: number }
  /** Coop : à qui le tour, annoncé à celui qui vient de poser (les autres le lisent dans `tp`). */
  | { k: 'turn'; p: string | null }

export type ServerMessage = { t: 'room'; room: StackRoomView } | { t: 'ev'; e: StackRelay } | { t: 'err'; code: string; message: string }

export type ClientMessage =
  | { t: 'create'; mode: StackMode }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'mode'; mode: StackMode }
  | { t: 'start' }
  | { t: 'tk'; x: number; d: 1 | -1; s: number; a?: number }
  | { t: 'tp'; x: number; a?: number }
  | { t: 'over'; score: number; pages: number; perfects: number; combo: number }
  | { t: 'rematch' }

const rooms = new Map<string, Room>()
/** Un joueur n'est que dans un salon à la fois. */
const memberships = new Map<string, string>()

/* ---- Vues ----------------------------------------------------------------------------- */

function viewOf(room: Room, now = Date.now()): StackRoomView {
  return {
    code: room.code,
    mode: room.mode,
    phase: room.phase,
    hostId: room.hostId,
    max: MAX_PLAYERS,
    seed: room.seed,
    covers: room.covers,
    startsAt: room.startsAt,
    turn: room.turn,
    now,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.profile.name,
      avatarUrl: player.profile.avatarUrl,
      avatar: player.profile.avatar,
      connected: player.connected,
      over: player.over,
      score: room.mode === 'coop' ? room.team.score : player.score,
      pages: room.mode === 'coop' ? player.placed : player.pages,
    })),
    results: room.results,
  }
}

function broadcast(room: Room): void {
  room.touchedAt = Date.now()
  const view = viewOf(room)
  for (const link of room.links.values()) link.send({ t: 'room', room: view })
}

function relay(room: Room, from: string, event: StackRelay): void {
  room.touchedAt = Date.now()
  for (const [id, link] of room.links) if (id !== from) link.send({ t: 'ev', e: event })
}

/* ---- Salons --------------------------------------------------------------------------- */

const newPlayer = (id: string, profile: PlayerProfile): RoomPlayer => ({ id, profile, connected: true, over: false, score: 0, pages: 0, perfects: 0, bestCombo: 0, placed: 0 })

function roomOf(code: string): Room {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) throw notFound('Salon introuvable.')
  return room
}

/** Le salon d'un joueur, s'il est dans l'un. */
export function currentStackRoom(playerId: string): string | null {
  const code = memberships.get(playerId)
  return code && rooms.has(code) ? code : null
}

export async function createStackRoom(participant: Participant, mode: StackMode, link: Link): Promise<StackRoomView> {
  leaveStackRoom(participant.id)
  const profile = await profileOf(participant)
  let code = roomCode(Math.random)
  while (rooms.has(code)) code = roomCode(Math.random)
  const room: Room = {
    code,
    mode,
    hostId: participant.id,
    phase: 'lobby',
    players: new Map([[participant.id, newPlayer(participant.id, profile)]]),
    links: new Map([[participant.id, link]]),
    seed: 0,
    covers: [],
    startsAt: null,
    turn: null,
    team: { score: 0, pages: 0, perfects: 0, bestCombo: 0 },
    results: null,
    timer: null,
    limit: null,
    touchedAt: Date.now(),
  }
  rooms.set(code, room)
  memberships.set(participant.id, code)
  return viewOf(room)
}

export async function joinStackRoom(participant: Participant, code: string, link: Link): Promise<StackRoomView> {
  const normalized = normalizeRoomCode(code)
  if (!ROOM_CODE.test(normalized)) throw notFound('Salon introuvable.')
  const room = roomOf(normalized)
  const existing = room.players.get(participant.id)
  if (existing) {
    // Retour dans le salon (autre onglet, connexion coupée puis reprise) : le canal est remplacé.
    room.links.get(participant.id)?.close()
    room.links.set(participant.id, link)
    existing.connected = true
    memberships.set(participant.id, room.code)
    broadcast(room)
    return viewOf(room)
  }
  if (room.phase !== 'lobby') throw conflict('La partie a déjà commencé.', 'room_started')
  if (room.players.size >= MAX_PLAYERS) throw conflict('Le salon est complet.', 'room_full')
  leaveStackRoom(participant.id)
  room.players.set(participant.id, newPlayer(participant.id, await profileOf(participant)))
  room.links.set(participant.id, link)
  memberships.set(participant.id, room.code)
  broadcast(room)
  return viewOf(room)
}

function clearTimers(room: Room): void {
  if (room.timer) clearTimeout(room.timer)
  if (room.limit) clearTimeout(room.limit)
  room.timer = null
  room.limit = null
}

function destroy(room: Room): void {
  clearTimers(room)
  for (const id of room.players.keys()) if (memberships.get(id) === room.code) memberships.delete(id)
  rooms.delete(room.code)
}

/** Quitter : dans le salon d'attente, on sort ; en pleine partie, on est éliminé (la pile reste visible des autres). */
export function leaveStackRoom(playerId: string): void {
  const code = memberships.get(playerId)
  const room = code ? rooms.get(code) : undefined
  memberships.delete(playerId)
  const player = room?.players.get(playerId)
  if (!room || !player) return
  room.links.delete(playerId)
  player.connected = false
  if (room.phase === 'lobby' || room.phase === 'over') {
    room.players.delete(playerId)
    if (room.players.size === 0 || [...room.players.values()].every((other) => !other.connected)) return destroy(room)
    if (room.hostId === playerId) room.hostId = [...room.players.values()].find((other) => other.connected)?.id ?? room.hostId
    broadcast(room)
  } else {
    eliminate(room, player)
  }
}

/** Coupure de connexion : en salon d'attente c'est un départ ; en partie, le joueur est éliminé (il peut revenir regarder). */
export function disconnectStack(playerId: string, link: Link): void {
  const code = memberships.get(playerId)
  const room = code ? rooms.get(code) : undefined
  if (!room || room.links.get(playerId) !== link) return
  const player = room.players.get(playerId)
  if (!player) return
  if (room.phase === 'lobby') return leaveStackRoom(playerId)
  room.links.delete(playerId)
  player.connected = false
  // L'hôte parti passe la main : c'est lui qui lance la revanche.
  if (room.hostId === playerId) room.hostId = [...room.players.values()].find((other) => other.connected)?.id ?? room.hostId
  if (room.phase === 'over') {
    if ([...room.players.values()].every((other) => !other.connected)) destroy(room)
    return
  }
  eliminate(room, player)
}

/** Un joueur sort de la partie (chute, départ, coupure) : la fin se décide ici. */
function eliminate(room: Room, player: RoomPlayer): void {
  if (room.phase !== 'playing' && room.phase !== 'countdown') return
  if (room.mode === 'versus') {
    player.over = true
    relay(room, player.id, { k: 'over', p: player.id, score: player.score, pages: player.pages, perfects: player.perfects, combo: player.bestCombo })
    return settle(room)
  }
  // Coop : la pile n'a plus personne à qui passer, ou le tour change.
  const alive = [...room.players.values()].filter((other) => other.connected)
  if (alive.length === 0) return finish(room)
  if (room.turn === player.id) {
    room.turn = nextTurn(room, player.id)
    broadcast(room)
  }
}

/** Versus : la partie s'arrête quand plus personne n'empile. */
function settle(room: Room): void {
  if (room.mode === 'versus' && [...room.players.values()].every((player) => player.over || !player.connected)) finish(room)
  else broadcast(room)
}

export function setStackMode(playerId: string, mode: StackMode): StackRoomView {
  const room = roomOf(memberships.get(playerId) ?? '')
  if (room.hostId !== playerId) throw new HttpError(403, 'not_host', 'Seul l’hôte change le mode.')
  if (room.phase !== 'lobby') throw conflict('La partie a déjà commencé.', 'room_started')
  room.mode = mode
  broadcast(room)
  return viewOf(room)
}

function resetRoom(room: Room): void {
  clearTimers(room)
  room.phase = 'lobby'
  room.startsAt = null
  room.turn = null
  room.results = null
  room.team = { score: 0, pages: 0, perfects: 0, bestCombo: 0 }
  for (const [id, player] of room.players) {
    if (!player.connected) {
      room.players.delete(id)
      continue
    }
    Object.assign(player, { over: false, score: 0, pages: 0, perfects: 0, bestCombo: 0, placed: 0 })
  }
  if (!room.players.has(room.hostId)) room.hostId = [...room.players.keys()][0] ?? room.hostId
}

/** Revanche : tout le monde retourne au salon d'attente (hôte seulement). */
export function rematchStackRoom(playerId: string): StackRoomView {
  const room = roomOf(memberships.get(playerId) ?? '')
  if (room.hostId !== playerId) throw new HttpError(403, 'not_host', 'Seul l’hôte relance une partie.')
  if (room.phase !== 'over') throw conflict('La partie n’est pas finie.', 'room_not_over')
  resetRoom(room)
  broadcast(room)
  return viewOf(room)
}

export async function startStackRoom(playerId: string): Promise<StackRoomView> {
  const room = roomOf(memberships.get(playerId) ?? '')
  if (room.hostId !== playerId) throw new HttpError(403, 'not_host', 'Seul l’hôte lance la partie.')
  if (room.phase !== 'lobby') throw conflict('La partie a déjà commencé.', 'room_started')
  if ([...room.players.values()].filter((player) => player.connected).length < MIN_PLAYERS) throw conflict('Il faut au moins deux joueurs.', 'not_enough_players')
  room.phase = 'countdown'
  room.seed = Math.floor(Math.random() * 2 ** 31)
  // Les mêmes tomes, dans le même ordre, pour tout le monde.
  const list = await stackCovers().catch(() => [])
  room.covers = shuffle(list, seededRandom(`stack:${room.seed}`)).slice(0, COVERS_PER_GAME)
  room.startsAt = Date.now() + COUNTDOWN_MS
  room.turn = room.mode === 'coop' ? ([...room.players.values()].find((player) => player.connected)?.id ?? null) : null
  broadcast(room)
  room.timer = setTimeout(() => {
    if (room.phase !== 'countdown') return
    room.phase = 'playing'
    broadcast(room)
    room.limit = setTimeout(() => finish(room), room.mode === 'coop' ? COOP_LIMIT_MS : VERSUS_LIMIT_MS)
    room.limit.unref?.()
  }, COUNTDOWN_MS)
  room.timer.unref?.()
  return viewOf(room)
}

function finish(room: Room): void {
  if (room.phase === 'over') return
  clearTimers(room)
  room.phase = 'over'
  const players = [...room.players.values()]
  const ranking: StackRanking[] = players
    .map((player) => ({ id: player.id, score: room.mode === 'coop' ? room.team.score : player.score, pages: player.pages, perfects: player.perfects, bestCombo: player.bestCombo, placed: player.placed }))
    .sort((a, b) => (room.mode === 'coop' ? b.placed - a.placed : b.score - a.score || b.pages - a.pages))
  const best = ranking[0]
  room.results = {
    mode: room.mode,
    ranking,
    winnerIds: room.mode === 'coop' ? ranking.map((entry) => entry.id) : ranking.filter((entry) => best && entry.score === best.score).map((entry) => entry.id),
    team: room.mode === 'coop' ? { ...room.team } : null,
  }
  room.turn = null
  broadcast(room)
}

/* ---- Gestes --------------------------------------------------------------------------- */

const clampX = (x: number): number => Math.min(1.6, Math.max(-0.6, x))
const clampCount = (value: number): number => Math.min(1_000_000, Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)))

/** Joueur suivant à qui poser, dans l'ordre d'arrivée, en sautant ceux qui sont partis. */
function nextTurn(room: Room, from: string): string | null {
  const order = [...room.players.keys()]
  const at = order.indexOf(from)
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(at + step + order.length) % order.length]
    if (candidate && room.players.get(candidate)?.connected) return candidate
  }
  return null
}

function playing(playerId: string): { room: Room; player: RoomPlayer } | null {
  const room = rooms.get(memberships.get(playerId) ?? '')
  const player = room?.players.get(playerId)
  if (!room || !player || room.phase !== 'playing') return null
  return { room, player }
}

/** Heure d'émission (horloge du salon, ms) renvoyée telle quelle : le récepteur en déduit le retard du trajet. Bornée à l'heure du serveur. */
function stamp(at: number | undefined): { a?: number } {
  if (at === undefined || !Number.isFinite(at)) return {}
  return { a: Math.min(Date.now(), Math.round(at)) }
}

/** Position de la page qui glisse (versus : la sienne ; coop : seulement celui dont c'est le tour). */
export function stackTick(playerId: string, x: number, d: 1 | -1, score: number, at?: number): void {
  const found = playing(playerId)
  if (!found || found.player.over) return
  const { room, player } = found
  if (room.mode === 'coop' && room.turn !== playerId) return
  if (room.mode === 'versus') player.score = clampCount(score)
  relay(room, playerId, { k: 'tk', p: playerId, x: clampX(x), d: d === -1 ? -1 : 1, s: clampCount(score), ...stamp(at) })
}

/** La page est posée là où elle se trouvait : relayé tel quel, les autres rejouent le geste. */
export function stackTap(playerId: string, x: number, at?: number): void {
  const found = playing(playerId)
  if (!found || found.player.over) return
  const { room, player } = found
  if (room.mode === 'coop') {
    if (room.turn !== playerId) return
    player.placed += 1
    const next = nextTurn(room, playerId)
    room.turn = next
    relay(room, playerId, { k: 'tp', p: playerId, x: clampX(x), next, ...stamp(at) })
    room.links.get(playerId)?.send({ t: 'ev', e: { k: 'turn', p: next } })
    return
  }
  relay(room, playerId, { k: 'tp', p: playerId, x: clampX(x), next: null, ...stamp(at) })
}

/** Bilan d'une pile qui s'écroule : versus, c'est celle du joueur ; coop, celle de tous (la partie est finie). */
export function stackOver(playerId: string, stats: { score: number; pages: number; perfects: number; combo: number }): void {
  const found = playing(playerId)
  if (!found || found.player.over) return
  const { room, player } = found
  const score = clampCount(stats.score)
  const pages = clampCount(stats.pages)
  const perfects = Math.min(pages, clampCount(stats.perfects))
  const combo = clampCount(stats.combo)
  if (room.mode === 'coop') {
    // Seul celui dont c'est le tour fait tomber la pile commune.
    if (room.turn !== playerId) return
    room.team = { score, pages, perfects, bestCombo: combo }
    for (const other of room.players.values()) other.over = true
    relay(room, playerId, { k: 'over', p: playerId, score, pages, perfects, combo })
    return finish(room)
  }
  Object.assign(player, { over: true, score, pages, perfects, bestCombo: combo })
  relay(room, playerId, { k: 'over', p: playerId, score, pages, perfects, combo })
  settle(room)
}

/* ---- Entretien ------------------------------------------------------------------------ */

/** Salons laissés à l'abandon. */
export function sweepStackRooms(now = Date.now()): void {
  for (const room of rooms.values()) if (now - room.touchedAt > IDLE_MS) destroy(room)
}

/** Pour les tests. */
export function forgetStackRooms(): void {
  for (const room of rooms.values()) clearTimers(room)
  rooms.clear()
  memberships.clear()
}

export const stackRoomView = (code: string): StackRoomView | null => {
  const room = rooms.get(normalizeRoomCode(code))
  return room ? viewOf(room) : null
}
