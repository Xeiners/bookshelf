import type { BoosterStatus, Rarity } from '../lib/boosters'
import { API_BASE, api } from './api'
import type { TitleId } from './profileApi'

/* BookshelfDLE et Poussières d'Étoile (cf. `backend/src/modules/dle/`, `backend/src/modules/stardust/`). */

export const DLE_MODES = ['classic', 'zoom', 'pixel', 'sweep'] as const
export type DleMode = (typeof DLE_MODES)[number]

/** Catégories : mangas et manhwas célèbres, univers de Naruto, One Piece, JoJo et Jujutsu Kaisen. */
export const DLE_CATEGORIES = ['manga', 'naruto', 'onepiece', 'jojo', 'jjk'] as const
export type DleCategory = (typeof DLE_CATEGORIES)[number]
export type Verdict = 'exact' | 'partial' | 'wrong'
export type Direction = 'higher' | 'lower'

export const ATTRIBUTES = ['origin', 'demographic', 'genres', 'themes', 'status', 'year', 'rarity', 'popularity'] as const
export type Attribute = (typeof ATTRIBUTES)[number]

/** Colonnes du mode classique pour les personnages de Naruto. */
export const NARUTO_ATTRIBUTES = ['affiliation', 'nature', 'role', 'gender', 'status', 'debut'] as const
export type NarutoAttribute = (typeof NARUTO_ATTRIBUTES)[number]

/** Colonnes du mode classique pour les personnages de One Piece. */
export const ONEPIECE_ATTRIBUTES = ['affiliation', 'fruit', 'haki', 'bounty', 'origin', 'debut'] as const

/** Colonnes du mode classique pour les personnages de JoJo's Bizarre Adventure. */
export const JOJO_ATTRIBUTES = ['power', 'stand', 'role', 'nationality', 'status', 'debut'] as const

/** Colonnes du mode classique pour les personnages de Jujutsu Kaisen. */
export const JJK_ATTRIBUTES = ['affiliation', 'grade', 'species', 'gender', 'status', 'debut'] as const

/** Colonnes du mode classique de chaque catégorie, dans l'ordre. */
export const CATEGORY_ATTRIBUTES: Record<DleCategory, readonly string[]> = {
  manga: ATTRIBUTES,
  naruto: NARUTO_ATTRIBUTES,
  onepiece: ONEPIECE_ATTRIBUTES,
  jojo: JOJO_ATTRIBUTES,
  jjk: JJK_ATTRIBUTES,
}

export interface AttributeFeedback {
  verdict: Verdict
  direction?: Direction
}

export interface AttributeValues {
  /** JP, KR, CN. */
  origin: string
  /** Public visé : shounen, shoujo, seinen, josei ; `null` : non renseigné. */
  demographic: string | null
  genres: string[]
  /** Thèmes MangaDex (noms anglais). */
  themes: string[]
  status: string | null
  year: number | null
  rarity: Rarity
  /** Palier de popularité, 0 → 4. */
  popularity: number
}

/** Une proposition : une œuvre (sa carte : rareté, numéro) ou un personnage (`null`). */
export interface WorkSummary {
  id: string
  /** Numéro dans l'album ; `null` : un personnage. */
  number: number | null
  name: string
  imageUrl: string
  rarity: Rarity | null
}

/** Œuvre proposable : `search` contient ses titres dans toutes les langues (minuscules, sans accents). */
export interface DleWorkOption extends WorkSummary {
  search: string
}

export interface GuessResult {
  work: WorkSummary
  correct: boolean
  /** Mode classique : un verdict par colonne de la catégorie. */
  feedback: Record<string, AttributeFeedback> | null
  /** Valeurs de la proposition (cf. `AttributeValues` pour les mangas). */
  values: Record<string, unknown> | null
}

export interface DailyView {
  day: string
  category: DleCategory
  mode: DleMode
  nextAt: string
  guesses: GuessResult[]
  solved: boolean
  reward: number
  focus: { x: number; y: number } | null
  /** Chiffon : la vitre du jour. */
  sweep: SweepState | null
  answer: WorkSummary | null
}

