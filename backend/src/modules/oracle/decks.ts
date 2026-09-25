/**
 * Les deux « paquets » de l'Oracle. Les ids sont le contrat avec le front, qui
 * porte les libellés et les textes dans ses dictionnaires (`t.oracle.moods`,
 * `t.oracle.paces`) ; les filtres restent ici.
 */

export interface Mood {
  id: string
  /** Genres AniList exigés (ET) — tirage sur le catalogue agrégé. */
  genres: string[]
  /** Au moins un de ces tags AniList (pertinence ≥ 50 %). */
  anyTags?: string[]
  /** Noms anglais des tags MangaDex, combinés en ET — repli si le catalogue est vide. */
  tags: string[]
}

/** Carte 1 — L'Ambiance. Quinze ambiances : de quoi tomber sur de tout. */
export const MOODS: Mood[] = [
  { id: 'action', genres: ['Action'], tags: ['Action'] },
  { id: 'romance', genres: ['Romance'], tags: ['Romance'] },
  {
    id: 'dark-fantasy',
    genres: ['Fantasy'],
    anyTags: ['Tragedy', 'Gore', 'Revenge', 'Demons', 'Death Game', 'Anti-Hero'],
    tags: ['Fantasy', 'Tragedy'],
  },
  { id: 'sci-fi', genres: ['Sci-Fi'], tags: ['Sci-Fi'] },
  { id: 'comedy', genres: ['Comedy'], tags: ['Comedy'] },
  { id: 'mystery', genres: ['Mystery'], tags: ['Mystery'] },
  { id: 'slice-of-life', genres: ['Slice of Life'], tags: ['Slice of Life'] },
  { id: 'psychological', genres: ['Psychological'], tags: ['Psychological'] },
  { id: 'martial-arts', genres: [], anyTags: ['Martial Arts', 'Cultivation', 'Wuxia'], tags: ['Martial Arts'] },
  { id: 'isekai', genres: [], anyTags: ['Isekai', 'Reincarnation', 'Transmigration'], tags: ['Isekai'] },
  { id: 'horror', genres: ['Horror'], tags: ['Horror'] },
  { id: 'sports', genres: ['Sports'], tags: ['Sports'] },
  { id: 'drama', genres: ['Drama'], tags: ['Drama'] },
  { id: 'supernatural', genres: ['Supernatural'], tags: ['Supernatural'] },
  { id: 'adventure', genres: ['Adventure'], tags: ['Adventure'] },
]

export interface Pace {
  id: string
  /** Statut de parution demandé à MangaDex. */
  status?: 'completed' | 'ongoing'
  /** Bornes sur le dernier chapitre connu (filtrées après la requête). */
  maxChapters?: number
  minChapters?: number
}

/** Carte 2 — Le Rythme. */
export const PACES: Pace[] = [
  { id: 'short', status: 'completed', maxChapters: 60 },
  { id: 'epic', minChapters: 150 },
  { id: 'completed', status: 'completed' },
  { id: 'ongoing', status: 'ongoing' },
]

/** Le pavé respecte-t-il la contrainte de longueur du rythme ? (MangaDex) */
export function matchesPace(pace: Pace, lastChapter: string | null): boolean {
  if (pace.maxChapters === undefined && pace.minChapters === undefined) return true
  const chapters = Number.parseFloat(lastChapter ?? '')
  // Longueur inconnue : on ne peut pas promettre « courte » ou « épique ».
  if (!Number.isFinite(chapters) || chapters <= 0) return false
  if (pace.maxChapters !== undefined && chapters > pace.maxChapters) return false
  if (pace.minChapters !== undefined && chapters < pace.minChapters) return false
  return true
}

/** Parution depuis au moins 6 ans : ≈ 150 chapitres et plus au rythme hebdomadaire. */
const EPIC_RUNNING_YEARS = 6

/** Une œuvre du catalogue (AniList) respecte-t-elle le rythme ? */
export function matchesCatalogPace(
  pace: Pace,
  work: { status: string | null; chapters: number | null; year: number | null },
  currentYear = new Date().getFullYear(),
): boolean {
  if (pace.status === 'completed' && work.status !== 'FINISHED') return false
  if (pace.status === 'ongoing' && work.status !== 'RELEASING') return false
  if (pace.maxChapters !== undefined && !(work.chapters && work.chapters <= pace.maxChapters)) return false
  if (pace.minChapters !== undefined) {
    // AniList ne connaît le nombre de chapitres que des séries terminées :
    // une série en cours depuis longtemps compte comme une saga.
    const long = work.chapters !== null && work.chapters >= pace.minChapters
    const longRunning = work.status === 'RELEASING' && work.year !== null && currentYear - work.year >= EPIC_RUNNING_YEARS
    if (!long && !longRunning) return false
  }
  return true
}

/** L'œuvre porte-t-elle l'ambiance ? (catalogue) */
export function matchesMood(mood: Mood, features: { genres: string[]; tags: { name: string; rank: number }[] }): boolean {
  if (!mood.genres.every((genre) => features.genres.includes(genre))) return false
  if (mood.anyTags && !mood.anyTags.some((name) => features.tags.some((tag) => tag.name === name && tag.rank >= 50))) {
    return false
  }
  return true
}
