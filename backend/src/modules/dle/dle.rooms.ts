import { randomInt } from 'node:crypto'
import { prisma } from '../../db.js'
import { HttpError, badRequest, conflict, notFound } from '../../lib/errors.js'
import { creditStardust } from '../stardust/stardust.service.js'
import { publicAvatarUrl } from '../users/publicProfile.service.js'
import { TITLE_IDS, type TitleId } from '../users/titles.js'
import type { Rarity } from '../cards/boosters.logic.js'
import {
  ROOM_REWARDS_PER_DAY,
  closeness,
  rankContenders,
  roomCode,
  roomReward,
  sweepDirt,
  trailOf,
  zoomFocus,
  DLE_MODES,
  isImageMode,
  type DleCategory,
  type DleMode,
  type Verdict,
} from './dle.logic.js'
import { gameOf, guessResult, poolFor, type DleEntity, type EntitySummary, type GuessResult } from './dle.games.js'
import { cleanTiles, pickTiles, sweepTiles } from './dle.sweep.js'
import { guestRewardedToday, isGuestId, noteGuestReward, signReceipt, type Participant } from './dle.guests.js'

/*
 * Salons multijoueurs du BookshelfDLE, jusqu'à dix joueurs, comptes ou invités.
 * Deux types de partie :
 *  - VERSUS (course) : tout le monde cherche la même œuvre, chacun sur sa grille ;
 *    on voit la progression des autres (couleurs de leurs essais), jamais ce qu'ils
 *    ont proposé ; le plus rapide à trouver l'emporte ;
 *  - COOP (entraide) : une seule grille pour tout le salon, chaque essai apparaît
 *    aussitôt chez tous avec le nom de son auteur ; victoire collective.
 *
 * Les invités ne gagnent pas de Poussières en base : ils reçoivent un reçu signé
 * (cf. `dle.guests.ts`), que leur futur compte échangera.
 *
 * Les salons vivent en mémoire : une partie dure quelques minutes, une seule
 * instance d'API sert l'app. Un redémarrage du serveur ferme les salons en cours
 * (les gains déjà distribués restent acquis, ils sont en base).
 *
 * Temps réel par attente longue (`waitRoom`) : le client demande l'état « après
 * la version N », la réponse part dès que le salon change (ou au bout de 25 s).
 * Aucune connexion permanente à faire passer par les proxys.
 */

export const MAX_PLAYERS = 10
/** Compte à rebours avant le départ : le temps de charger la couverture, et l'effet « 3, 2, 1 ». */
export const COUNTDOWN_MS = 3_500
/** Réglages de l'hôte : essais par manche (`null` : illimités) et durée de la manche (s). */
export const GUESS_OPTIONS = [null, 5, 10, 15, 20, 30] as const
export const DURATION_OPTIONS = [60, 120, 180, 300, 600] as const
export const DEFAULT_ROUND_SECONDS = 180
/** Plusieurs formats (Classique puis Couverture) : la pause entre deux manches, résultats affichés (réglable par les tests). */
export const ROOM_TIMING = { intermissionMs: 8_000 }

/** Formats d'une partie : un ou plusieurs, toujours dans l'ordre Classique → Couverture → Pixels. */
export const normalizeModes = (modes: readonly DleMode[]): DleMode[] => {
  const picked = DLE_MODES.filter((mode) => modes.includes(mode))
  return picked.length > 0 ? picked : ['classic']
}
/** COOP : Poussières de chaque joueur si l'équipe trouve, et sinon (participation). */
export const COOP_WIN_REWARD = 30
export const COOP_TRY_REWARD = 5

/** Sans nouvelles d'un joueur depuis ce délai (hors partie) : il a quitté le salon. */
const PRESENCE_MS = 45_000
/** Plus personne ne regarde le salon depuis ce délai : il disparaît. */
const IDLE_ROOM_MS = 10 * 60_000
/** Attente longue : au-delà, l'état est renvoyé tel quel (le client redemande aussitôt). */
export const WAIT_MS = 25_000

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'results'
export type RoomVisibility = 'private' | 'public'
export type RoomKind = 'versus' | 'coop'
export const ROOM_KINDS = ['versus', 'coop'] as const

export interface PlayerProfile {
  name: string | null
  avatarUrl: string | null
  avatar: { imageUrl: string; rarity: Rarity } | null
  title: TitleId | null
}

interface PlayedGuess {
  cardId: string
  correct: boolean
  trail: Verdict[]
}

/** Essai de la grille commune (COOP), et qui l'a proposé. */
interface SharedGuess extends PlayedGuess {
  by: string
  byName: string | null
}

interface Player {
  id: string
  profile: PlayerProfile
  joinedAt: number
  lastSeen: number
  /** Attentes longues en cours : le joueur regarde le salon. */
  watching: number
  guesses: PlayedGuess[]
  solvedMs: number | null
  gaveUp: boolean
  /** Parti en pleine manche : reste au classement, sans gain. */
  left: boolean
  /** Joue la manche en cours (arrivé avant le départ). */
  inRound: boolean
  guest: boolean
  /** Invité : le reçu de Poussières de la dernière manche, à garder sur l'appareil. */
  receipt: string | null
  /** Chiffon : tuiles qu'il a nettoyées pendant la manche. */
  revealed: Set<number>
}

