import { useEffect, useState } from 'react'
import type { Shelf } from '../services/openLibrary'
import { fetchShelf, searchBooks } from '../services/openLibrary'
import type { Book } from '../types/book'

/** Longueur minimale avant de solliciter l'API. */
const MIN_QUERY = 2
const DEBOUNCE_MS = 380
const RESULT_LIMIT = 24

export type CatalogPhase = 'loading' | 'ready' | 'error'

export interface CatalogState {
  books: Book[]
  phase: CatalogPhase
  /** `true` dès que la saisie est exploitable ; sinon on présente le catalogue. */
  isSearching: boolean
}

/**
 * Source unique de la page Recherche : requête libre (debouncée) ou étagère du
 * catalogue (immédiate). Chaque changement annule la requête précédente, sans
 * quoi une réponse tardive écrase une plus récente.
 */
export function useCatalog(query: string, shelf: Shelf): CatalogState {
  const trimmed = query.trim()
  const isSearching = trimmed.length >= MIN_QUERY

  const [books, setBooks] = useState<Book[]>([])
  const [phase, setPhase] = useState<CatalogPhase>('loading')

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    setPhase('loading')

    // Pas de debounce pour une étagère : le tap est déjà une intention ferme.
    const timer = setTimeout(
      () => {
        const request = isSearching
          ? searchBooks(trimmed, { limit: RESULT_LIMIT, signal: controller.signal })
          : fetchShelf(shelf, { page: 1, limit: RESULT_LIMIT, signal: controller.signal })

        request
          .then((result) => {
            if (cancelled) return
            setBooks(result)
            setPhase('ready')
          })
          .catch(() => {
            if (cancelled || controller.signal.aborted) return
            setBooks([])
            setPhase('error')
          })
      },
      isSearching ? DEBOUNCE_MS : 0,
    )

    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed, isSearching, shelf])

  return { books, phase, isSearching }
}
