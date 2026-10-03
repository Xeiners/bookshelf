import { RARITIES, type Rarity } from '../cards/boosters.logic.js'

/*
 * BookshelfDLE (logique pure, testée) : deviner une œuvre du set de cartes (catégorie
 * `manga`), ou un personnage d'un univers (`naruto`, cf. `naruto.characters.ts`),
 * façon Loldle. Deux modes :
 *  - `classic` : chaque essai compare huit attributs de l'œuvre proposée à ceux
 *    de l'œuvre cherchée (vert : identique, jaune : proche, rouge : faux, et
 *    une flèche quand la réponse est plus haute ou plus basse) ;
 *  - `zoom` : un détail de la couverture, qui se dézoome à chaque erreur ;
 *  - `pixel` : l'image en gros pixels, qui s'affinent à chaque erreur (nette à la quinzième) ;
 *  - `sweep` (Chiffon) : l'image cachée sous la buée, qu'on frotte tuile par tuile ; le
 *    moins on nettoie (et le moins on se trompe), le plus on gagne.
 */

export const DLE_MODES = ['classic', 'zoom', 'pixel', 'sweep'] as const
export type DleMode = (typeof DLE_MODES)[number]
export const isDleMode = (value: string): value is DleMode => (DLE_MODES as readonly string[]).includes(value)

/** Formats à image (zoom, pixels) : on devine d'après la couverture ou le portrait, pas d'après les attributs. */
export const isImageMode = (mode: DleMode) => mode !== 'classic'

/** Catégories : les mangas et manhwas célèbres, les univers de Naruto, One Piece, JoJo et Jujutsu Kaisen. */
export const DLE_CATEGORIES = ['manga', 'naruto', 'onepiece', 'jojo', 'jjk'] as const
export type DleCategory = (typeof DLE_CATEGORIES)[number]

/** Une œuvre jouable : une carte du set et ce que le catalogue en sait. */
export interface DleWork {
  /** Id de la carte. */
  id: string
  /** Numéro dans l'album. */
  number: number
  name: string
  imageUrl: string
  rarity: Rarity
  series: number
  /** JP (manga), KR (manhwa), CN (manhua). */
  country: string
  /** Genres MangaDex (noms anglais). */
  genres: string[]
  /** Thèmes MangaDex (noms anglais) : samouraïs, vie scolaire, magie… */
  themes: string[]
  /** Public visé : shounen, shoujo, seinen, josei ; `null` : non renseigné. */
  demographic: string | null
  /** ongoing | completed | hiatus | cancelled ; `null` : inconnu. */
  status: string | null
  year: number | null
  /** Lecteurs qui suivent l'œuvre sur MangaDex. */
  popularity: number
}

/* ---- Jour de l'énigme ------------------------------------------------------- */

const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Jour de l'énigme, `YYYY-MM-DD` à l'heure de Paris : la même énigme pour tout le monde. */
export const parisDay = (now: Date): string => PARIS_DAY.format(now)

const PARIS_OFFSET = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' })

/** Avance de Paris sur UTC à un instant donné, en minutes (60 l'hiver, 120 l'été). */
function parisOffsetMinutes(at: Date): number {
  const name = PARIS_OFFSET.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? ''
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name)
  if (!match) return 0
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0))
}

/** Prochain changement d'énigme : minuit à Paris (heure d'été ou d'hiver). */
export function nextParisMidnight(now: Date): Date {
  const [year = 1970, month = 1, day = 1] = parisDay(now).split('-').map(Number)
  const midnightUtc = Date.UTC(year, month - 1, day + 1)
  const first = midnightUtc - parisOffsetMinutes(new Date(midnightUtc)) * 60_000
  return new Date(midnightUtc - parisOffsetMinutes(new Date(first)) * 60_000)
}

/* ---- Mode classique ---------------------------------------------------------- */

export type Verdict = 'exact' | 'partial' | 'wrong'
/** Où se trouve la réponse par rapport à l'essai. */
export type Direction = 'higher' | 'lower'

export const ATTRIBUTES = ['origin', 'demographic', 'genres', 'themes', 'status', 'year', 'rarity', 'popularity'] as const
export type Attribute = (typeof ATTRIBUTES)[number]

export interface AttributeFeedback {
  verdict: Verdict
  direction?: Direction
}

export type ClassicFeedback = Record<Attribute, AttributeFeedback>

/** Valeurs de l'œuvre proposée, affichées dans ses tuiles (le front les traduit). */
export interface AttributeValues {
  origin: string
  demographic: string | null
  genres: string[]
  themes: string[]
  status: string | null
  year: number | null
  rarity: Rarity
  /** Palier de popularité, 0 (le plus confidentiel) → `POPULARITY_TIERS.length`. */
  popularity: number
}