export interface Standing {
  id: string
  name: string | null
  rank: number
  solved: boolean
  solvedMs: number | null
  attempts: number
  /** Poussières gagnées ; 0 au-delà du plafond quotidien, ou pour qui est parti. */
  reward: number
  left: boolean
  guest: boolean
  /** Chiffon : part nettoyée (%) ; `null` dans les autres formats. */
  dirt: number | null
}

/** Classement général d'une partie en plusieurs manches. */
export interface OverallStanding {
  id: string
  name: string | null
  rank: number
  /** VERSUS : 3 au premier qui trouve, 2 au deuxième, 1 aux suivants ; COOP : 1 par manche réussie. */
  points: number
  /** Manches trouvées. */
  solved: number
  guest: boolean
}

interface Room {
  code: string
  category: DleCategory
  /** Formats de la partie, joués l'un après l'autre (une manche chacun). */
  modes: DleMode[]
  /** Manche en cours (ou dernière jouée), dans `modes`. */
  stage: number
  /** Format de la manche en cours. */
  mode: DleMode
  /** Classements des manches déjà jouées de la partie. */
  history: Standing[][]
  /** Pause entre deux manches : départ de la suivante (ms) ; `null` : partie finie (ou pas commencée). */
  nextStageAt: number | null
  kind: RoomKind
  /** Essais par manche : chacun (VERSUS) ou toute l'équipe (COOP) ; `null` : illimités. */
  maxGuesses: number | null
  /** Durée d'une manche (s). */
  roundSeconds: number
  /** COOP : la grille commune. */
  shared: SharedGuess[]
  /** COOP : l'équipe a trouvé (ms depuis le départ). */
  teamSolvedMs: number | null
  /** COOP au Chiffon : la vitre commune. */
  sharedRevealed: Set<number>
  visibility: RoomVisibility
  hostId: string
  phase: RoomPhase
  round: number
  version: number
  players: Map<string, Player>
  answer: DleEntity | null
  focus: { x: number; y: number } | null
  /** Œuvres déjà cherchées dans ce salon : pas deux fois la même. */
  used: Set<string>
  startsAt: number | null
  endsAt: number | null
  /** Joueurs au départ de la manche : à deux ou plus, la partie rapporte des Poussières. */
  startedWith: number
  standings: Standing[] | null
  finishing: boolean
  waiters: Set<() => void>
  timers: Map<string, NodeJS.Timeout>
  touchedAt: number
}

const rooms = new Map<string, Room>()
/** Un compte n'est que dans un salon à la fois. */
const membership = new Map<string, string>()

const secureRandom = () => randomInt(0, 2 ** 32) / 2 ** 32

/* ---- Notification des attentes ------------------------------------------------- */

/** Le salon a changé : nouvelle version, et réponse immédiate à tous ceux qui attendaient. */
function bump(room: Room): void {
  room.version += 1
  room.touchedAt = Date.now()
  const waiters = [...room.waiters]
  room.waiters.clear()
  for (const wake of waiters) wake()
}

function schedule(room: Room, name: string, at: number, run: () => void): void {
  clearTimeout(room.timers.get(name))
  const timer = setTimeout(() => {
    room.timers.delete(name)
    run()
  }, Math.max(0, at - Date.now()))
  // Un minuteur de salon ne retient jamais le processus (arrêt du serveur, fin des tests).
  timer.unref()
  room.timers.set(name, timer)
}

function cancel(room: Room, name: string): void {
  clearTimeout(room.timers.get(name))
  room.timers.delete(name)
}

function destroy(room: Room): void {
  for (const timer of room.timers.values()) clearTimeout(timer)
  room.timers.clear()
  for (const id of room.players.keys()) if (membership.get(id) === room.code) membership.delete(id)
  rooms.delete(room.code)
  // Ceux qui attendaient encore apprennent que le salon a fermé (404 à leur prochaine demande).
  bump(room)
}

/* ---- Joueurs --------------------------------------------------------------------- */

const isTitleId = (value: string | null): value is TitleId => value !== null && (TITLE_IDS as readonly string[]).includes(value)

/** Pseudo, avatar et titre : de quoi reconnaître un adversaire (jamais son e-mail). Un invité : son pseudo. */
export async function profileOf(participant: Participant): Promise<PlayerProfile> {
  if (participant.guest) return { name: participant.guest.name, avatarUrl: null, avatar: null, title: null }
  const userId = participant.id
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, avatarUrl: true, avatarCardId: true, activeTitle: true },
  })
  if (!user) throw notFound('Compte introuvable.')
  const owned = user.avatarCardId
    ? await prisma.userCard.findUnique({ where: { userId_cardId: { userId, cardId: user.avatarCardId } }, select: { card: { select: { imageUrl: true, rarity: true } } } })
    : null
  return {
    name: user.displayName,
    avatarUrl: publicAvatarUrl(user.avatarUrl, userId),
    avatar: owned ? { imageUrl: owned.card.imageUrl, rarity: owned.card.rarity as Rarity } : null,
    title: isTitleId(user.activeTitle) ? user.activeTitle : null,
  }
}

const newPlayer = (id: string, profile: PlayerProfile, now: number): Player => ({
  id,
  guest: isGuestId(id),
  receipt: null,
  profile,
  joinedAt: now,
  lastSeen: now,
  watching: 0,
  guesses: [],
  solvedMs: null,
  gaveUp: false,
  left: false,
  inRound: false,
  revealed: new Set(),
})