export interface DailyGuessResult {
  view: DailyView
  earned: number
  balance: number
  streak: number
}

export interface DleStats {
  dailyStreak: number
  dailyBest: number
  dailySolved: number
  roomsPlayed: number
  roomsWon: number
}

export interface DleOverview {
  day: string
  nextAt: string
  stardust: number
  boosterPrice: number
  stats: DleStats
  daily: Record<DleCategory, Record<DleMode, { attempts: number; solved: boolean; reward: number }>>
  /** Salon où se trouve le compte (reprise après un rechargement). */
  currentRoom: string | null
  /** Sans compte : l'invité (pseudo), s'il en a choisi un ; `null` pour un compte. */
  guest: DleGuest | null
}

export interface DleGuest {
  id: string
  name: string
}

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'results'
export type RoomVisibility = 'private' | 'public'
/** VERSUS : chacun sa grille, le plus rapide gagne. COOP : une grille commune, victoire collective. */
export const ROOM_KINDS = ['versus', 'coop'] as const
export type RoomKind = (typeof ROOM_KINDS)[number]

/** Réglages de l'hôte : essais par manche (`null` : illimités) et durée de la manche (s). */
export const GUESS_OPTIONS = [null, 5, 10, 15, 20, 30] as const
export const DURATION_OPTIONS = [60, 120, 180, 300, 600] as const

export interface RoomSettings {
  kind?: RoomKind
  /** Formats joués l'un après l'autre (Classique, Couverture ou les deux). */
  modes?: DleMode[]
  maxGuesses?: number | null
  roundSeconds?: number
}

/** Un essai vu dans un salon ; en COOP, avec son auteur. */
export type RoomGuess = GuessResult & { by: string | null; byName: string | null }

export interface RoomPlayer {
  id: string
  name: string | null
  avatarUrl: string | null
  avatar: { imageUrl: string; rarity: Rarity } | null
  title: TitleId | null
  isHost: boolean
  /** Couleurs de chaque essai, sans l'œuvre proposée. */
  trail: Verdict[][]
  solved: boolean
  solvedMs: number | null
  done: boolean
  gaveUp: boolean
  left: boolean
  spectating: boolean
  present: boolean
  /** Joue sans compte (pseudo d'invité). */
  guest: boolean
  /** Chiffon : part de sa vitre nettoyée (%) ; `null` dans les autres formats. */
  dirt: number | null
}

export interface Standing {
  id: string
  name: string | null
  rank: number
  solved: boolean
  solvedMs: number | null
  attempts: number
  reward: number
  left: boolean
  guest: boolean
  /** Chiffon : part nettoyée (%) ; `null` dans les autres formats. */
  dirt: number | null
}

/** Chiffon : les tuiles déjà nettoyées, et la part nettoyée (%, erreurs comprises). */
export interface SweepState {
  revealed: number[]
  dirt: number
}

/** Un coup de chiffon : les tuiles demandées (images `data:`), et la vitre à jour. */
export interface SweepReveal {
  tiles: Record<number, string>
  sweep: SweepState
}

/** Classement général d'une partie en plusieurs manches. */
export interface OverallStanding {
  id: string
  name: string | null
  rank: number
  points: number
  solved: number
  guest: boolean
}

export interface RoomView {
  code: string
  category: DleCategory
  /** Formats de la partie, dans l'ordre ; `mode` : celui de la manche en cours (`stage`). */
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
  rewarded: boolean
  players: RoomPlayer[]
  /** Mes essais (VERSUS) ou la grille commune (COOP). */
  mine: { guesses: RoomGuess[]; done: boolean; focus: { x: number; y: number } | null; sweep: SweepState | null }
  /** Fin de manche ; `receipt` : le reçu de Poussières d'un invité. */
  /** `overall` : classement général, à la fin d'une partie en plusieurs manches. */
  results: { standings: Standing[]; answer: WorkSummary; receipt: string | null; overall: OverallStanding[] | null } | null
}

export type StardustReason = 'dle_daily' | 'dle_room' | 'higher_lower' | 'bomb_party' | 'booster_purchase' | 'guest_claim'

