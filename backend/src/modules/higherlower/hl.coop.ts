import { randomInt } from 'node:crypto'
import { HttpError, conflict } from '../../lib/errors.js'
import { roomCode } from '../dle/dle.logic.js'
import { profileOf, type PlayerProfile } from '../dle/dle.rooms.js'
import type { Participant } from '../dle/dle.guests.js'
import { HL_ENTRIES, type HlEntry, type HlMetric } from './hl.data.js'
import { HL_LIVES, isCorrect, pickChallenger, pickOpening, recentWindow } from './hl.logic.js'
import { cardOf, creditCoop, type HlCard } from './hl.service.js'

/*
 * Higher or Lower en COOP : une seule partie pour tout le salon, des chances
 * communes, et chacun son tour — le joueur actif répond pour l'équipe, puis la main
 * passe au suivant (ordre d'arrivée). Le serveur tire les cartes et garde la valeur à
 * deviner, comme en solo. Un tour sans réponse à temps (`COOP_TIMING.turnMs`) compte comme une erreur.
 * Salons en mémoire, attente longue (même principe que les salons du BookshelfDLE) :
 * un redémarrage les ferme. Les Poussières de la série vont à chaque joueur encore
 * là à la fin (paliers et plafond du jour du solo) ; records et classements restent
 * ceux du solo.
 */

export const COOP_MIN_PLAYERS = 2
export const COOP_MAX_PLAYERS = 6
/**
 * Rythme d'une partie : avant le premier tour (les cartes entrent en scène), entre deux
 * tours (la révélation se joue chez tout le monde), et le temps pour répondre.
 */
export const COOP_TIMING = { introMs: 2_500, revealMs: 3_200, turnMs: 20_000 }
const PRESENCE_MS = 45_000
const IDLE_ROOM_MS = 10 * 60_000
export const COOP_WAIT_MS = 25_000

export type CoopPhase = 'lobby' | 'playing' | 'results'
type Choice = 'higher' | 'lower'

interface CoopPlayer {
  id: string
  profile: PlayerProfile
  joinedAt: number
  lastSeen: number
  watching: number
  /** Parti en pleine partie : gardé pour le bilan, retiré du tour. */
  left: boolean
  correct: number
  misses: number
}

/** Le dernier tour joué : de quoi rejouer la révélation chez tout le monde. */
export interface CoopTurnView {
  turn: number
  by: string
  /** `null` : temps écoulé sans réponse. */
  choice: Choice | null
  correct: boolean
  /** Référence et carte devinée, valeurs connues. */
  current: HlCard
  guessed: HlCard
}

interface CoopReward {
  reward: number
  balance: number
  capped: boolean
}

interface CoopRoom {
  code: string
  metric: HlMetric
  hostId: string
  phase: CoopPhase
  players: Map<string, CoopPlayer>
  /** Ordre de passage de la partie (ordre d'arrivée). */
  order: string[]
  active: string | null
  pool: readonly HlEntry[]
  current: HlEntry | null
  next: HlEntry | null
  streak: number
  lives: number
  recent: string[]
  turn: number
  turnStartsAt: number | null
  turnEndsAt: number | null
  last: CoopTurnView | null
  /** Bilan : série finale et pourquoi la partie s'est arrêtée. */
  finalStreak: number | null
  endedBy: 'lives' | 'exhausted' | null
  rewards: Map<string, CoopReward>
  finishing: boolean
  version: number
  waiters: Set<() => void>
  timer: NodeJS.Timeout | null
  touchedAt: number
}

const rooms = new Map<string, CoopRoom>()
/** Un compte n'est que dans un salon COOP à la fois. */
const membership = new Map<string, string>()

const secureRandom = () => randomInt(0, 2 ** 32) / 2 ** 32

const roomClosed = () => new HttpError(404, 'room_not_found', 'Ce salon n’existe pas ou est fermé.')

