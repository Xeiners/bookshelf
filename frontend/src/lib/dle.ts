import { CATEGORY_ATTRIBUTES, type DleCategory, type DleWorkOption, type RoomView, type Standing, type Verdict } from '../services/dleApi'

/*
 * BookshelfDLE côté client (logique pure, testée) : recherche d'une œuvre à
 * proposer, zoom de la couverture, horloge du salon, liens d'invitation.
 */

/** Minuscules, sans accents ni ponctuation : comme le texte de recherche envoyé par l'API. */
export function normalizeQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Œuvres à proposer pour une saisie, les plus probables d'abord : nom qui commence
 * par la saisie, puis un mot du nom, puis n'importe où dans le nom, puis un titre
 * alternatif (autre langue). Les œuvres déjà proposées sont écartées.
 */
export function searchWorks(works: readonly DleWorkOption[], query: string, excluded: ReadonlySet<string>, limit = 8): DleWorkOption[] {
  const wanted = normalizeQuery(query)
  if (!wanted) return []
  const scored: { work: DleWorkOption; score: number }[] = []
  for (const work of works) {
    if (excluded.has(work.id)) continue
    const name = normalizeQuery(work.name)
    const score = name.startsWith(wanted)
      ? 0
      : name.split(' ').some((word) => word.startsWith(wanted))
        ? 1
        : name.includes(wanted)
          ? 2
          : work.search.includes(wanted)
            ? 3
            : -1
    if (score >= 0) scored.push({ work, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.work.name.length - b.work.name.length || a.work.name.localeCompare(b.work.name))
    .slice(0, limit)
    .map(({ work }) => work)
}

/** Grossissement de la couverture selon le nombre d'erreurs (même échelle que l'API). */
export const ZOOM_STEPS = [5, 3.8, 2.9, 2.25, 1.75, 1.4, 1.15, 1] as const
export const zoomScale = (errors: number): number => ZOOM_STEPS[Math.min(Math.max(0, errors), ZOOM_STEPS.length - 1)] ?? 1

/** Paliers de popularité (lecteurs MangaDex), du plus confidentiel au plus suivi. */
export const POPULARITY_LABELS = ['< 50k', '50k – 70k', '70k – 100k', '100k – 150k', '150k +'] as const // i18n-ignore

/* ---- Horloge du salon ---------------------------------------------------------- */

/** Avance de l'horloge du serveur sur celle de l'appareil (ms), mesurée à la réception d'un état. */
export const clockOffset = (serverTime: string, receivedAt: number): number => Date.parse(serverTime) - receivedAt

/** Millisecondes avant une échéance du serveur, sur l'horloge de l'appareil corrigée. */
export function msUntil(deadline: string | null, offset: number, now: number): number | null {
  if (!deadline) return null
  return Math.max(0, Date.parse(deadline) - (now + offset))
}

/** `1:05`, `0:09` : chrono de la manche. */
export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Temps mis pour trouver : `12,4 s` sous la minute, `1:05` au-delà. */
export function formatSolveTime(ms: number, locale: string): string {
  if (ms < 60_000) return `${(ms / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`
  return formatClock(ms)
}

/** `HH:MM:SS` jusqu'à la prochaine énigme. */
export function formatCountdownLong(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}

/* ---- Salons --------------------------------------------------------------------- */

const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/

/** Code tapé à la main → code du salon (`bk-7q4 m2` → `BK7Q4M`), ou `null` s'il ne peut pas en être un. */
export function parseRoomCode(value: string): string | null {
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return CODE.test(code) ? code : null
}

/** `BK7Q4M` → `BK7·Q4M` : plus facile à lire à voix haute. */
export const displayRoomCode = (code: string) => `${code.slice(0, 3)}·${code.slice(3)}`

/** Invitation : `https://…/?dle=<code>`. Lu au démarrage, puis retiré de l'adresse (cf. `profileLink`). */
const PARAM = 'dle'
export const roomLink = (code: string, origin: string, pathname = '/') => `${origin}${pathname}?${PARAM}=${code}`

export function roomCodeFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(PARAM)
  return value ? parseRoomCode(value) : null
}

export function withoutRoomParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete(PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}

/** Un état plus récent que celui affiché (les réponses peuvent se croiser). */
export const isNewer = (next: RoomView, current: RoomView | null) =>
  current === null || next.code !== current.code || next.version >= current.version

export const standingOf = (room: RoomView, userId: string): Standing | null =>
  room.results?.standings.find((standing) => standing.id === userId) ?? null

/** Verts, jaunes et rouges d'un essai. */
export function verdictCounts(trail: readonly Verdict[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { exact: 0, partial: 0, wrong: 0 }
  for (const verdict of trail) counts[verdict] += 1
  return counts
}

/** Podium : 2ᵉ à gauche, 1ᵉʳ au centre, 3ᵉ à droite (s'ils existent). */
export function podiumOrder<T extends { rank: number }>(standings: readonly T[]): T[] {
  const top = standings.slice(0, 3)
  return top.length < 2 ? top : [top[1], top[0], top[2]].filter((entry): entry is T => entry !== undefined)
}

/** Poussières d'un reçu d'invité (cf. `backend/src/modules/dle/dle.guests.ts`) ; 0 s'il est illisible. */
export function receiptAmount(receipt: string): number {
  try {
    const payload = receipt.split('.')[0] ?? ''
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const value = JSON.parse(json) as { a?: unknown }
    return typeof value.a === 'number' && value.a > 0 ? value.a : 0
  } catch {
    return 0
  }
}

/**
 * Pixels : largeur de l'image, en pixels, selon les erreurs — très gros au départ,
 * de plus en plus fins ; `null` : l'image nette (quinzième erreur, ou victoire).
 */
export const PIXEL_STEPS = [8, 10, 12, 15, 18, 22, 27, 33, 40, 48, 58, 72, 90, 115, 150] as const

export function pixelColumns(errors: number): number | null {
  return errors >= PIXEL_STEPS.length ? null : (PIXEL_STEPS[Math.max(0, errors)] ?? null)
}

/* ---- Mode classique : rythme du retournement des tuiles --------------------------- */

/** Une tuile part toutes les `TILE_STAGGER` s et se retourne en `TILE_FLIP` s ; au premier essai, l'en-tête prend `HEAD_REVEAL` s. */
export const TILE_STAGGER = 0.16
export const TILE_FLIP = 0.45
export const HEAD_REVEAL = 0.45
/** Moment où la tuile, presque à plat, « se pose » : c'est là que sonne son verdict. */
export const TILE_LAND = 0.2

export const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Durée du retournement du dernier essai (s) : la victoire, ses sons et ses confettis
 * attendent que sa dernière tuile soit posée.
 */
export function classicRevealSeconds(category: DleCategory, guessCount: number, reduced = reducedMotion()): number {
  if (reduced) return 0
  const columns = 1 + CATEGORY_ATTRIBUTES[category].length
  return (guessCount === 1 ? HEAD_REVEAL : 0) + (columns - 1) * TILE_STAGGER + TILE_FLIP
}