/** Plus d'essais (jamais, s'ils sont illimités). */
const outOfGuesses = (room: Room, used: number) => room.maxGuesses !== null && used >= room.maxGuesses

/** A fini sa manche : parti, abandon, trouvé, plus d'essais (en COOP : l'équipe a trouvé, ou la grille est pleine). */
const isDone = (room: Room, player: Player) =>
  player.left ||
  player.gaveUp ||
  (room.kind === 'coop'
    ? room.teamSolvedMs !== null || outOfGuesses(room, room.shared.length)
    : player.solvedMs !== null || outOfGuesses(room, player.guesses.length))

const present = (player: Player, now: number) => player.watching > 0 || now - player.lastSeen < PRESENCE_MS

function roomOf(code: string): Room {
  const room = rooms.get(code)
  if (!room) throw new HttpError(404, 'room_not_found', 'Ce salon n’existe pas ou est fermé.')
  return room
}

function memberOf(room: Room, userId: string): Player {
  const player = room.players.get(userId)
  if (!player || player.left) throw new HttpError(403, 'not_in_room', 'Tu ne fais pas partie de ce salon.')
  return player
}

/** Retire un joueur du salon (ou le marque parti, en pleine manche). */
function removePlayer(room: Room, userId: string): void {
  const player = room.players.get(userId)
  if (!player) return
  if (membership.get(userId) === room.code) membership.delete(userId)

  const midRound = (room.phase === 'countdown' || room.phase === 'playing') && player.inRound
  if (midRound) {
    player.left = true
    player.gaveUp = true
  } else {
    room.players.delete(userId)
  }

  const remaining = [...room.players.values()].filter((entry) => !entry.left)
  if (remaining.length === 0) {
    if (midRound) void finish(room).finally(() => destroy(room))
    else destroy(room)
    return
  }
  if (room.hostId === userId) room.hostId = (remaining[0] as Player).id
  if (midRound && remaining.filter((entry) => entry.inRound).every((entry) => isDone(room, entry))) {
    void finish(room)
    return
  }
  bump(room)
}

/* ---- Cycle d'une manche ---------------------------------------------------------- */

async function begin(room: Room): Promise<void> {
  const nextStage = room.phase === 'results' && room.nextStageAt !== null
  if (room.phase !== 'lobby' && !nextStage) return
  const stage = nextStage ? room.stage + 1 : 0
  const mode = room.modes[stage] ?? 'classic'
  const list = await poolFor(gameOf(room.category), mode)
  if (list.length === 0) throw new HttpError(503, 'dle_images_unavailable', 'Les images de cette partie sont indisponibles, réessaie plus tard.')
  if (room.phase !== 'lobby' && !(room.phase === 'results' && room.nextStageAt !== null)) return
  room.stage = stage
  room.mode = mode
  room.nextStageAt = null
  if (stage === 0) room.history = []
  cancel(room, 'next')
  const fresh = list.filter((entity) => !room.used.has(entity.id))
  const pool = fresh.length > 0 ? fresh : list
  const answer = pool[Math.floor(secureRandom() * pool.length)] as DleEntity
  const now = Date.now()

  room.used.add(answer.id)
  room.answer = answer
  room.focus = room.mode === 'zoom' ? zoomFocus(secureRandom) : null
  room.phase = 'countdown'
  room.round += 1
  room.startsAt = now + COUNTDOWN_MS
  room.endsAt = room.startsAt + room.roundSeconds * 1000
  room.standings = null
  room.finishing = false
  room.shared = []
  room.teamSolvedMs = null
  room.sharedRevealed = new Set()
  for (const player of room.players.values()) {
    Object.assign(player, { guesses: [], solvedMs: null, gaveUp: false, left: false, inRound: true, receipt: null, revealed: new Set<number>() })
  }
  room.startedWith = room.players.size

  schedule(room, 'start', room.startsAt, () => {
    if (room.phase !== 'countdown') return
    room.phase = 'playing'
    bump(room)
  })
  schedule(room, 'end', room.endsAt, () => void finish(room))
  bump(room)
}

/** Rattrape un minuteur en retard : l'heure du serveur fait foi à chaque lecture. */
function advance(room: Room, now: number): void {
  if (room.phase === 'countdown' && room.startsAt !== null && now >= room.startsAt) {
    room.phase = 'playing'
    bump(room)
  }
  if (room.phase === 'playing' && room.endsAt !== null && now >= room.endsAt) void finish(room)
}

