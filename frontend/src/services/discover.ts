/**
 * Deck « Swipe & Match » : cartes classées par le moteur de recommandation de
 * l'API (catalogue MangaDex en cache, cf. `backend/src/services/`).
 *
 * Invité : l'historique local (titres aimés avec leurs genres, titres passés)
 * part avec la requête, le profil de goûts est calculé côté serveur à la volée.
 * Connecté : le serveur utilise le profil du compte, complété par cet historique.
 */
import type { Language } from '../i18n/languages'
import { useLibraryStore } from '../store/useLibraryStore'
import type { Book } from '../types/book'
import { api } from './api'
import { catalogOrigins, interleave, splitSeen, type DeckSource } from '../lib/deckSources'
import { isCatalogShelf, isNovelShelf, type ShelfId } from './catalog'

/** Filtre d'origine du catalogue (deck et recherche). */
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

/** Les deux moitiés d'un deck mêlé : le catalogue MangaDex et les romans. */
export type DeckPart = 'catalog' | 'novel'

export interface DeckOptions {
  shelf: ShelfId
  /** Genres cochés ensemble : chaque API ne reçoit que ceux qu'elle connaît. */
  genres?: readonly ShelfId[]
  /** Types cochés : mangas (par origine), romans, ou les deux. */
  sources: readonly DeckSource[]
  language: Language
  /** Cartes déjà dans la file : jamais renvoyées. */
  seen: string[]
  history: DeckHistory
  limit?: number
  /** « Nouvelle sélection » : les romans repartent d'ailleurs dans le classement. */
  round?: number
  /** Moitiés déjà épuisées pour cette file : plus interrogées. */
  exhausted?: ReadonlySet<DeckPart>
  signal?: AbortSignal
}

export interface DeckPage {
  books: Book[]
  hasMore: boolean
  personalized: boolean
  /** Reste-t-il des cartes, moitié par moitié (celles interrogées seulement). */
  parts: Partial<Record<DeckPart, boolean>>
}

type PartPage = { books: Book[]; hasMore: boolean; personalized: boolean }

/**
 * Une fournée du deck. Mangas et romans cochés ensemble : les deux API sont
 * interrogées en parallèle, chacune avec ses propres cartes vues, puis leurs
 * cartes sont mêlées une sur deux. Une moitié en panne n'empêche pas l'autre ;
 * les deux en panne → erreur (repli hors-ligne de l'appelant).
 */
export async function fetchDeck(options: DeckOptions): Promise<DeckPage> {
  const { shelf, sources, language, history, limit = 20, signal } = options
  const exhausted = options.exhausted ?? new Set<DeckPart>()
  const origins = catalogOrigins(sources)
  const genres = options.genres ?? []
  // Genres cochés : un côté n'est interrogé que s'il en connaît au moins un (« Isekai » : mangas seuls).
  const catalogGenres = genres.filter(isCatalogShelf)
  const novelGenres = genres.filter(isNovelShelf)
  const catalogServes = genres.length > 0 ? catalogGenres.length > 0 : isCatalogShelf(shelf)
  const novelServes = genres.length > 0 ? novelGenres.length > 0 : isNovelShelf(shelf)
  const wantCatalog = origins.length > 0 && catalogServes && !exhausted.has('catalog')
  const wantNovel = sources.includes('novel') && novelServes && !exhausted.has('novel')
  // Deux moitiés : chacune remplit un peu plus de la moitié de la fournée.
  const share = wantCatalog && wantNovel ? Math.ceil(limit / 2) + 2 : limit
  const seen = splitSeen(options.seen)

  const [catalog, novel] = await Promise.allSettled([
    wantCatalog
      ? api<PartPage>('/discover/deck', {
          method: 'POST',
          body: {
            shelf,
            genres: catalogGenres,
            origin: origins.length === 1 ? origins[0] : 'all',
            origins,
            lang: language,
            limit: share,
            seen: seen.catalog,
            liked: history.liked,
            skipped: history.skipped,
          },
          signal,
        })
      : Promise.resolve(null),
    wantNovel
      ? api<PartPage>('/books/discover', {
          method: 'POST',
          body: {
            shelf,
            genres: novelGenres,
            lang: language,
            limit: share,
            round: options.round ?? 0,
            seen: seen.novel,
            liked: history.liked,
            skipped: history.skipped,
          },
          signal,
        })
      : Promise.resolve(null),
  ])

  const requested = [wantCatalog && catalog, wantNovel && novel].filter((result): result is PromiseSettledResult<PartPage | null> => !!result)
  const failures = requested.filter((result) => result.status === 'rejected')
  if (requested.length > 0 && failures.length === requested.length) throw (failures[0] as PromiseRejectedResult).reason

  const pageOf = (result: PromiseSettledResult<PartPage | null>) => (result.status === 'fulfilled' ? result.value : null)
  const catalogPage = pageOf(catalog)
  const novelPage = pageOf(novel)
  const parts: DeckPage['parts'] = {}
  if (wantCatalog) parts.catalog = catalogPage?.hasMore ?? false
  if (wantNovel) parts.novel = novelPage?.hasMore ?? false
  return {
    books: interleave(catalogPage?.books ?? [], novelPage?.books ?? []),
    hasMore: Object.values(parts).some(Boolean),
    personalized: catalogPage?.personalized ?? novelPage?.personalized ?? false,
    parts,
  }
}

/** Retire les champs propres au deck avant d'enregistrer un titre en bibliothèque. */
export function withoutDeckFields(book: Book): Book {
  const clean = { ...book }
  delete clean.matchPercentage
  delete clean.discovery
  return clean
}
