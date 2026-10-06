import type { Response } from 'express'
import { HttpError, conflict, notFound } from '../../lib/errors.js'
import type { Participant } from '../dle/dle.guests.js'
import { roomCode } from '../dle/dle.logic.js'
import { profileOf, type PlayerProfile } from '../dle/dle.rooms.js'
import { checkWord, lexiconOf, normalizeWord, type BombMode, type Lexicon, type WordVerdict } from './bomb.dictionary.js'
import { LIVES, MAX_PLAYERS, MAX_WORD_LENGTH, MIN_PLAYERS, fuseMs, pickSyllable, rememberSyllable, timing, versusReward } from './bomb.logic.js'
import { settleGame, type BombReward } from './bomb.stats.js'

/*
 * Salons de l'Anime Bomb Party, en mémoire (comme ceux du BookshelfDLE).
 *
 * Temps réel par Server-Sent Events : chaque joueur garde un flux ouvert
 * (`GET …/stream`) où le serveur pousse l'état du salon à chaque changement, et la
 * frappe du joueur qui tient la bombe, lettre par lettre (`typing`). Les actions partent
 * en requêtes ordinaires. Un flux HTTP passe par Nginx et Caddy sans configuration
 * particulière (contrairement à un WebSocket) ; `X-Accel-Buffering: no` empêche Nginx de
 * le retenir, un battement toutes les 15 s le garde ouvert.
 *
 * Le SERVEUR arbitre tout : le tour, la syllabe, la mèche (un minuteur à son heure), les
 * mots déjà joués, les vies. Le dernier joueur en vie gagne.
 */

type Phase = 'lobby' | 'countdown' | 'playing' | 'over'

interface RoomPlayer {
  id: string
  profile: PlayerProfile
  lives: number
  /** En jeu dans la partie en cours (un joueur arrivé en cours de partie regarde). */
  alive: boolean
  words: number
  /** Flux ouverts (onglets) : 0 = déconnecté. */
  streams: number
}

export type BombEventKind = 'word' | 'fail' | 'explode' | 'eliminated' | 'join' | 'leave'

export interface BombEvent {
  id: number
  kind: BombEventKind
  playerId: string
  /** `word` : le nom affiché (mode Manga) ou le mot ; `fail` : le mot refusé. */
  word?: string
  reason?: Exclude<WordVerdict, { ok: true }>['reason'] | 'late'
  syllable?: string
  /** `explode` : un mot qui aurait marché. */
  example?: string | null
  at: number
}

interface Subscriber {
  playerId: string
  res: Response
  heartbeat: NodeJS.Timeout
}

interface Room {
  code: string
  mode: BombMode
  hostId: string
  players: Map<string, RoomPlayer>
  phase: Phase
  turn: string | null
  syllable: string
  recent: string[]
  fuseMs: number
  fuseEndsAt: number
  startsAt: number
  used: Set<string>
  progress: number
  typing: string
  events: BombEvent[]
  eventSeq: number
  winnerId: string | null
  /** Joueurs au départ de la partie : eux seuls sont récompensés (records, Poussières). */
  participants: Set<string>
  rewards: Map<string, BombReward>
  lexicon: Lexicon | null
  timer: NodeJS.Timeout | null
  subscribers: Set<Subscriber>
  touchedAt: number
}

export interface BombRoomPlayerView {
  id: string
  name: string | null
  avatarUrl: string | null
  avatar: PlayerProfile['avatar']
  lives: number
  alive: boolean
  words: number
  connected: boolean
}

export interface BombRoomView {
  code: string
  mode: BombMode
  phase: Phase
  hostId: string
  players: BombRoomPlayerView[]
  turn: string | null
  syllable: string | null
  fuseMs: number
  fuseEndsAt: number
  startsAt: number
  serverTime: number
  typing: { playerId: string; text: string } | null
  events: BombEvent[]
  winnerId: string | null
  /** Ma récompense de la partie terminée (reçus d'invité compris : jamais ceux des autres). */
  mine: BombReward | null
  limits: { min: number; max: number }
}

const rooms = new Map<string, Room>()
const HEARTBEAT_MS = 15_000
const ABANDONED_MS = 3 * 60 * 1000
const MAX_EVENTS = 8

/* ---- Vue et diffusion ---------------------------------------------------------------- */