/** Plafond quotidien atteint : la partie ne rapporte plus rien à ce compte (24 h glissantes). */
async function rewardedToday(userId: string, now: Date): Promise<number> {
  return prisma.stardustEntry.count({
    where: { userId, reason: 'dle_room', createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  })
}

/** Fin de manche : classement, gains et palmarès. Une seule fois par manche. */
async function finish(room: Room): Promise<void> {
  if (room.finishing || room.phase === 'results' || room.phase === 'lobby') return
  room.finishing = true
  cancel(room, 'start')
  cancel(room, 'end')

  const contenders = [...room.players.values()].filter((player) => player.inRound)
  const coop = room.kind === 'coop'
  const teamSolved = room.teamSolvedMs !== null
  // COOP : tout le monde gagne ou perd ensemble ; `attempts` compte les essais de chacun sur la grille commune.
  const ranked = coop
    ? contenders.map((player) => ({ id: player.id, rank: 1, solved: teamSolved, solvedMs: room.teamSolvedMs, attempts: player.guesses.length, best: 0 }))
    : rankContenders(
        contenders.map((player) => ({
          id: player.id,
          solved: player.solvedMs !== null,
          solvedMs: player.solvedMs,
          attempts: player.guesses.length,
          best: Math.max(0, ...player.guesses.map((guess) => closeness(guess.trail))),
          ...(room.mode === 'sweep' ? { dirt: dirtOf(room, player) } : {}),
        })),
      )
  const rewarded = room.startedWith >= 2
  const now = new Date()
  const standings: Standing[] = []
  for (const entry of ranked) {
    const player = room.players.get(entry.id)
    let reward = 0
    if (rewarded && player && !player.left && player.guest) {
      // Invité : un reçu signé, que son futur compte échangera (plafond quotidien en mémoire).
      if (guestRewardedToday(player.id) < ROOM_REWARDS_PER_DAY) {
        reward = coop ? (teamSolved ? COOP_WIN_REWARD : COOP_TRY_REWARD) : roomReward(entry.rank, entry.solved)
        noteGuestReward(player.id)
        player.receipt = signReceipt(reward)
      }
    } else if (rewarded && player && !player.left) {
      try {
        const base = coop ? (teamSolved ? COOP_WIN_REWARD : COOP_TRY_REWARD) : roomReward(entry.rank, entry.solved)
        const capped = (await rewardedToday(entry.id, now)) >= ROOM_REWARDS_PER_DAY
        reward = capped ? 0 : base
        const won = coop ? teamSolved : entry.rank === 1 && entry.solved
        await prisma.$transaction(async (tx) => {
          if (reward > 0) await creditStardust(tx, entry.id, reward, 'dle_room', { room: room.code, round: room.round, rank: entry.rank, mode: room.mode, kind: room.kind })
          await tx.dleStats.upsert({
            where: { userId: entry.id },
            create: { userId: entry.id, roomsPlayed: 1, roomsWon: won ? 1 : 0 },
            update: { roomsPlayed: { increment: 1 }, ...(won ? { roomsWon: { increment: 1 } } : {}) },
          })
        })
      } catch (error) {
        // Un compte supprimé entre-temps ne bloque jamais la fin de partie des autres.
        reward = 0
        console.warn(`[dle] gains impossibles pour ${entry.id}`, error)
      }
    }
    standings.push({
      id: entry.id,
      name: player?.profile.name ?? null,
      rank: entry.rank,
      solved: entry.solved,
      solvedMs: entry.solvedMs,
      attempts: entry.attempts,
      reward,
      left: player?.left ?? true,
      guest: isGuestId(entry.id),
      dirt: room.mode === 'sweep' && player ? dirtOf(room, player) : null,
    })
  }

  room.standings = standings
  room.history.push(standings)
  room.phase = 'results'
  // Encore un format à jouer : la manche suivante part d'elle-même après une pause.
  if (room.stage < room.modes.length - 1) {
    room.nextStageAt = Date.now() + ROOM_TIMING.intermissionMs
    schedule(room, 'next', room.nextStageAt, () => {
      void begin(room).catch((error: unknown) => {
        console.warn('[dle] manche suivante impossible', error)
        room.nextStageAt = null
        bump(room)
      })
    })
  }
  // Ceux partis en pleine manche quittent le salon pour de bon : ils restent au classement.
  for (const player of room.players.values()) if (player.left) room.players.delete(player.id)
  for (const player of room.players.values()) player.inRound = false
  room.finishing = false
  bump(room)
}

/** Classement général : points de chaque manche additionnés (à égalité, le plus de manches trouvées). */
function overallOf(room: Room): OverallStanding[] {
  const totals = new Map<string, OverallStanding>()
  for (const standings of room.history) {
    for (const entry of standings) {
      const total = totals.get(entry.id) ?? { id: entry.id, name: entry.name, rank: 0, points: 0, solved: 0, guest: entry.guest }
      if (entry.solved) {
        total.solved += 1
        total.points += room.kind === 'coop' ? 1 : Math.max(1, 4 - entry.rank)
      }
      totals.set(entry.id, total)
    }
  }
  const sorted = [...totals.values()].sort((a, b) => b.points - a.points || b.solved - a.solved)
  sorted.forEach((entry, index) => {
    const previous = sorted[index - 1]
    entry.rank = previous && previous.points === entry.points && previous.solved === entry.solved ? previous.rank : index + 1
  })
  return sorted
}

/* ---- Vue d'un joueur -------------------------------------------------------------- */

export interface RoomPlayerView {
  id: string
  name: string | null
  avatarUrl: string | null
  avatar: PlayerProfile['avatar']
  title: TitleId | null
  isHost: boolean
  /** Couleurs de chaque essai, sans l'œuvre proposée. */
  trail: Verdict[][]
  solved: boolean
  solvedMs: number | null
  done: boolean
  gaveUp: boolean
  left: boolean
  /** Arrivé après le départ : regarde la manche, jouera la suivante. */
  spectating: boolean
  present: boolean
  /** Joue sans compte (pseudo d'invité). */
  guest: boolean
  /** Chiffon : part de SA vitre nettoyée (%), visible des adversaires ; `null` dans les autres formats. */
  dirt: number | null
}

/** Un essai vu par un joueur ; en COOP, avec son auteur. */
export type RoomGuess = GuessResult & { by: string | null; byName: string | null }

export interface RoomView {
  code: string
  category: DleCategory
  /** Formats de la partie, dans l'ordre ; `mode` : celui de la manche en cours. */
  modes: DleMode[]
  stage: number
  mode: DleMode
  /** Pause entre deux manches : départ de la suivante. */
  nextStageAt: string | null
  kind: RoomKind
  visibility: RoomVisibility
  phase: RoomPhase
  round: number
  version: number
  serverTime: string
  hostId: string
  you: string
  maxPlayers: number
  /** `null` : essais illimités. */
  maxGuesses: number | null
  roundSeconds: number
  startsAt: string | null
  endsAt: string | null
  /** Partie à plusieurs : elle rapporte des Poussières. */
  rewarded: boolean
  players: RoomPlayerView[]
  /** Mes essais (VERSUS) ou la grille commune (COOP), en entier : œuvres et verdicts. */
  mine: {
    guesses: RoomGuess[]
    done: boolean
    focus: { x: number; y: number } | null
    /** Chiffon : mes tuiles nettoyées (celles de l'équipe en COOP) et la part nettoyée. */
    sweep: { revealed: number[]; dirt: number } | null
  }
  /** Fin de manche : classement, réponse, et pour un invité son reçu de Poussières. */
  results: { standings: Standing[]; answer: EntitySummary; receipt: string | null; overall: OverallStanding[] | null } | null
}

const iso = (time: number | null) => (time === null ? null : new Date(time).toISOString())

async function viewFor(room: Room, userId: string): Promise<RoomView> {
  const now = Date.now()
  const me = room.players.get(userId)
  const answer = room.answer
  let mine: RoomView['mine'] = { guesses: [], done: false, focus: null, sweep: null }
  const game = gameOf(room.category)
  if (me && answer && room.phase !== 'lobby') {
    const { byId } = await game.pool()
    const played: (PlayedGuess & { by?: string; byName?: string | null })[] = room.kind === 'coop' ? room.shared : me.guesses
    mine = {
      guesses: played.flatMap((guess) => {
        const entity = byId.get(guess.cardId)
        return entity ? [{ ...guessResult(game, room.mode, entity, answer), by: guess.by ?? null, byName: guess.byName ?? null }] : []
      }),
      done: isDone(room, me),
      focus: room.focus,
      sweep: room.mode === 'sweep' ? { revealed: cleanTiles(revealedOf(room, me)), dirt: dirtOf(room, me) } : null,
    }
  }
  return {
    code: room.code,
    category: room.category,
    modes: room.modes,
    stage: room.stage,
    mode: room.mode,
    nextStageAt: iso(room.nextStageAt),
    kind: room.kind,
    visibility: room.visibility,
    phase: room.phase,
    round: room.round,
    version: room.version,
    serverTime: new Date(now).toISOString(),
    hostId: room.hostId,
    you: userId,
    maxPlayers: MAX_PLAYERS,
    maxGuesses: room.maxGuesses,
    roundSeconds: room.roundSeconds,
    startsAt: iso(room.startsAt),
    endsAt: iso(room.endsAt),
    rewarded: room.phase === 'lobby' ? room.players.size >= 2 : room.startedWith >= 2,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.profile.name,
      avatarUrl: player.profile.avatarUrl,
      avatar: player.profile.avatar,
      title: player.profile.title,
      isHost: player.id === room.hostId,
      trail: player.guesses.map((guess) => guess.trail),
      solved: room.kind === 'coop' ? room.teamSolvedMs !== null : player.solvedMs !== null,
      solvedMs: room.kind === 'coop' ? room.teamSolvedMs : player.solvedMs,
      done: isDone(room, player),
      gaveUp: player.gaveUp,
      left: player.left,
      spectating: (room.phase === 'countdown' || room.phase === 'playing') && !player.inRound,
      present: present(player, now),
      guest: player.guest,
      dirt: room.mode === 'sweep' && room.phase !== 'lobby' && player.inRound ? dirtOf(room, player) : null,
    })),
    mine,
    results:
      room.phase === 'results' && room.standings && answer
        ? {
            standings: room.standings,
            answer: game.summary(answer),
            receipt: me?.receipt ?? null,
            // Dernière manche d'une partie en plusieurs : le classement général.
            overall: room.modes.length > 1 && room.nextStageAt === null ? overallOf(room) : null,
          }
        : null,
  }
}