function bump(room: CoopRoom): void {
  room.version += 1
  room.touchedAt = Date.now()
  const waiters = [...room.waiters]
  room.waiters.clear()
  for (const wake of waiters) wake()
}

function clearTimer(room: CoopRoom): void {
  if (room.timer) clearTimeout(room.timer)
  room.timer = null
}

function destroy(room: CoopRoom): void {
  clearTimer(room)
  for (const id of room.players.keys()) if (membership.get(id) === room.code) membership.delete(id)
  rooms.delete(room.code)
  bump(room)
}

function roomOf(code: string): CoopRoom {
  const room = rooms.get(code)
  if (!room) throw roomClosed()
  return room
}

function memberOf(room: CoopRoom, userId: string): CoopPlayer {
  const player = room.players.get(userId)
  if (!player || player.left) throw new HttpError(403, 'not_in_room', 'Tu ne fais pas partie de ce salon.')
  return player
}

const present = (player: CoopPlayer, now: number) => !player.left && (player.watching > 0 || now - player.lastSeen < PRESENCE_MS)
const playing = (room: CoopRoom) => [...room.players.values()].filter((player) => !player.left)

/* ---- Tours ------------------------------------------------------------------------- */

/** Le joueur qui suit `from` dans l'ordre de passage (en sautant ceux qui sont partis). */
function nextActive(room: CoopRoom, from: string | null): string | null {
  const order = room.order.filter((id) => room.players.get(id) && !room.players.get(id)?.left)
  if (order.length === 0) return null
  const index = from === null ? -1 : room.order.indexOf(from)
  for (let step = 1; step <= room.order.length; step += 1) {
    const id = room.order[(index + step) % room.order.length] as string
    if (order.includes(id)) return id
  }
  return order[0] ?? null
}

/** Donne la main à `active` : son chrono part après le délai de révélation. */
function handTo(room: CoopRoom, active: string | null, delayMs: number, now = Date.now()): void {
  clearTimer(room)
  room.active = active
  if (active === null) return
  room.turnStartsAt = now + delayMs
  room.turnEndsAt = room.turnStartsAt + COOP_TIMING.turnMs
  const turn = room.turn
  room.timer = setTimeout(() => {
    room.timer = null
    // Toujours le même tour : personne n'a répondu à temps.
    if (rooms.get(room.code) === room && room.phase === 'playing' && room.turn === turn && room.active) void resolve(room, room.active, null)
  }, room.turnEndsAt - now)
  room.timer.unref()
}

/** Réponse (ou silence) du joueur actif : la série, les chances, puis la main au suivant (ou le bilan, une fois les Poussières créditées). */
async function resolve(room: CoopRoom, by: string, choice: Choice | null): Promise<void> {
  const { current, next } = room
  if (!current || !next) return
  const correct = choice !== null && isCorrect(choice, current.value, next.value)
  room.last = { turn: room.turn, by, choice, correct, current: cardOf(current, true), guessed: cardOf(next, true) }
  const player = room.players.get(by)
  if (player) {
    if (correct) player.correct += 1
    else player.misses += 1
  }
  if (!correct && room.lives === 0) {
    await finish(room, 'lives')
    return
  }
  if (correct) room.streak += 1
  else room.lives -= 1
  room.recent = [...room.recent, next.id].slice(-recentWindow(room.pool.length))
  const challenger = pickChallenger(room.pool, next, room.streak, new Set(room.recent), secureRandom)
  if (!challenger) {
    await finish(room, 'exhausted')
    return
  }
  room.current = next
  room.next = challenger
  room.turn += 1
  handTo(room, nextActive(room, by), COOP_TIMING.revealMs)
  bump(room)
}