export interface StardustWallet {
  balance: number
  boosterPrice: number
  history: { id: string; amount: number; reason: StardustReason; data: Record<string, unknown>; createdAt: string }[]
}

const room = (code: string) => `/dle/rooms/${encodeURIComponent(code)}`

export const dleApi = {
  overview: (signal?: AbortSignal) => api<DleOverview>('/dle', { signal }),
  works: (category: DleCategory, signal?: AbortSignal) =>
    api<{ works: DleWorkOption[] }>(`/dle/works?category=${category}`, { signal }).then((response) => response.works),
  daily: (category: DleCategory, mode: DleMode, signal?: AbortSignal) => api<DailyView>(`/dle/daily/${category}/${mode}`, { signal }),
  guessDaily: (category: DleCategory, mode: DleMode, cardId: string) =>
    api<DailyGuessResult>(`/dle/daily/${category}/${mode}/guess`, { method: 'POST', body: { cardId } }),
  /** Image de l'énigme du jour d'un format à image (zoom, pixels) : une adresse qui ne la nomme pas. */
  dailyImage: (category: DleCategory, mode: DleMode, day: string) => `${API_BASE}/dle/daily/${category}/${mode}/image?day=${encodeURIComponent(day)}`,

  /** Chiffon : frotter des tuiles de l'énigme du jour (chacune compte une fois). */
  dailyReveal: (category: DleCategory, tiles: number[]) => api<SweepReveal>(`/dle/daily/${category}/sweep/reveal`, { method: 'POST', body: { tiles } }),
  /** Chiffon dans un salon. */
  roomReveal: (code: string, tiles: number[]) => api<SweepReveal>(`${room(code)}/reveal`, { method: 'POST', body: { tiles } }),

  /** Jouer sans compte : un pseudo, gardé par le serveur dans un cookie signé. */
  guest: (name: string) => api<{ guest: DleGuest }>('/dle/guest', { method: 'POST', body: { name } }).then((response) => response.guest),
  createRoom: (category: DleCategory, modes: DleMode[], visibility: RoomVisibility, kind: RoomKind) =>
    api<RoomView>('/dle/rooms', { method: 'POST', body: { category, modes, visibility, kind } }),
  quickMatch: (category: DleCategory, modes: DleMode[], kind: RoomKind) =>
    api<RoomView>('/dle/rooms/quick', { method: 'POST', body: { category, modes, kind } }),
  /** L'hôte règle la partie : type, essais par manche, durée. */
  setSettings: (code: string, settings: RoomSettings) => api<RoomView>(`${room(code)}/settings`, { method: 'POST', body: settings }),
  join: (code: string) => api<RoomView>(`${room(code)}/join`, { method: 'POST' }),
  leave: (code: string) => api<void>(`${room(code)}/leave`, { method: 'POST' }),
  start: (code: string) => api<RoomView>(`${room(code)}/start`, { method: 'POST' }),
  rematch: (code: string) => api<RoomView>(`${room(code)}/rematch`, { method: 'POST' }),
  guessRoom: (code: string, cardId: string) => api<RoomView>(`${room(code)}/guess`, { method: 'POST', body: { cardId } }),
  forfeit: (code: string) => api<RoomView>(`${room(code)}/forfeit`, { method: 'POST' }),
  /** Attente longue : répond dès que le salon dépasse la version `since` (25 s au plus). */
  watch: (code: string, since: number | null, signal?: AbortSignal) =>
    api<RoomView>(`${room(code)}${since === null ? '' : `?v=${since}`}`, { signal }),
  roomImage: (code: string, round: number) => `${API_BASE}${room(code)}/image?round=${round}`,
}

export const stardustApi = {
  wallet: (signal?: AbortSignal) => api<StardustWallet>('/stardust', { signal }),
  /** 409 `not_enough_stardust` si le solde ne suffit pas. */
  buyBooster: () => api<{ balance: number; status: BoosterStatus }>('/stardust/booster', { method: 'POST' }),
  /** Reçus gagnés en invité → Poussières du compte (plafonné, chaque reçu une seule fois). */
  claim: (receipts: string[]) => api<{ balance: number; credited: number }>('/stardust/claim', { method: 'POST', body: { receipts } }),
}