/* ---- Actions ------------------------------------------------------------------------ */

async function enter(room: Room, participant: Participant): Promise<void> {
  const userId = participant.id
  const previous = membership.get(userId)
  if (previous && previous !== room.code) {
    const other = rooms.get(previous)
    if (other) removePlayer(other, userId)
  }
  if (room.players.has(userId) && !room.players.get(userId)?.left) {
    membership.set(userId, room.code)
    return
  }
  if (room.players.size >= MAX_PLAYERS) throw conflict('Ce salon est complet.', 'room_full')
  const profile = await profileOf(participant)
  // Le salon a pu se remplir pendant la lecture du profil.
  if (room.players.size >= MAX_PLAYERS) throw conflict('Ce salon est complet.', 'room_full')
  room.players.set(userId, newPlayer(userId, profile, Date.now()))
  membership.set(userId, room.code)
  bump(room)
}

function freshCode(): string {
  for (;;) {
    const code = roomCode(secureRandom)
    if (!rooms.has(code)) return code
  }
}

function openRoom(hostId: string, category: DleCategory, modes: DleMode[], visibility: RoomVisibility, kind: RoomKind): Room {
  const room: Room = {
    code: freshCode(),
    category,
    modes,
    stage: 0,
    mode: modes[0] ?? 'classic',
    history: [],
    nextStageAt: null,
    kind,
    maxGuesses: null,
    roundSeconds: DEFAULT_ROUND_SECONDS,
    shared: [],
    teamSolvedMs: null,
    sharedRevealed: new Set(),
    visibility,
    hostId,
    phase: 'lobby',
    round: 0,
    version: 1,
    players: new Map(),
    answer: null,
    focus: null,
    used: new Set(),
    startsAt: null,
    endsAt: null,
    startedWith: 0,
    standings: null,
    finishing: false,
    waiters: new Set(),
    timers: new Map(),
    touchedAt: Date.now(),
  }
  rooms.set(room.code, room)
  return room
}

