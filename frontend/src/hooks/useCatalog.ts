import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n'
import { browse, type BrowseFilters } from '../services/browse'
import type { Book } from '../types/book'

const DEBOUNCE_MS = 320
const PAGE_SIZE = 24

export type CatalogPhase = 'loading' | 'ready' | 'error'

export interface CatalogState {
  books: Book[]
  /** Nombre total de titres correspondant aux filtres. */
  total: number
  /** État de la première page : squelette, grille ou erreur plein écran. */
  phase: CatalogPhase
  /** Il reste des pages à charger. */
  hasMore: boolean
  loadingMore: boolean
  /** La dernière page n'a pas pu être chargée : on attend une relance explicite. */
  moreError: boolean
  /** Charge la page suivante. `force` relance après une erreur. */
  loadMore: (force?: boolean) => void
  /** Identifiant de la source affichée : change à chaque recherche ou filtre. */
  sourceKey: string
}

interface Feed {
  key: string
  books: Book[]
  total: number
  page: number
  hasMore: boolean
  phase: CatalogPhase
  loadingMore: boolean
  moreError: boolean
}

const emptyFeed = (key: string): Feed => ({
  key,
  books: [],
  total: 0,
  page: 0,
  hasMore: false,
  phase: 'loading',
  loadingMore: false,
  moreError: false,
})

/**
 * Source unique de la page Recherche : recherche libre + filtres + tri, en
 * défilement infini (les pages s'accumulent à chaque `loadMore`).
 *
 * La clé encode la langue et tous les filtres : changer l'un d'eux repart de la
 * première page. Seule la frappe est temporisée ; un tap sur un filtre est une
 * intention ferme, appliquée sur-le-champ. Chaque changement de source annule
 * ses requêtes en vol : une page tardive ne se greffe jamais sur la nouvelle.
 */
export function useCatalog(filters: BrowseFilters): CatalogState {
  const language = useLanguage()
  const normalized = { ...filters, query: filters.query.trim() }
  const sourceKey = `${language}|${JSON.stringify(normalized)}`

  const [feed, setFeed] = useState<Feed>(() => emptyFeed(sourceKey))

  /** Source active et son contrôleur : toute requête d'une autre source est ignorée. */
  const activeRef = useRef<{ key: string; controller: AbortController } | null>(null)
  const inflightRef = useRef(false)
  const feedRef = useRef(feed)
  const filtersRef = useRef({ filters: normalized, language })
  const lastQueryRef = useRef(normalized.query)
  useEffect(() => {
    feedRef.current = feed
    filtersRef.current = { filters: normalized, language }
  })

  // Première page, à chaque nouvelle source.
  useEffect(() => {
    activeRef.current?.controller.abort()
    const controller = new AbortController()
    activeRef.current = { key: sourceKey, controller }
    inflightRef.current = false

    const { filters: current, language: lang } = filtersRef.current
    const typing = current.query !== lastQueryRef.current
    lastQueryRef.current = current.query

    const timer = setTimeout(
      () => {
        browse(current, { language: lang, page: 1, limit: PAGE_SIZE, signal: controller.signal })
          .then(({ books, total, hasMore, supplement }) => {
            if (controller.signal.aborted) return
            setFeed({ ...emptyFeed(sourceKey), books, total, page: 1, hasMore, phase: 'ready' })
            if (!supplement) return
            // Recherche maigre : les titres rares de MangaDex arrivent APRÈS, sans
            // retarder l'affichage du catalogue.
            browse(current, { language: lang, page: 1, limit: PAGE_SIZE, signal: controller.signal, source: 'mangadex' })
              .then(({ books: extra }) => {
                if (controller.signal.aborted || extra.length === 0) return
                setFeed((state) => {
                  if (state.key !== sourceKey) return state
                  const seen = new Set(state.books.map((book) => book.id))
                  const fresh = extra.filter((book) => !seen.has(book.id))
                  return { ...state, books: [...state.books, ...fresh], total: state.total + fresh.length }
                })
              })
              .catch(() => undefined)
          })
          .catch(() => {
            if (controller.signal.aborted) return
            setFeed({ ...emptyFeed(sourceKey), phase: 'error' })
          })
      },
      typing ? DEBOUNCE_MS : 0,
    )

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [sourceKey])

  const loadMore = useCallback((force = false) => {
    const active = activeRef.current
    const current = feedRef.current
    // Juste après un changement de source, `feedRef` décrit encore l'ancienne.
    if (!active || current.key !== active.key) return
    if (current.phase !== 'ready' || !current.hasMore) return
    // Une page à la fois ; après une erreur, seule une relance explicite repart.
    if (inflightRef.current || (current.moreError && !force)) return

    const { key, controller } = active
    const next = current.page + 1
    const { filters: source, language: lang } = filtersRef.current
    inflightRef.current = true
    setFeed((state) => (state.key === key ? { ...state, loadingMore: true, moreError: false } : state))

    browse(source, { language: lang, page: next, limit: PAGE_SIZE, signal: controller.signal })
      .then(({ books, hasMore }) => {
        if (controller.signal.aborted) return
        setFeed((state) => {
          if (state.key !== key) return state
          const seen = new Set(state.books.map((book) => book.id))
          const fresh = books.filter((book) => !seen.has(book.id))
          return { ...state, books: [...state.books, ...fresh], page: next, hasMore, loadingMore: false }
        })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setFeed((state) => (state.key === key ? { ...state, loadingMore: false, moreError: true } : state))
      })
      .finally(() => {
        if (activeRef.current?.controller === controller) inflightRef.current = false
      })
  }, [])

  // Tant que la première page de la nouvelle source n'est pas arrivée, on
  // n'affiche pas l'ancienne liste (évite un flash de résultats périmés).
  const fresh = feed.key === sourceKey

  return {
    books: fresh ? feed.books : [],
    total: fresh ? feed.total : 0,
    phase: fresh ? feed.phase : 'loading',
    hasMore: fresh && feed.hasMore,
    loadingMore: fresh && feed.loadingMore,
    moreError: fresh && feed.moreError,
    loadMore,
    sourceKey,
  }
}