/** Fin de partie : chaque joueur encore là touche les Poussières de la série. */
async function finish(room: CoopRoom, endedBy: 'lives' | 'exhausted'): Promise<void> {
  if (room.finishing || room.phase !== 'playing') return
  room.finishing = true
  clearTimer(room)
  room.phase = 'results'
  room.active = null
  room.turnStartsAt = null
  room.turnEndsAt = null
  room.finalStreak = room.streak
  room.endedBy = endedBy
  room.rewards = new Map()
  const now = new Date()
  for (const player of playing(room)) {
    try {
      room.rewards.set(player.id, await creditCoop(player.id, room.streak, room.metric, now))
    } catch (error) {
      console.warn('[higher-lower] coop : Poussières non créditées', error)
    }
  }
  room.finishing = false
  bump(room)
}

/* ---- Vue ---------------------------------------------------------------------------- */

export interface CoopPlayerView {
  id: string
  name: string | null
  avatarUrl: string | null
  avatar: PlayerProfile['avatar']
  title: PlayerProfile['title']
  correct: number
  misses: number
  left: boolean
}

export interface CoopView {
  code: string
  metric: HlMetric
  phase: CoopPhase
  hostId: string
  you: string
  version: number
  serverTime: string
  minPlayers: number
  maxPlayers: number
  players: CoopPlayerView[]
  /** Ordre de passage de la partie en cours (vide au salon d'attente). */
  order: string[]
  active: string | null
  turn: number
  turnStartsAt: string | null
  turnEndsAt: string | null
  streak: number
  lives: number
  maxLives: number
  /** Référence (valeur connue) et carte à deviner (valeur cachée). */
  current: HlCard | null
  next: HlCard | null
  last: CoopTurnView | null
  result: { streak: number; endedBy: 'lives' | 'exhausted' | null; reward: number | null; balance: number | null; capped: boolean } | null
}

const iso = (time: number | null) => (time === null ? null : new Date(time).toISOString())

