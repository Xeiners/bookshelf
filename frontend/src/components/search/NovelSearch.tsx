import { useEffect, useRef, useState } from 'react'
import { BookText, Search as SearchIcon, SearchX, WifiOff, X } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { booksApi } from '../../services/booksApi'
import { useSearchStore } from '../../store/useSearchStore'
import type { Book } from '../../types/book'
import { CatalogCard } from './CatalogCard'

/** Pause de frappe avant d'interroger l'API (chaque recherche coûte deux sources). */
const DEBOUNCE_MS = 400

// i18n-ignore : classes CSS de la grille
const GRID = 'grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 md:grid-cols-4 md:gap-x-4 lg:grid-cols-5 2xl:grid-cols-6'

type Phase = { state: 'idle' } | { state: 'loading' } | { state: 'error' } | { state: 'ready'; books: Book[] }

/**
 * Recherche de romans (FR / EN) : fiches Open Library + Google Books fusionnées
 * par l'API. Chaque résultat est une fiche `Book` comme celles du catalogue :
 * même carte, même fiche détaillée, ajout à la bibliothèque identique.
 */
export function NovelSearch() {
  const t = useT()
  const language = useLanguage()
  const query = useSearchStore((state) => state.novelQuery)
  const setQuery = useSearchStore((state) => state.setNovelQuery)
  const [fetched, setFetched] = useState<Phase>({ state: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const term = query.trim()
  // Requête trop courte : rien à chercher, quel que soit le dernier résultat.
  const phase: Phase = term.length < 2 ? { state: 'idle' } : fetched

  useEffect(() => {
    if (term.length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setFetched({ state: 'loading' })
      booksApi
        .search(term, language, controller.signal)
        .then((books) => setFetched({ state: 'ready', books }))
        .catch(() => {
          if (!controller.signal.aborted) setFetched({ state: 'error' })
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [term, language])

  const results = phase.state === 'ready' ? phase.books : []
  useGSAP(
    () => {
      if (results.length === 0) return
      gsap.from('[data-row]', {
        y: 24,
        scale: 0.96,
        autoAlpha: 0,
        duration: 0.5,
        stagger: Math.min(0.03, 0.4 / results.length),
        ease: EASE.swift,
        clearProps: 'opacity,visibility,transform',
      })
    },
    { dependencies: [fetched], scope: listRef },
  )

  const empty = phase.state !== 'loading' && results.length === 0

  return (
    <>
      <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-shadow focus-within:shadow-glow">
        <SearchIcon size={18} className="shrink-0 text-mist" />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.search.novels.placeholder}
          aria-label={t.search.novels.inputLabel}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-cream placeholder:text-mist focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label={t.search.clear}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-cream/10 text-cream/70"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <p className="min-h-4 text-[10px] tracking-[0.2em] text-mist uppercase">
        {phase.state === 'ready' ? t.search.count(results.length) : t.search.novels.sources}
      </p>

      <div ref={listRef} className="no-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pt-1 pb-4">
        {phase.state === 'loading' && (
          <div className={GRID}>
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="relative aspect-2/3 overflow-hidden rounded-2xl bg-carbon">
                <div className="animate-shimmer absolute inset-y-0 -left-full w-1/2 bg-linear-to-r from-transparent via-white/[0.05] to-transparent" />
              </div>
            ))}
          </div>
        )}

        {results.length > 0 && (
          <div className={GRID}>
            {results.map((book) => (
              <CatalogCard key={book.id} book={book} />
            ))}
          </div>
        )}

        {empty && (
          <div className="flex h-full flex-col items-center justify-center gap-4 pb-10 text-center">
            <div className="glass grid size-16 place-items-center rounded-full">
              {phase.state === 'error' ? (
                <WifiOff size={22} className="text-gold" />
              ) : phase.state === 'ready' ? (
                <SearchX size={22} className="text-cream/70" />
              ) : (
                <BookText size={22} className="text-cream/70" />
              )}
            </div>
            <div>
              <h2 className="font-display text-2xl">
                {phase.state === 'error' ? t.search.unreachableTitle : phase.state === 'ready' ? t.search.noResultsTitle : t.search.novels.hintTitle}
              </h2>
              <p className="mx-auto mt-2 max-w-[17rem] text-sm text-mist">
                {phase.state === 'error' ? t.search.unreachableBody : phase.state === 'ready' ? t.search.novels.noResultsBody : t.search.novels.hintBody}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