export async function createRoom(participant: Participant, category: DleCategory, modes: readonly DleMode[], visibility: RoomVisibility, kind: RoomKind = 'versus'): Promise<RoomView> {
  await gameOf(category).pool()
  const room = openRoom(participant.id, category, normalizeModes(modes), visibility, kind)
  try {
    await enter(room, participant)
  } catch (error) {
    rooms.delete(room.code)
    throw error
  }
  return viewFor(room, participant.id)
}

/** Partie rapide : un salon public qui attend des joueurs (même catégorie, formats et type), sinon un nouveau. */
export async function quickMatch(participant: Participant, category: DleCategory, requested: readonly DleMode[], kind: RoomKind = 'versus'): Promise<RoomView> {
  await gameOf(category).pool()
  const modes = normalizeModes(requested)
  const userId = participant.id
  const current = membership.get(userId)
  const mineRoom = current ? rooms.get(current) : undefined
  const fits = (room: Room) =>
    room.visibility === 'public' && room.category === category && room.modes.join() === modes.join() && room.kind === kind && room.phase === 'lobby'
  if (mineRoom && fits(mineRoom)) return viewFor(mineRoom, userId)

  const now = Date.now()
  const open = [...rooms.values()]
    .filter((room) => fits(room) && room.players.size < MAX_PLAYERS)
    .filter((room) => [...room.players.values()].some((player) => present(player, now)))
    // Le plus rempli d'abord : la partie démarre plus vite.
    .sort((a, b) => b.players.size - a.players.size || a.touchedAt - b.touchedAt)
  const room = open[0] ?? openRoom(userId, category, modes, 'public', kind)
  await enter(room, participant)
  return viewFor(room, userId)
}

export async function joinRoom(participant: Participant, code: string): Promise<RoomView> {
  const room = roomOf(code)
  // En pleine manche : on entre en spectateur, on jouera la suivante.
  await enter(room, participant)
  return viewFor(room, participant.id)
}

export interface RoomSettings {
  kind?: RoomKind
  /** Formats joués l'un après l'autre (Classique, Couverture ou les deux). */
  modes?: DleMode[]
  maxGuesses?: number | null
  roundSeconds?: number
}

/** L'hôte règle la partie (type, essais, durée), dans la salle d'attente seulement. */
export async function setRoomSettings(userId: string, code: string, settings: RoomSettings): Promise<RoomView> {
  const room = roomOf(code)
  memberOf(room, userId)
  if (room.hostId !== userId) throw new HttpError(403, 'not_host', 'Seul l’hôte peut régler la partie.')
  if (room.phase !== 'lobby' && !(room.phase === 'results' && room.nextStageAt === null)) throw conflict('La partie a déjà commencé.', 'room_started')
  if (settings.kind !== undefined) room.kind = settings.kind
  if (settings.modes !== undefined) {
    room.modes = normalizeModes(settings.modes)
    room.mode = room.modes[0] ?? 'classic'
  }
  if (settings.maxGuesses !== undefined) room.maxGuesses = settings.maxGuesses
  if (settings.roundSeconds !== undefined) room.roundSeconds = settings.roundSeconds
  bump(room)
  return viewFor(room, userId)
}

/** Raccourci : le type de partie seul. */
export const setRoomKind = (userId: string, code: string, kind: RoomKind) => setRoomSettings(userId, code, { kind })

export function leaveRoom(userId: string, code: string): void {
  const room = rooms.get(code)
  if (room) removePlayer(room, userId)
}

export async function startRoom(userId: string, code: string): Promise<RoomView> {
  const room = roomOf(code)
  memberOf(room, userId)
  if (room.hostId !== userId) throw new HttpError(403, 'not_host', 'Seul l’hôte peut lancer la partie.')
  if (room.phase !== 'lobby') throw conflict('La partie a déjà commencé.', 'room_started')
  await begin(room)
  return viewFor(room, userId)
}

