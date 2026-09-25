/**
 * Catalogue : étagères du deck, résumés et traduction de la bibliothèque (API).
 * La recherche et les filtres passent par `services/browse.ts`.
 *
 * Chaque appel précise la langue voulue (`lang`) : l'API choisit titres,
 * résumés et genres dans cette langue, avec repli sur l'autre si la traduction
 * manque. La langue est un paramètre explicite (et non lue dans un store) pour
 * que les hooks la mettent dans leurs clés de cache et de rechargement.
 */
import type { Dictionary } from '../i18n/fr'
import type { Language } from '../i18n/languages'
import type { Book } from '../types/book'
import { api } from './api'

/** Id d'étagère : le contrat avec l'API ; les libellés vivent dans les dictionnaires. */
export type ShelfId = keyof Dictionary['shelves']['names']

export interface Shelf {
  id: ShelfId
}

/**
 * Étagères du deck : « Pour toi » (recommandations) en tête. L'origine
 * (manga / manhwa / manhua) y est un filtre à part, d'où l'absence de ces étagères.
 */
export const DECK_SHELVES: Shelf[] = (
  [
    'pour-toi',
    'tendances',
    'action',
    'romance',
    'fantasy',
    'isekai',
    'tranche-de-vie',
    'comedie',
    'mystere',
    'horreur',
    'psychologique',
    'arts-martiaux',
    'sport',
  ] as const
).map((id) => ({ id }))

/**
 * Les listes MangaDex contiennent déjà la description complète : on l'amorce
 * dans le cache, l'hydratation du deck ne refait donc aucune requête.
 * Clé par langue : le même titre a un résumé différent en fr et en en.
 */
const synopsisCache = new Map<string, string>()
const synopsisKey = (language: Language, id: string) => `${language}:${id}`

function prime(books: Book[], language: Language): Book[] {
  for (const book of books) synopsisCache.set(synopsisKey(language, book.id), book.synopsis)
  return books
}

/** Synopsis d'une œuvre dans une langue, depuis le cache ou la fiche détaillée. */
export async function fetchSynopsis(bookId: string, language: Language, signal?: AbortSignal): Promise<string> {
  const key = synopsisKey(language, bookId)
  const cached = synopsisCache.get(key)
  if (cached !== undefined) return cached

  const params = new URLSearchParams({ lang: language })
  const { book } = await api<{ book: Book }>(`/manga/${encodeURIComponent(bookId)}?${params.toString()}`, {
    signal,
  })
  // On mémorise même une chaîne vide : inutile de re-tenter une œuvre sans résumé.
  synopsisCache.set(key, book.synopsis)
  return book.synopsis
}

export function getCachedSynopsis(bookId: string, language: Language): string | undefined {
  return synopsisCache.get(synopsisKey(language, bookId))
}

/** Taille de lot acceptée par `/manga/batch`. */
export const BATCH_SIZE = 100

const MANGADEX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Seules les œuvres MangaDex peuvent être retraduites (pas les anciens livres Open Library). */
export const isMangadexId = (id: string) => MANGADEX_ID.test(id)

/** Fiches de plusieurs œuvres dans une langue (traduction de la bibliothèque). */
export async function fetchBooks(ids: string[], language: Language, signal?: AbortSignal): Promise<Book[]> {
  const params = new URLSearchParams({ ids: ids.join(','), lang: language })
  const { books } = await api<{ books: Book[] }>(`/manga/batch?${params.toString()}`, { signal })
  return prime(books, language)
}
