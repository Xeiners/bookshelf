/** Statuts de lecture — pilote le tri de la bibliothèque. */
export type ReadingStatus = 'wishlist' | 'reading' | 'read'

/** Direction d'un swipe : 1 = droite (wishlist), -1 = gauche (skip). */
export type SwipeDirection = 1 | -1

/** Issue donnée à une carte du deck. */
export type SwipeIntent = 'wishlist' | 'skip' | 'read'

/** Modèle normalisé, indépendant de l'API source (Google Books / Open Library). */
export interface Book {
  id: string
  title: string
  subtitle: string | null
  authors: string[]
  /** URL de couverture HD, ou `null` → on génère une couverture procédurale. */
  cover: string | null
  synopsis: string
  categories: string[]
  /** Note moyenne /5 quand l'API la fournit. */
  rating: number | null
  ratingsCount: number
  pages: number | null
  year: number | null
  publisher: string | null
  previewLink: string | null
}

/** Une entrée sauvegardée dans « Mes livres ». */
export interface LibraryEntry {
  book: Book
  status: ReadingStatus
  addedAt: number
  /** Avancement 0 → 1, utilisé uniquement par le statut `reading`. */
  progress: number
}

export const STATUS_ORDER: ReadingStatus[] = ['read', 'reading', 'wishlist']

export const STATUS_LABEL: Record<ReadingStatus, string> = {
  read: 'Lus',
  reading: 'En cours',
  wishlist: 'Wishlist',
}

/** Couleur (token Tailwind) associée à chaque statut. */
export const STATUS_TOKEN: Record<ReadingStatus, string> = {
  read: 'var(--color-like)',
  reading: 'var(--color-gold)',
  wishlist: 'var(--color-glow)',
}
