/** Statuts de lecture — pilote le tri de la bibliothèque. */
export type ReadingStatus = 'wishlist' | 'reading' | 'read'

/** Direction d'un swipe : 1 = droite (wishlist), -1 = gauche (skip). */
export type SwipeDirection = 1 | -1

/** Issue donnée à une carte du deck. */
export type SwipeIntent = 'wishlist' | 'skip' | 'read'

/** Origine éditoriale d'une œuvre. `book` = anciennes données Open Library. */
export type BookKind = 'manga' | 'manhwa' | 'manhua' | 'book'

export type PublicationStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled'

/* Les libellés (statuts, types, parution) vivent dans les dictionnaires : `t.status`, `t.kind`, `t.publication`. */

/**
 * Modèle normalisé, indépendant de la source. Contrat partagé avec l'API
 * (`backend/src/modules/books/book.schema.ts`) : toute évolution se fait des deux côtés.
 */
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

  /* Champs manga — optionnels : les bibliothèques existantes contiennent des livres. */
  kind?: BookKind
  publicationStatus?: PublicationStatus | null
  /** Dernier chapitre paru, quand MangaDex le connaît. */
  chapters?: number | null
  /** Langues de lecture disponibles parmi fr / en. */
  languages?: string[]
  /** Langue pour laquelle titre, résumé et genres ont été choisis (retraduction de la bibliothèque). */
  lang?: 'fr' | 'en'
  /** Langue réelle du résumé : diffère de `lang` quand l'API s'est repliée sur l'autre. */
  synopsisLanguage?: 'fr' | 'en' | null

  /* Champs du deck (moteur de recommandation) — jamais enregistrés en bibliothèque. */
  /** Compatibilité avec le profil de goûts, 0-100. */
  matchPercentage?: number
  /** Carte « découverte » : genre peu exploré mais très bien noté (1 carte sur 5). */
  discovery?: boolean
}

/** Une entrée sauvegardée dans « Mes livres ». */
export interface LibraryEntry {
  book: Book
  status: ReadingStatus
  addedAt: number
  /**
   * Dernière modification locale : arbitre la fusion avec le compte (la plus
   * récente gagne). Absent des entrées créées avant la synchronisation.
   */
  updatedAt?: number
  /** Avancement 0 → 1, utilisé uniquement par le statut `reading`. */
  progress: number
  /** Coup de cœur. Absent des entrées créées avant les favoris. */
  favorite?: boolean
  /** Note personnelle, 0,5 → 5 par demi-étoiles (titres lus). */
  userRating?: number | null
}

/** Onglets de « Ma biblio » : les trois statuts, plus les coups de cœur (tous statuts confondus). */
export type LibraryTab = ReadingStatus | 'favorites'
export const LIBRARY_TABS: LibraryTab[] = ['read', 'reading', 'wishlist', 'favorites']

/** Couleur des favoris (même rose que le tampon « Passer » : un cœur). */
export const FAVORITE_TOKEN = 'var(--color-nope)'

export const STATUS_ORDER: ReadingStatus[] = ['read', 'reading', 'wishlist']

/** Couleur (token Tailwind) associée à chaque statut. */
export const STATUS_TOKEN: Record<ReadingStatus, string> = {
  read: 'var(--color-like)',
  reading: 'var(--color-gold)',
  wishlist: 'var(--color-glow)',
}