/**
 * Paliers de lecteurs MangaDex : une popularité exacte ne se devine pas, un ordre de
 * grandeur si. Bornes choisies pour couper les œuvres du jeu en cinq tranches comparables.
 */
export const POPULARITY_TIERS = [50_000, 70_000, 100_000, 150_000] as const

export const popularityTier = (followers: number): number => POPULARITY_TIERS.filter((bound) => followers >= bound).length

/** Une année d'écart ou deux : « proche ». */
const YEAR_TOLERANCE = 2

const rarityRank = (rarity: Rarity) => RARITIES.indexOf(rarity)

/** Deux valeurs ordonnées : exactes, proches (à `tolerance` près), sinon fausses ; et le sens de la réponse. */
export function compareOrdered(guess: number | null, answer: number | null, tolerance: number): AttributeFeedback {
  if (guess === null || answer === null) return { verdict: guess === answer ? 'exact' : 'wrong' }
  if (guess === answer) return { verdict: 'exact' }
  return { verdict: Math.abs(guess - answer) <= tolerance ? 'partial' : 'wrong', direction: answer > guess ? 'higher' : 'lower' }
}

export const valuesOf = (work: DleWork): AttributeValues => ({
  origin: work.country,
  demographic: work.demographic,
  genres: [...work.genres].sort(),
  themes: [...work.themes].sort(),
  status: work.status,
  year: work.year,
  rarity: work.rarity,
  popularity: popularityTier(work.popularity),
})

/** Deux ensembles : identiques, qui se recoupent (proche), ou sans rien en commun (deux vides : identiques). */
export function compareSets(guess: readonly string[], answer: readonly string[]): AttributeFeedback {
  const guessed = new Set(guess)
  const shared = answer.filter((value) => guessed.has(value)).length
  const same = shared === answer.length && shared === guessed.size
  return { verdict: same ? 'exact' : shared > 0 ? 'partial' : 'wrong' }
}

/** Compare l'œuvre proposée à l'œuvre cherchée, attribut par attribut. */
export function compareWorks(guess: DleWork, answer: DleWork): ClassicFeedback {
  return {
    origin: { verdict: guess.country === answer.country ? 'exact' : 'wrong' },
    demographic: { verdict: guess.demographic === answer.demographic ? 'exact' : 'wrong' },
    genres: compareSets(guess.genres, answer.genres),
    themes: compareSets(guess.themes, answer.themes),
    status: { verdict: guess.status === answer.status ? 'exact' : 'wrong' },
    year: compareOrdered(guess.year, answer.year, YEAR_TOLERANCE),
    rarity: compareOrdered(rarityRank(guess.rarity), rarityRank(answer.rarity), 1),
    popularity: compareOrdered(popularityTier(guess.popularity), popularityTier(answer.popularity), 1),
  }
}

/**
 * Les couleurs d'un essai, sans rien de ce qui a été proposé : ce que voient les adversaires.
 * Classique : un verdict par attribut, dans l'ordre des colonnes ; zoom : trouvé ou pas.
 */
export function trailOf(mode: DleMode, feedback: Record<string, AttributeFeedback> | null, attributes: readonly string[], correct: boolean): Verdict[] {
  if (isImageMode(mode) || !feedback) return [correct ? 'exact' : 'wrong']
  return attributes.map((attribute) => feedback[attribute]?.verdict ?? 'wrong')
}

/** Points d'un essai pour départager ceux qui n'ont pas trouvé : 2 par vert, 1 par jaune. */
export const closeness = (trail: readonly Verdict[]): number =>
  trail.reduce((sum, verdict) => sum + (verdict === 'exact' ? 2 : verdict === 'partial' ? 1 : 0), 0)

/* ---- Mode couverture ---------------------------------------------------------- */

/** Grossissement selon le nombre d'erreurs : très près au départ, la couverture entière au bout. */
export const ZOOM_STEPS = [5, 3.8, 2.9, 2.25, 1.75, 1.4, 1.15, 1] as const

export const zoomScale = (errors: number): number => ZOOM_STEPS[Math.min(Math.max(0, errors), ZOOM_STEPS.length - 1)] ?? 1

/** Point de la couverture sur lequel on zoome, en % (jamais collé au bord). */
export function zoomFocus(random: () => number): { x: number; y: number } {
  const coordinate = () => Math.round(22 + random() * 56)
  return { x: coordinate(), y: coordinate() }
}

/* ---- Mode Chiffon ------------------------------------------------------------------- */

/**
 * Grille du Chiffon : l'image (480 × 640) découpée en tuiles de 20 px, servies une à une.
 * Assez fines pour que la part comptée suive la surface vraiment frottée.
 */
