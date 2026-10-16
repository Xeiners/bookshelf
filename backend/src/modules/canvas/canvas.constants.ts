/*
 * Réglages de la toile partagée. Les limites protègent à la fois la base (un trait de 3 000
 * points au plus), les autres joueurs (un objet ne peut pas recouvrir tout l'écran) et le
 * serveur (débits). Le client en reçoit la liste à la connexion (`welcome`).
 */

/** Côté d'une case d'ancrage, en unités du monde (1 unité = 1 px à l'échelle 100 %). */
export const CELL = 4096
/** Le monde est « presque infini » : ±2 000 000 unités. */
export const WORLD_LIMIT = 2_000_000
/** Plus grande largeur ou hauteur d'un objet : pas de rectangle qui recouvre la toile. */
export const MAX_EXTENT = 4096

export const MAX_STROKE_POINTS = 3000
export const MAX_POLY_POINTS = 256
export const MAX_BEZIER_NODES = 128
export const MAX_TEXT = 200
export const MAX_TITLE = 40
export const MAX_STROKE_WIDTH = 256
export const MIN_STROKE_WIDTH = 0.25

/** Objets d'un compte par saison (le « budget d'encre »). */
export const MAX_OBJECTS_PER_USER = 25_000

/** Cadres réservables : taille, nombre par compte et par saison, collaborateurs. */
export const FRAME_MIN = 128
export const FRAME_MAX = 2048
export const FRAMES_PER_USER = 3
export const FRAME_COLLABORATORS = 8

/** Signalements de comptes différents qui masquent un objet en attendant un administrateur. */
export const REPORTS_TO_HIDE = 3
export const REPORT_REASONS = ['inappropriate', 'spam', 'hate', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
/** Signalements qu'un compte peut envoyer par heure. */
export const REPORTS_PER_HOUR = 12

/** « J'aime » : donnés par jour, Poussière par « j'aime » reçu, plafond de gain par jour. */
export const LIKES_PER_DAY = 40
export const LIKE_REWARD = 1
export const REWARD_PER_DAY = 60

/** Récompenses de fin de saison : les trois cadres les plus aimés (Poussières). */
export const SEASON_PODIUM = [100, 60, 30] as const

/** Débits : opérations (seau de jetons), messages en direct, curseur, bulles. */
export const OPS_BUCKET = { capacity: 40, refillPerSecond: 4 }
export const LIVE_BUCKET = { capacity: 60, refillPerSecond: 40 }
export const CURSOR_BUCKET = { capacity: 40, refillPerSecond: 30 }
export const CHAT_INTERVAL_MS = 2500
export const REACT_INTERVAL_MS = 700
export const MAX_CHAT = 80

/** Fréquence d'envoi des curseurs, et plafond de curseurs détaillés par image. */
export const CURSOR_TICK_MS = 66
export const MAX_CURSORS_PER_FRAME = 120
/** Positions de tous les connectés (liste des joueurs, « aller vers »), plus rarement. */
export const WHERE_TICK_MS = 3000
export const MAX_CONNECTIONS = 1500
export const MAX_CONNECTIONS_PER_USER = 3
export const MAX_MESSAGE_BYTES = 64 * 1024
/** Messages invalides tolérés avant de couper la connexion. */
export const MAX_STRIKES = 25

/** Un client voit un peu au-delà de son écran : les curseurs et traits proches arrivent déjà. */
export const VIEW_PADDING = 0.35
/** Demi-largeur maximale d'une zone regardée (au-delà : le client passe par les tuiles). */
export const MAX_VIEW_SPAN = 24_000

/** Pinceaux : ceux de départ, et ceux qui se débloquent (Poussières ou « j'aime » reçus). */
export interface Brush {
  id: string
  /** Prix en Poussières ; 0 : offert. */
  price: number
  /** « J'aime » reçus qui le débloquent gratuitement ; 0 : jamais ainsi. */
  likes: number
}

export const BRUSHES: readonly Brush[] = [
  { id: 'pen', price: 0, likes: 0 },
  { id: 'marker', price: 0, likes: 0 },
  { id: 'highlighter', price: 0, likes: 0 },
  { id: 'ink', price: 120, likes: 5 },
  { id: 'pencil', price: 120, likes: 8 },
  { id: 'neon', price: 200, likes: 15 },
  { id: 'tone', price: 200, likes: 25 },
  { id: 'sparkle', price: 300, likes: 40 },
]
export const BRUSH_IDS = BRUSHES.map((brush) => brush.id)
export const brushOf = (id: string) => BRUSHES.find((brush) => brush.id === id)