function viewFor(room: CoopRoom, userId: string): CoopView {
  const mine = room.rewards.get(userId)
  return {
    code: room.code,
    metric: room.metric,
    phase: room.phase,
    hostId: room.hostId,
    you: userId,
    version: room.version,
    serverTime: new Date().toISOString(),
    minPlayers: COOP_MIN_PLAYERS,
    maxPlayers: COOP_MAX_PLAYERS,
    players: [...room.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((player) => ({
        id: player.id,
        name: player.profile.name,
        avatarUrl: player.profile.avatarUrl,
        avatar: player.profile.avatar,
        title: player.profile.title,
        correct: player.correct,
        misses: player.misses,
        left: player.left,
      })),
    order: room.phase === 'lobby' ? [] : room.order,
    active: room.active,
    turn: room.turn,
    turnStartsAt: iso(room.turnStartsAt),
    turnEndsAt: iso(room.turnEndsAt),
    streak: room.streak,
    lives: room.lives,
    maxLives: HL_LIVES,
    current: room.phase === 'lobby' || !room.current ? null : cardOf(room.current, true),
    next: room.phase !== 'playing' || !room.next ? null : cardOf(room.next, false),
    last: room.phase === 'lobby' ? null : room.last,
    result:
      room.phase === 'results'
        ? { streak: room.finalStreak ?? room.streak, endedBy: room.endedBy, reward: mine?.reward ?? null, balance: mine?.balance ?? null, capped: mine?.capped ?? false }
        : null,
  }
}

/* ---- Entrer, sortir ------------------------------------------------------------------- */

/** Retire un joueur (ou le marque parti, en pleine partie ; c'était son tour : la main passe). */
function removePlayer(room: CoopRoom, userId: string): void {
  const player = room.players.get(userId)
  if (!player) return
  if (membership.get(userId) === room.code) membership.delete(userId)
  if (room.phase === 'playing') player.left = true
  else room.players.delete(userId)

  const remaining = playing(room)
  if (remaining.length === 0) {
    destroy(room)
    return
  }
  if (room.hostId === userId) room.hostId = (remaining[0] as CoopPlayer).id
  if (room.phase === 'playing' && room.active === userId) handTo(room, nextActive(room, userId), 0)
  bump(room)
}

async function enter(room: CoopRoom, participant: Participant): Promise<void> {
  const userId = participant.id
  const previous = membership.get(userId)
  if (previous && previous !== room.code) {
    const other = rooms.get(previous)
    if (other) removePlayer(other, userId)
  }
  const known = room.players.get(userId)
  if (known && !known.left) {
    membership.set(userId, room.code)
    return
  }
  const full = () => playing(room).length >= COOP_MAX_PLAYERS
  if (full()) throw conflict('Ce salon est complet.', 'room_full')
  const profile = await profileOf(participant)
  if (full()) throw conflict('Ce salon est complet.', 'room_full')
  const now = Date.now()
  if (known) {
    // Revenu en pleine partie : il reprend sa place dans l'ordre de passage.
    known.left = false
    known.lastSeen = now
  } else {
    room.players.set(userId, { id: userId, profile, joinedAt: now, lastSeen: now, watching: 0, left: false, correct: 0, misses: 0 })
    if (room.phase === 'playing') room.order.push(userId)
  }
  membership.set(userId, room.code)
  bump(room)
}

function freshCode(): string {
  for (;;) {
    const code = roomCode(secureRandom)
    if (!rooms.has(code)) return code
  }
}

export async function createCoop(participant: Participant, metric: HlMetric): Promise<CoopView> {
  const room: CoopRoom = {
    code: freshCode(),
    metric,
    hostId: participant.id,
    phase: 'lobby',
    players: new Map(),
    order: [],
    active: null,
    pool: HL_ENTRIES[metric],
    current: null,
    next: null,
    streak: 0,
    lives: HL_LIVES,
    recent: [],
    turn: 0,
    turnStartsAt: null,
    turnEndsAt: null,
    last: null,
    finalStreak: null,
    endedBy: null,
    rewards: new Map(),
    finishing: false,
    version: 1,
    waiters: new Set(),
    timer: null,
    touchedAt: Date.now(),
  }
  rooms.set(room.code, room)
  try {
    await enter(room, participant)
  } catch (error) {
    rooms.delete(room.code)
    throw error
  }
  return viewFor(room, participant.id)
}

export async function joinCoop(participant: Participant, code: string): Promise<CoopView> {
  const room = roomOf(code)
  await enter(room, participant)
  return viewFor(room, participant.id)
}

export function leaveCoop(userId: string, code: string): void {
  const room = rooms.get(code)
  if (room) removePlayer(room, userId)
}

function hostOnly(room: CoopRoom, userId: string): void {
  memberOf(room, userId)
  if (room.hostId !== userId) throw new HttpError(403, 'not_host', 'Seul l’hôte peut faire ça.')
}

/** L'hôte change de terrain, au salon d'attente ou au bilan. */
export function setCoopMetric(userId: string, code: string, metric: HlMetric): CoopView {
  const room = roomOf(code)
  hostOnly(room, userId)
  if (room.phase === 'playing') throw conflict('La partie est déjà lancée.', 'room_started')
  room.metric = metric
  room.pool = HL_ENTRIES[metric]
  bump(room)
  return viewFor(room, userId)
}

/** L'hôte lance (ou relance, depuis le bilan) la partie : nouvelles cartes, chances pleines. */
export function startCoop(userId: string, code: string): CoopView {
  const room = roomOf(code)
  hostOnly(room, userId)
  if (room.phase === 'playing') throw conflict('La partie est déjà lancée.', 'room_started')
  const now = Date.now()
  const here = [...room.players.values()].filter((player) => present(player, now) || player.id === userId)
  if (here.length < COOP_MIN_PLAYERS) throw conflict('Il faut au moins deux joueurs.', 'need_players')
  // Les absents restent dehors ; les présents repartent de zéro.
  for (const player of room.players.values()) if (!here.includes(player)) removePlayer(room, player.id)
  const current = pickOpening(room.pool, secureRandom)
  const next = current ? pickChallenger(room.pool, current, 0, new Set(), secureRandom) : null
  if (!current || !next) throw new HttpError(503, 'hl_unavailable', 'Pas assez de cartes dans cette catégorie.')
  for (const player of here) {
    player.correct = 0
    player.misses = 0
  }
  room.order = here.sort((a, b) => a.joinedAt - b.joinedAt).map((player) => player.id)
  room.phase = 'playing'
  room.current = current
  room.next = next
  room.streak = 0
  room.lives = HL_LIVES
  room.recent = [current.id]
  room.turn = 0
  room.last = null
  room.finalStreak = null
  room.endedBy = null
  room.rewards = new Map()
  handTo(room, room.order[0] ?? null, COOP_TIMING.introMs, now)
  bump(room)
  return viewFor(room, userId)
}

/** Réponse du joueur dont c'est le tour. `turn` : le tour auquel il répond (un double clic ne compte pas deux fois). */
export async function guessCoop(userId: string, code: string, choice: Choice, turn: number): Promise<CoopView> {
  const room = roomOf(code)
  memberOf(room, userId)
  if (room.phase !== 'playing' || room.finishing) throw conflict('Aucune partie en cours.', 'not_playing')
  if (room.turn !== turn) throw conflict('Ce tour est déjà joué.', 'turn_over')
  if (room.active !== userId) throw conflict('Ce n’est pas ton tour.', 'not_your_turn')
  await resolve(room, userId, choice)
  return viewFor(room, userId)
}

/** État du salon dès qu'il est plus récent que `since` (attente longue). Chaque demande vaut signe de présence. */
export async function waitCoop(userId: string, code: string, since: number | null, signal: AbortSignal): Promise<CoopView> {
  const room = roomOf(code)
  const player = memberOf(room, userId)
  player.lastSeen = Date.now()
  if (since === null || since !== room.version) return viewFor(room, userId)
  player.watching += 1
  try {
    await new Promise<void>((done) => {
      const wake = () => {
        clearTimeout(timer)
        room.waiters.delete(wake)
        signal.removeEventListener('abort', wake)
        done()
      }
      const timer = setTimeout(wake, COOP_WAIT_MS)
      timer.unref()
      room.waiters.add(wake)
      signal.addEventListener('abort', wake, { once: true })
    })
  } finally {
    player.watching = Math.max(0, player.watching - 1)
    player.lastSeen = Date.now()
  }
  if (!rooms.has(code)) throw roomClosed()
  memberOf(room, userId)
  return viewFor(room, userId)
}

/** Le salon COOP où se trouve ce compte (reprise après un rechargement). */
export function currentCoopOf(userId: string): string | null {
  const code = membership.get(userId)
  return code && rooms.has(code) ? code : null
}

/* ---- Ménage ------------------------------------------------------------------------- */

/** Retire les absents des salons d'attente et des bilans ; ferme les salons abandonnés. */
export function sweepCoop(now = Date.now()): void {
  for (const room of [...rooms.values()]) {
    if (room.phase !== 'playing') {
      for (const player of [...room.players.values()]) if (!present(player, now)) removePlayer(room, player.id)
    }
    if (!rooms.has(room.code)) continue
    const watched = [...room.players.values()].some((player) => !player.left && (player.watching > 0 || now - player.lastSeen < IDLE_ROOM_MS))
    if (!watched) destroy(room)
  }
}

const sweeper = setInterval(() => sweepCoop(), 10_000)
sweeper.unref()

/** Tests : repartir de zéro. */
export function resetCoop(): void {
  for (const room of [...rooms.values()]) destroy(room)
  membership.clear()
}

/** Tests : la valeur cachée de la carte à deviner. */
export const coopNextValueForTests = (code: string): number | null => rooms.get(code)?.next?.value ?? null