export const SWEEP_COLS = 24
export const SWEEP_ROWS = 32
export const SWEEP_TILES = SWEEP_COLS * SWEEP_ROWS
export const SWEEP_TILE_PX = 20
/** Une mauvaise réponse salit autant que nettoyer 5 % de l'écran : pas de liste essayée à l'aveugle. */
export const SWEEP_MISS_PENALTY = 38
/** Au-delà de ce nettoyage (%), plus de bonus : seule la base reste. */
export const SWEEP_BONUS_UNTIL = 60

export const isSweepTile = (value: number) => Number.isInteger(value) && value >= 0 && value < SWEEP_TILES

/** Part de l'image « nettoyée » (%) : tuiles révélées, plus la pénalité des erreurs. Plafonnée à 100. */
export const sweepDirt = (revealed: number, misses: number): number =>
  Math.min(100, Math.round(((revealed + Math.max(0, misses) * SWEEP_MISS_PENALTY) / SWEEP_TILES) * 100))

/**
 * Énigme du jour au Chiffon : 25 de base, jusqu'à 50 de plus pour un écran presque sale
 * (le bonus fond à mesure qu'on nettoie, nul à `SWEEP_BONUS_UNTIL` %), et la même
 * prime de série que les autres formats.
 */
export function sweepReward(dirt: number, streak: number): number {
  const clean = Math.max(0, Math.round(50 * (1 - Math.min(dirt, SWEEP_BONUS_UNTIL) / SWEEP_BONUS_UNTIL)))
  const loyalty = Math.min(Math.max(0, streak - 1), 5) * 5
  return 25 + clean + loyalty
}

/* ---- Poussières d'Étoile ---------------------------------------------------------- */

/**
 * Énigme du jour résolue : 25 de base, jusqu'à 40 de plus pour une réponse rapide
 * (−4 par essai supplémentaire), et +5 par jour de série au-delà du premier (+25 au plus).
 */
export function dailyReward(attempts: number, streak: number): number {
  const speed = Math.max(0, 40 - 4 * (Math.max(1, attempts) - 1))
  const loyalty = Math.min(Math.max(0, streak - 1), 5) * 5
  return 25 + speed + loyalty
}

/** Rang final d'une partie à plusieurs → Poussières. Trouver rapporte toujours plus que participer. */
export function roomReward(rank: number, solved: boolean): number {
  if (!solved) return 5
  return [40, 25, 15][rank - 1] ?? 10
}

/** Parties à plusieurs récompensées par compte, sur 24 h glissantes : pas de ferme à Poussières. */
export const ROOM_REWARDS_PER_DAY = 8

/* ---- Salons --------------------------------------------------------------------- */

/** Sans 0/O ni 1/I : un code se dicte et se recopie sans erreur. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6
export const ROOM_CODE = new RegExp(`^[${CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`)

export function roomCode(random: () => number): string {
  let code = ''
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  return code
}

/** Code tapé à la main : majuscules, sans espaces ni tiret (« bk-7q4 m2x » → « BK7Q4M2X »). */
export const normalizeRoomCode = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '')

export interface Contender {
  id: string
  solved: boolean
  /** Temps mis pour trouver (ms depuis le départ) ; `null` : pas trouvé. */
  solvedMs: number | null
  attempts: number
  /** Meilleur essai (cf. `closeness`), pour départager ceux qui n'ont pas trouvé. */
  best: number
  /** Chiffon : part nettoyée (%) ; entre deux joueurs qui ont trouvé, le moins nettoyé passe devant. */
  dirt?: number
}

/**
 * Classement d'une partie : d'abord ceux qui ont trouvé, du plus rapide au plus lent
 * (à égalité, le moins d'essais) ; puis les autres, du plus proche au plus loin.
 * Rang partagé en cas d'égalité parfaite.
 */
export function rankContenders(contenders: readonly Contender[]): (Contender & { rank: number })[] {
  const sorted = [...contenders].sort((a, b) => {
    if (a.solved !== b.solved) return a.solved ? -1 : 1
    if (a.solved && b.solved) return (a.dirt ?? 0) - (b.dirt ?? 0) || (a.solvedMs ?? 0) - (b.solvedMs ?? 0) || a.attempts - b.attempts
    return b.best - a.best || a.attempts - b.attempts
  })
  const tied = (a: Contender, b: Contender) =>
    a.solved === b.solved &&
    (a.solved ? (a.dirt ?? 0) === (b.dirt ?? 0) && a.solvedMs === b.solvedMs && a.attempts === b.attempts : a.best === b.best && a.attempts === b.attempts)
  const ranked: (Contender & { rank: number })[] = []
  for (const [index, contender] of sorted.entries()) {
    const previous = ranked[index - 1]
    ranked.push({ ...contender, rank: previous && tied(previous, contender) ? previous.rank : index + 1 })
  }
  return ranked
}
