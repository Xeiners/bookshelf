/*
 * Actus : les nouveautés de Bookshelf, une carte illustrée par nouveauté (la plus récente en
 * tête). Textes dans les fichiers de langue (`news.items`), illustration dessinée par
 * `NewsVisual`. Pour publier : ajouter l'entrée EN TÊTE de `NEWS` et ses textes ; à la visite
 * suivante, chacun voit la nouveauté s'ouvrir une fois (fenêtre illustrée), puis la retrouve
 * dans la page Actus. Fonctions pures, testées (`frontend/test/news.test.ts`).
 */

export const NEWS_IDS = ['series3', 'edits', 'activities', 'stack', 'daily', 'dust', 'market', 'library', 'canvas'] as const
export type NewsId = (typeof NEWS_IDS)[number]

/** Où mène le bouton d'une actu. */
export type NewsAction = 'booster' | 'edits' | 'activities' | 'stack' | 'daily' | 'collection' | 'market' | 'library' | 'canvas'

export interface NewsEntry {
  id: NewsId
  /** Jour de publication (AAAA-MM-JJ). */
  date: string
  action: NewsAction | null
}

/** La plus récente d'abord. */
export const NEWS: readonly NewsEntry[] = [
  { id: 'series3', date: '2026-10-23', action: 'booster' },
  { id: 'edits', date: '2026-10-22', action: 'edits' },
  { id: 'activities', date: '2026-10-21', action: 'activities' },
  { id: 'stack', date: '2026-10-19', action: 'stack' },
  { id: 'daily', date: '2026-10-19', action: 'daily' },
  { id: 'dust', date: '2026-10-19', action: 'collection' },
  { id: 'market', date: '2026-10-19', action: 'market' },
  { id: 'library', date: '2026-10-19', action: 'library' },
  { id: 'canvas', date: '2026-10-19', action: 'canvas' },
]

/** Combien d'actus sont plus récentes que la dernière vue (toutes, si aucune ne l'a été). */
export function unseenCount(seenId: string | null, news: readonly NewsEntry[] = NEWS): number {
  if (!seenId) return news.length
  const index = news.findIndex((entry) => entry.id === seenId)
  return index === -1 ? news.length : index
}

const KEY = 'bookshelf:news:seen'

export function readSeenNews(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    // Stockage indisponible (navigation privée…) : tout paraît neuf, la fenêtre ne s'ouvre qu'une fois par visite.
    return null
  }
}

/** La plus récente est vue : la fenêtre ne se rouvrira qu'à la prochaine actu. */
export function markNewsSeen(): void {
  try {
    if (NEWS[0]) localStorage.setItem(KEY, NEWS[0].id)
  } catch {
    // Sans stockage, la fenêtre reviendra à la prochaine visite : acceptable.
  }
}

/** « 22 octobre » : la date d'une actu, dans la langue du site. */
export function newsDate(date: string, language: string): string {
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`))
}