/** Revanche : retour au salon d'attente, mêmes joueurs, nouvelle œuvre. */
export async function rematchRoom(userId: string, code: string): Promise<RoomView> {
  const room = roomOf(code)
  memberOf(room, userId)
  if (room.hostId !== userId) throw new HttpError(403, 'not_host', 'Seul l’hôte peut relancer une partie.')
  if (room.phase !== 'results' || room.nextStageAt !== null) throw conflict('La partie n’est pas terminée.', 'room_started')
  const now = Date.now()
  for (const player of room.players.values()) {
    if (player.id !== userId && !present(player, now)) {
      room.players.delete(player.id)
      if (membership.get(player.id) === room.code) membership.delete(player.id)
    }
  }
  room.phase = 'lobby'
  room.stage = 0
  room.mode = room.modes[0] ?? 'classic'
  room.history = []
  room.answer = null
  room.focus = null
  room.standings = null
  room.startsAt = null
  room.endsAt = null
  room.shared = []
  room.teamSolvedMs = null
  for (const player of room.players.values()) Object.assign(player, { guesses: [], solvedMs: null, gaveUp: false, inRound: false, receipt: null })
  bump(room)
  return viewFor(room, userId)
}

export async function guessRoom(userId: string, code: string, cardId: string): Promise<RoomView> {
  const room = roomOf(code)
  advance(room, Date.now())
  const player = memberOf(room, userId)
  if (room.phase === 'countdown') throw conflict('La partie n’a pas encore commencé.', 'not_started')
  if (room.phase !== 'playing' || room.finishing || !room.answer || room.startsAt === null) throw conflict('La manche est terminée.', 'round_over')
  if (!player.inRound) throw conflict('Tu joueras la prochaine manche.', 'spectating')
  if (isDone(room, player)) throw conflict('Tu as terminé cette manche.', 'already_done')
  const played = room.kind === 'coop' ? room.shared : player.guesses
  if (played.some((guess) => guess.cardId === cardId)) throw conflict('Déjà proposé.', 'already_guessed')
  const game = gameOf(room.category)
  const { byId } = await game.pool()
  const entity = byId.get(cardId)
  if (!entity) throw badRequest('Cette proposition ne fait pas partie du jeu.', 'unknown_work')

  // La manche a pu se terminer pendant la lecture des œuvres.
  if (room.phase !== 'playing' || room.finishing) throw conflict('La manche est terminée.', 'round_over')
  if (room.kind === 'coop' && (room.teamSolvedMs !== null || outOfGuesses(room, room.shared.length))) throw conflict('La manche est terminée.', 'round_over')
  const result = guessResult(game, room.mode, entity, room.answer)
  const guess = { cardId, correct: result.correct, trail: trailOf(room.mode, result.feedback, game.attributes, result.correct) }
  player.guesses.push(guess)
  player.lastSeen = Date.now()
  if (result.correct) player.solvedMs = Date.now() - room.startsAt
  // COOP : l'essai rejoint la grille commune, avec son auteur ; trouver, c'est gagner pour toute l'équipe.
  if (room.kind === 'coop') {
    room.shared.push({ ...guess, by: player.id, byName: player.profile.name })
    if (result.correct) room.teamSolvedMs = Date.now() - room.startsAt
  }

  const contenders = [...room.players.values()].filter((entry) => entry.inRound && !entry.left)
  if (contenders.every((entry) => isDone(room, entry))) await finish(room)
  else bump(room)
  return viewFor(room, userId)
}

/* ---- Chiffon ------------------------------------------------------------------------ */

/** La vitre d'un joueur : la sienne (VERSUS), celle de l'équipe (COOP). */
const revealedOf = (room: Room, player: Player): Set<number> => (room.kind === 'coop' ? room.sharedRevealed : player.revealed)

/** Part nettoyée (%) : tuiles révélées et erreurs (de l'équipe, en COOP). */
function dirtOf(room: Room, player: Player): number {
  const played = room.kind === 'coop' ? room.shared : player.guesses
  return sweepDirt(revealedOf(room, player).size, played.filter((guess) => !guess.correct).length)
}

/** Au plus, par coup de chiffon envoyé. */
const SWEEP_BATCH = 120
/** Les adversaires voient la progression des autres, sans réveiller tout le salon à chaque geste. */
const SWEEP_BUMP_MS = 400

/**
 * Coup de chiffon dans un salon : les tuiles frottées comptent (une fois chacune) tant que
 * le joueur cherche encore ; une fois sa manche finie, il peut tout dévoiler sans rien compter.
 */
