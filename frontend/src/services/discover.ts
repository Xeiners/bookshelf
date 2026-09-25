/**
 * Deck « Swipe & Match » : cartes classées par le moteur de recommandation de
 * l'API (catalogue agrégé AniList + MangaDex, cf. `backend/src/services/`).
 *
 * Invité : l'historique local (titres aimés avec leurs genres, titres passés)
 * part avec la requête, le profil de goûts est calculé côté serveur à la volée.
 * Connecté : le serveur utilise le profil du compte, complété par cet historique.
 */
import type { Language } from '../i18n/languages'
import { useLibraryStore } from '../store/useLibraryStore'
import type { Book } from '../types/book'
import { api } from './api'
import type { ShelfId } from './catalog'

/** Filtre d'origine du deck. */
export type DeckOrigin = 'all' | 'manga' | 'manhwa' | 'manhua'
export const DECK_ORIGINS: DeckOrigin[] = ['all', 'manga', 'manhwa', 'manhua']

export interface DeckHistory {
  liked: { id: string; categories: string[]; rating: number | null; favorite: boolean; userRating: number | null }[]
  skipped: string[]
}

/**
 * Historique local envoyé au moteur : un invité n'a pas de profil en base, il
 * est calculé à partir de ceci. Favoris et notes pèsent dans ce calcul.
 */
export function libraryHistory(): DeckHistory {
  const { entries, skipped } = useLibraryStore.getState()
  return {
    liked: Object.values(entries).map((entry) => ({
      id: entry.book.id,
      categories: entry.book.categories.slice(0, 12),
      rating: entry.book.rating,
      favorite: entry.favorite ?? false,
      userRating: entry.userRating ?? null,
    })),
    skipped,
  }
}

export interface DeckOptions {
  shelf: ShelfId
  origin: DeckOrigin
  language: Language
  /** Cartes déjà dans la file : jamais renvoyées. */
  seen: string[]
  history: DeckHistory
  limit?: number
  signal?: AbortSignal
}

export interface DeckPage {
  books: Book[]
  hasMore: boolean
  personalized: boolean
}

export async function fetchDeck(options: DeckOptions): Promise<DeckPage> {
  const { shelf, origin, language, seen, history, limit = 20, signal } = options
  const { books, hasMore, personalized } = await api<DeckPage>('/discover/deck', {
    method: 'POST',
    body: { shelf, origin, lang: language, limit, seen, liked: history.liked, skipped: history.skipped },
    signal,
  })
  return { books, hasMore, personalized }
}

/** Retire les champs propres au deck avant d'enregistrer un titre en bibliothèque. */
export function withoutDeckFields(book: Book): Book {
  const clean = { ...book }
  delete clean.matchPercentage
  delete clean.discovery
  return clean
}