function viewFor(room: Room, playerId: string): BombRoomView {
  const playing = room.phase === 'playing'
  return {
    code: room.code,
    mode: room.mode,
    phase: room.phase,
    hostId: room.hostId,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.profile.name,
      avatarUrl: player.profile.avatarUrl,
      avatar: player.profile.avatar,
      lives: player.lives,
      alive: player.alive,
      words: player.words,
      connected: player.streams > 0,
    })),
    turn: playing ? room.turn : null,
    syllable: playing ? room.syllable : null,
    fuseMs: room.fuseMs,
    fuseEndsAt: room.fuseEndsAt,
    startsAt: room.startsAt,
    serverTime: Date.now(),
    typing: playing && room.turn && room.typing ? { playerId: room.turn, text: room.typing } : null,
    events: room.events.slice(-6),
    winnerId: room.winnerId,
    mine: room.rewards.get(playerId) ?? null,
    limits: { min: MIN_PLAYERS, max: MAX_PLAYERS },
  }
}

const send = (subscriber: Subscriber, event: string, data: unknown) => {
  if (!subscriber.res.writableEnded) subscriber.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function broadcast(room: Room): void {
  room.touchedAt = Date.now()
  for (const subscriber of room.subscribers) send(subscriber, 'state', viewFor(room, subscriber.playerId))
}

function pushEvent(room: Room, event: Omit<BombEvent, 'id' | 'at'>): void {
  room.eventSeq += 1
  room.events = [...room.events, { ...event, id: room.eventSeq, at: Date.now() }].slice(-MAX_EVENTS)
}

/* ---- Accès ------------------------------------------------------------------------------ */

function roomOf(code: string): Room {
  const room = rooms.get(code)
  if (!room) throw notFound('Salon introuvable (ou fermé).')
  return room
}

function memberOf(room: Room, playerId: string): RoomPlayer {
  const player = room.players.get(playerId)
  if (!player) throw new HttpError(403, 'not_in_room', 'Tu ne fais pas partie de ce salon.')
  return player
}

/** Le salon où se trouve un joueur (reprise après un rechargement). */
export function currentBombRoomOf(playerId: string): string | null {
  for (const room of rooms.values()) if (room.players.has(playerId)) return room.code
  return null
}

/* ---- Bombe ----------------------------------------------------------------------------- */

const alivePlayers = (room: Room) => [...room.players.values()].filter((player) => player.alive)

/** Le joueur en vie qui suit `fromId` autour de la table (`order` : la table AVANT un départ). */
function nextAlive(room: Room, fromId: string, order = [...room.players.keys()]): string | null {
  const start = order.indexOf(fromId)
  for (let step = 1; step <= order.length; step += 1) {
    const id = order[(start + step) % order.length] as string
    if (room.players.get(id)?.alive) return id
  }
  return null
}

function clearTimer(room: Room): void {
  if (room.timer) clearTimeout(room.timer)
  room.timer = null
}

/** Nouvelle bombe pour `turn` : syllabe, mèche tirée au sort, minuteur à l'heure du serveur. */
function arm(room: Room, from: number): void {
  if (!room.lexicon) return
  room.syllable = pickSyllable(room.lexicon, room.progress, room.recent, Math.random)
  room.recent = rememberSyllable(room.recent, room.syllable)
  room.fuseMs = fuseMs(room.progress, Math.random)
  room.fuseEndsAt = from + room.fuseMs
  room.typing = ''
  clearTimer(room)
  room.timer = setTimeout(() => explode(room), room.fuseEndsAt - Date.now())
  room.timer.unref?.()
}

function explode(room: Room): void {
  room.timer = null
  if (room.phase !== 'playing' || !room.turn || !room.lexicon) return
  const victim = room.players.get(room.turn)
  if (!victim) return
  victim.lives = Math.max(0, victim.lives - 1)
  pushEvent(room, { kind: 'explode', playerId: victim.id, syllable: room.syllable, example: room.lexicon.example(room.syllable, room.used) })
  if (victim.lives === 0) {
    victim.alive = false
    pushEvent(room, { kind: 'eliminated', playerId: victim.id })
  }
  if (alivePlayers(room).length <= 1) {
    void finish(room)
    return
  }
  room.turn = nextAlive(room, victim.id)
  arm(room, Date.now() + timing.pauseMs)
  broadcast(room)
}

/** Fin de partie : le dernier en vie gagne ; chacun reçoit sa part (Poussières, records). */
async function finish(room: Room): Promise<void> {
  clearTimer(room)
  room.phase = 'over'
  room.turn = null
  room.typing = ''
  room.winnerId = alivePlayers(room)[0]?.id ?? null
  broadcast(room)
  await Promise.all(
    [...room.participants].map(async (playerId) => {
      const won = playerId === room.winnerId
      const reward = await settleGame(playerId, { mode: room.mode, amount: won ? versusReward(room.participants.size) : 0, won }).catch(() => null)
      if (reward) room.rewards.set(playerId, reward)
    }),
  )
  broadcast(room)
}

function begin(room: Room): void {
  room.timer = null
  if (room.phase !== 'countdown') return
  const alive = alivePlayers(room)
  if (alive.length < MIN_PLAYERS) {
    room.phase = 'lobby'
    broadcast(room)
    return
  }
  room.phase = 'playing'
  room.turn = (alive[Math.floor(Math.random() * alive.length)] as RoomPlayer).id
  arm(room, Date.now())
  broadcast(room)
}

/* ---- Actions ---------------------------------------------------------------------------- */

export async function createBombRoom(participant: Participant, mode: BombMode): Promise<BombRoomView> {
  leaveAll(participant.id)
  const profile = await profileOf(participant)
  let code = roomCode(Math.random)
  while (rooms.has(code)) code = roomCode(Math.random)
  const room: Room = {
    code,
    mode,
    hostId: participant.id,
    players: new Map([[participant.id, { id: participant.id, profile, lives: LIVES, alive: false, words: 0, streams: 0 }]]),
    phase: 'lobby',
    turn: null,
    syllable: '',
    recent: [],
    fuseMs: 0,
    fuseEndsAt: 0,
    startsAt: 0,
    used: new Set(),
    progress: 0,
    typing: '',
    events: [],
    eventSeq: 0,
    winnerId: null,
    participants: new Set(),
    rewards: new Map(),
    lexicon: null,
    timer: null,
    subscribers: new Set(),
    touchedAt: Date.now(),
  }
  rooms.set(code, room)
  return viewFor(room, participant.id)
}

export async function joinBombRoom(participant: Participant, code: string): Promise<BombRoomView> {
  const room = roomOf(code)
  if (!room.players.has(participant.id)) {
    if (room.players.size >= MAX_PLAYERS) throw conflict('Le salon est complet.', 'room_full')
    const profile = await profileOf(participant)
    // Arrivé en pleine partie : il regarde, et jouera la suivante.
    room.players.set(participant.id, { id: participant.id, profile, lives: room.phase === 'lobby' ? LIVES : 0, alive: false, words: 0, streams: 0 })
    pushEvent(room, { kind: 'join', playerId: participant.id })
    broadcast(room)
  }
  return viewFor(room, participant.id)
}

/** Quitter : en pleine partie, on est éliminé (la bombe passe si on la tenait). */
export function leaveBombRoom(playerId: string, code: string): void {
  const room = rooms.get(code)
  const player = room?.players.get(playerId)
  if (!room || !player) return
  const order = [...room.players.keys()]
  const holding = room.phase === 'playing' && room.turn === playerId
  room.players.delete(playerId)
  for (const subscriber of room.subscribers) {
    if (subscriber.playerId !== playerId) continue
    clearInterval(subscriber.heartbeat)
    subscriber.res.end()
    room.subscribers.delete(subscriber)
  }
  if (room.players.size === 0) {
    clearTimer(room)
    rooms.delete(code)
    return
  }
  if (room.hostId === playerId) room.hostId = room.players.keys().next().value as string
  pushEvent(room, { kind: 'leave', playerId })
  if (room.phase === 'playing' && player.alive) {
    if (alivePlayers(room).length <= 1) {
      void finish(room)
      return
    }
    if (holding) {
      room.turn = nextAlive(room, playerId, order)
      arm(room, Date.now())
    }
  }
  broadcast(room)
}

function leaveAll(playerId: string): void {
  for (const room of [...rooms.values()]) if (room.players.has(playerId)) leaveBombRoom(playerId, room.code)
}

export function setBombMode(playerId: string, code: string, mode: BombMode): BombRoomView {
  const room = roomOf(code)
  memberOf(room, playerId)
  if (room.hostId !== playerId) throw new HttpError(403, 'not_host', 'Seul l’hôte choisit le mode.')
  if (room.phase === 'playing' || room.phase === 'countdown') throw conflict('La partie est en cours.', 'in_progress')
  room.mode = mode
  broadcast(room)
  return viewFor(room, playerId)
}

/** L'hôte lance (ou relance) la partie : décompte, puis la première bombe. */
export async function startBombRoom(playerId: string, code: string): Promise<BombRoomView> {
  const room = roomOf(code)
  memberOf(room, playerId)
  if (room.hostId !== playerId) throw new HttpError(403, 'not_host', 'Seul l’hôte lance la partie.')
  if (room.phase === 'playing' || room.phase === 'countdown') throw conflict('La partie est déjà lancée.', 'in_progress')
  if (room.players.size < MIN_PLAYERS) throw conflict('Il faut au moins deux joueurs.', 'not_enough_players')
  room.lexicon = await lexiconOf(room.mode)
  for (const player of room.players.values()) Object.assign(player, { lives: LIVES, alive: true, words: 0 })
  Object.assign(room, {
    phase: 'countdown',
    turn: null,
    used: new Set(),
    recent: [],
    progress: 0,
    typing: '',
    events: [],
    winnerId: null,
    rewards: new Map(),
    participants: new Set(room.players.keys()),
    startsAt: Date.now() + timing.countdownMs,
  })
  clearTimer(room)
  room.timer = setTimeout(() => begin(room), timing.countdownMs)
  room.timer.unref?.()
  broadcast(room)
  return viewFor(room, playerId)
}

/** Frappe du joueur qui tient la bombe : relayée aux autres, lettre par lettre. */
export function bombTyping(playerId: string, code: string, text: string): void {
  const room = roomOf(code)
  memberOf(room, playerId)
  if (room.phase !== 'playing' || room.turn !== playerId) return
  room.typing = text.slice(0, MAX_WORD_LENGTH)
  for (const subscriber of room.subscribers) {
    if (subscriber.playerId !== playerId) send(subscriber, 'typing', { playerId, text: room.typing })
  }
}

export interface BombWordResult {
  verdict: WordVerdict | { ok: false; reason: 'late' }
  view: BombRoomView
}

export function bombWord(playerId: string, code: string, word: string): BombWordResult {
  const room = roomOf(code)
  const player = memberOf(room, playerId)
  if (room.phase !== 'playing' || !room.lexicon) throw conflict('Aucune partie en cours.', 'not_playing')
  if (room.turn !== playerId) throw conflict('Ce n’est pas ton tour.', 'not_your_turn')
  const text = word.slice(0, MAX_WORD_LENGTH)
  // La mèche est au bout : le minuteur du serveur fait foi, le mot arrive trop tard.
  if (Date.now() >= room.fuseEndsAt) return { verdict: { ok: false, reason: 'late' }, view: viewFor(room, playerId) }
  const verdict = checkWord(room.lexicon, text, room.syllable, room.used)
  if (!verdict.ok) {
    pushEvent(room, { kind: 'fail', playerId, word: normalizeWord(text) ? text : '', reason: verdict.reason, syllable: room.syllable })
    broadcast(room)
    return { verdict, view: viewFor(room, playerId) }
  }
  room.used.add(verdict.key)
  player.words += 1
  room.progress += 1
  pushEvent(room, { kind: 'word', playerId, word: room.mode === 'manga' ? verdict.display : text, syllable: room.syllable })
  room.turn = nextAlive(room, playerId) ?? playerId
  arm(room, Date.now())
  broadcast(room)
  return { verdict, view: viewFor(room, playerId) }
}

/* ---- Flux temps réel ------------------------------------------------------------------- */

/** Ouvre le flux d'un joueur : l'état tout de suite, puis chaque changement. */
export function subscribeBombRoom(playerId: string, code: string, res: Response): () => void {
  const room = roomOf(code)
  const player = memberOf(room, playerId)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    // Nginx : ne pas retenir le flux dans son tampon.
    'X-Accel-Buffering': 'no',
  })
  res.write('retry: 2000\n\n')
  const subscriber: Subscriber = {
    playerId,
    res,
    heartbeat: setInterval(() => {
      if (!res.writableEnded) res.write(': battement\n\n')
    }, HEARTBEAT_MS),
  }
  subscriber.heartbeat.unref?.()
  room.subscribers.add(subscriber)
  player.streams += 1
  // Le joueur (re)vient : tout le monde le voit en ligne.
  if (player.streams === 1) broadcast(room)
  else send(subscriber, 'state', viewFor(room, playerId))
  return () => {
    clearInterval(subscriber.heartbeat)
    if (!room.subscribers.delete(subscriber)) return
    const current = room.players.get(playerId)
    if (current) {
      current.streams = Math.max(0, current.streams - 1)
      if (current.streams === 0) broadcast(room)
    }
  }
}

/* ---- Ménage ------------------------------------------------------------------------------ */

/** Salons sans personne de connecté depuis un moment : fermés. */
export function sweepBombRooms(now = Date.now()): void {
  for (const room of rooms.values()) {
    if (room.subscribers.size > 0 || now - room.touchedAt < ABANDONED_MS) continue
    clearTimer(room)
    rooms.delete(room.code)
  }
}
const sweeper = setInterval(() => sweepBombRooms(), 60_000)
sweeper.unref?.()

export function forgetBombRooms(): void {
  for (const room of rooms.values()) {
    clearTimer(room)
    for (const subscriber of room.subscribers) {
      clearInterval(subscriber.heartbeat)
      subscriber.res.end()
    }
  }
  rooms.clear()
}