export async function revealRoom(userId: string, code: string, wanted: readonly number[]): Promise<{ tiles: Record<number, string>; sweep: { revealed: number[]; dirt: number } }> {
  const room = roomOf(code)
  advance(room, Date.now())
  const player = memberOf(room, userId)
  const answer = room.answer
  if (room.mode !== 'sweep' || !answer || room.phase === 'lobby') throw conflict('Pas de Chiffon dans cette manche.', 'not_sweep')
  const asked = cleanTiles(wanted).slice(0, SWEEP_BATCH)
  // Pendant le décompte, seulement préparer la vitre (demande vide) : elle est prête au top départ.
  if (room.phase === 'countdown' && asked.length > 0) throw conflict('La partie n’a pas encore commencé.', 'not_started')
  const round = room.round
  const tiles = await sweepTiles(`room:${room.code}:${round}:${answer.id}`, () => gameOf(room.category).image(answer, `${room.code}:${round}`), room.category !== 'manga')
  // La manche a pu changer pendant la découpe.
  if (room.round !== round) throw conflict('La manche est terminée.', 'round_over')
  if (asked.length === 0) return { tiles: {}, sweep: { revealed: cleanTiles(revealedOf(room, player)), dirt: dirtOf(room, player) } }
  const glass = revealedOf(room, player)
  const counting = room.phase === 'playing' && player.inRound && !isDone(room, player)
  if (!counting) return { tiles: pickTiles(tiles, room.phase === 'results' || isDone(room, player) ? asked : asked.filter((index) => glass.has(index))), sweep: { revealed: cleanTiles(glass), dirt: dirtOf(room, player) } }
  const before = glass.size
  for (const index of asked) glass.add(index)
  player.lastSeen = Date.now()
  if (glass.size !== before && !room.timers.has('sweep')) schedule(room, 'sweep', Date.now() + SWEEP_BUMP_MS, () => bump(room))
  return { tiles: pickTiles(tiles, asked), sweep: { revealed: cleanTiles(glass), dirt: dirtOf(room, player) } }
}

/** Abandonner la manche : on reste dans le salon, au classement, sans avoir trouvé. */
export async function forfeitRoom(userId: string, code: string): Promise<RoomView> {
  const room = roomOf(code)
  advance(room, Date.now())
  const player = memberOf(room, userId)
  if ((room.phase !== 'playing' && room.phase !== 'countdown') || room.finishing) throw conflict('Aucune manche en cours.', 'round_over')
  if (!player.inRound || isDone(room, player)) return viewFor(room, userId)
  player.gaveUp = true
  const contenders = [...room.players.values()].filter((entry) => entry.inRound && !entry.left)
  if (contenders.every((entry) => isDone(room, entry))) await finish(room)
  else bump(room)
  return viewFor(room, userId)
}

/**
 * État du salon pour ce joueur, dès qu'il est plus récent que `since` (attente longue,
 * `WAIT_MS` au plus). Sans `since` : tout de suite. Chaque demande vaut signe de présence.
 */
export async function waitRoom(userId: string, code: string, since: number | null, signal: AbortSignal): Promise<RoomView> {
  const room = roomOf(code)
  advance(room, Date.now())
  const player = memberOf(room, userId)
  player.lastSeen = Date.now()
  if (since === null || since !== room.version) return viewFor(room, userId)

  player.watching += 1
  try {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        room.waiters.delete(done)
        signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, WAIT_MS)
      timer.unref()
      room.waiters.add(done)
      signal.addEventListener('abort', done, { once: true })
    })
  } finally {
    player.watching = Math.max(0, player.watching - 1)
    player.lastSeen = Date.now()
  }
  if (!rooms.has(code)) throw new HttpError(404, 'room_not_found', 'Ce salon n’existe pas ou est fermé.')
  if (!room.players.has(userId)) throw new HttpError(403, 'not_in_room', 'Tu ne fais pas partie de ce salon.')
  return viewFor(room, userId)
}

/** Ce qu'on cherche dans un salon à image (zoom, pixels), pour en servir l'image sans la nommer. */
export function roomZoomTarget(userId: string, code: string): { category: DleCategory; entity: DleEntity; seed: string } {
  const room = roomOf(code)
  const player = memberOf(room, userId)
  if (!isImageMode(room.mode) || !room.answer || room.phase === 'lobby') throw notFound('Pas d’image à montrer.')
  // Chiffon : l'image entière seulement pour qui a fini sa manche (sinon, tuile par tuile).
  if (room.mode === 'sweep' && room.phase !== 'results' && !isDone(room, player)) throw new HttpError(403, 'sweep_locked', 'Nettoie l’écran pour voir l’image.')
  // Image d'énigme propre à la manche : la même pour tous les joueurs du salon.
  return { category: room.category, entity: room.answer, seed: `${room.code}:${room.round}` }
}

/** Le salon où se trouve ce compte, s'il y en a un (reprise après un rechargement). */
export function currentRoomOf(userId: string): string | null {
  const code = membership.get(userId)
  return code && rooms.has(code) ? code : null
}

/* ---- Ménage --------------------------------------------------------------------------- */

/** Retire les absents des salons d'attente, ferme les salons abandonnés. */
export function sweepRooms(now = Date.now()): void {
  for (const room of rooms.values()) {
    if (room.phase === 'lobby' || room.phase === 'results') {
      for (const player of room.players.values()) {
        if (!present(player, now)) removePlayer(room, player.id)
        if (!rooms.has(room.code)) break
      }
    }
    if (!rooms.has(room.code)) continue
    const watched = [...room.players.values()].some((player) => player.watching > 0 || now - player.lastSeen < IDLE_ROOM_MS)
    if (!watched) destroy(room)
  }
}

const sweeper = setInterval(() => sweepRooms(), 10_000)
sweeper.unref()

/** Tests : repartir de zéro. */
export function resetRooms(): void {
  for (const room of rooms.values()) destroy(room)
  membership.clear()
}

/** Tests : l'œuvre cherchée dans un salon (jamais exposée par l'API avant la fin). */
export const roomAnswerForTests = (code: string): string | null => rooms.get(code)?.answer?.id ?? null
