/**
 * Deck « Romans » : étagères thématiques en sujets Open Library, et « Pour
 * toi » bâti sur les romans déjà gardés — pur, testé (`backend/test/books.test.ts`).
 */
import type { Language } from '../../lib/language.js'

/** Étagères du deck en mode romans ; ids partagés avec le front (`NOVEL_SHELVES`). */
export const NOVEL_SHELF_IDS = [
  'pour-toi',
  'tendances',
  'romance',
  'fantasy',
  'thriller',
  'science-fiction',
  'mystere',
  'horreur',
  'historique',
  'young-adult',
  'classiques',
] as const
export type NovelShelfId = (typeof NOVEL_SHELF_IDS)[number]

/** Sujet Open Library de chaque étagère thématique. */
const SUBJECTS: Record<Exclude<NovelShelfId, 'pour-toi' | 'tendances'>, string> = {
  'romance': 'romance',
  'fantasy': 'fantasy',
  'thriller': 'thriller',
  'science-fiction': 'science fiction',
  'mystere': 'mystery',
  'horreur': 'horror',
  'historique': 'historical fiction',
  'young-adult': 'young adult fiction',
  'classiques': 'classics',
}

/** Mots qui trahissent un genre dans les sujets (libres) d'Open Library ou les catégories de Google Books. */
const GENRE_HINTS: [RegExp, keyof typeof SUBJECTS][] = [
  [/romance|love stor|amour/i, 'romance'],
  [/fantasy|fantastique|magic|dragons/i, 'fantasy'],
  [/thriller|suspense/i, 'thriller'],
  [/science.?fiction|dystop|space/i, 'science-fiction'],
  [/myster|detective|policier|crime/i, 'mystere'],
  [/horror|horreur|ghost/i, 'horreur'],
  [/historical|historique/i, 'historique'],
  [/young adult|jeunesse|teen/i, 'young-adult'],
  [/classic/i, 'classiques'],
]

/** Id d'une fiche de roman (Open Library ou Google Books), par opposition à une œuvre MangaDex. */
export const isNovelId = (id: string) => /^(ol|gb):/.test(id)

/**
 * Genres préférés d'après les romans gardés (wishlist, lus, en cours) : les
 * trois plus fréquents parmi leurs catégories. Vide sans historique de romans.
 */
export function favoriteGenres(liked: readonly { id: string; categories: readonly string[] }[], max = 3): (keyof typeof SUBJECTS)[] {
  const counts = new Map<keyof typeof SUBJECTS, number>()
  for (const book of liked) {
    if (!isNovelId(book.id)) continue
    // Un genre compte une fois par livre, même cité par plusieurs catégories.
    const genres = new Set(book.categories.flatMap((category) => GENRE_HINTS.filter(([pattern]) => pattern.test(category)).map(([, genre]) => genre)))
    for (const genre of genres) counts.set(genre, (counts.get(genre) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([genre]) => genre)
}

const OL_LANGUAGE: Record<Language, string> = { fr: 'fre', en: 'eng' }

const subjectClause = (subject: string) => (subject.includes(' ') ? `subject:"${subject}"` : `subject:${subject}`)

/**
 * Romans parus ces dernières années. Sans ce filtre, le tri par popularité
 * d'Open Library ne sert que des classiques (Austen, Dumas…) : seule
 * l'étagère « Classiques » s'en passe.
 */
export const RECENT_YEARS = 15
export const recentClause = (now: Date) => `first_publish_year:[${now.getFullYear() - RECENT_YEARS} TO *]`

/** Genres combinables (hors « Pour toi » et « Tendances »), dans l'ordre des étagères. */
export const isNovelGenre = (id: string): id is keyof typeof SUBJECTS => id in SUBJECTS

/**
 * Requête Open Library du deck, triée par popularité (`readinglog` : lecteurs
 * qui l'ont dans une liste) :
 *  - `genres` (plusieurs puces cochées) : l'un OU l'autre de ces sujets ;
 *  - sinon l'étagère : son sujet, « Tendances » (fiction), ou « Pour toi »
 *    (genres des romans déjà gardés, fiction sans historique).
 * Toujours des romans ayant une édition dans la langue voulue, et récents
 * sauf pour les classiques.
 */
export function novelShelfQuery(
  shelf: NovelShelfId,
  language: Language,
  liked: readonly { id: string; categories: readonly string[] }[] = [],
  genres: readonly string[] = [],
  now = new Date(),
): { q: string; sort: 'readinglog' } {
  const lang = `language:${OL_LANGUAGE[language]}`
  const recent = recentClause(now)
  const query = (picked: readonly (keyof typeof SUBJECTS)[]) => {
    const subjects = picked.map((genre) => subjectClause(SUBJECTS[genre]))
    const clause = subjects.length > 1 ? `(${subjects.join(' OR ')})` : subjects[0]!
    return picked.includes('classiques') ? `${clause} ${lang}` : `${clause} ${lang} ${recent}`
  }

  const picked = [...new Set(genres)].filter(isNovelGenre)
  if (picked.length > 0) return { q: query(picked), sort: 'readinglog' }
  if (shelf === 'tendances') return { q: `subject:fiction ${lang} ${recent}`, sort: 'readinglog' }
  if (shelf === 'pour-toi') {
    const favorites = favoriteGenres(liked)
    return { q: favorites.length > 0 ? query(favorites) : `subject:fiction ${lang} ${recent}`, sort: 'readinglog' }
  }
  return { q: query([shelf]), sort: 'readinglog' }
}
