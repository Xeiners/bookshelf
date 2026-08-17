import { useRef, useState } from 'react'
import { SearchX, Search as SearchIcon, WifiOff, X } from 'lucide-react'
import { useCatalog } from '../../hooks/useCatalog'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import type { Shelf } from '../../services/openLibrary'
import { SHELVES } from '../../services/openLibrary'
import { SearchResultRow } from './SearchResultRow'

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3.5">
      <div className="aspect-2/3 w-11 shrink-0 overflow-hidden rounded-lg bg-carbon">
        <div className="animate-shimmer h-full w-1/2 bg-linear-to-r from-transparent via-white/[0.06] to-transparent" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3 w-3/4 rounded-full bg-cream/[0.07]" />
        <div className="h-2.5 w-1/2 rounded-full bg-cream/[0.05]" />
        <div className="h-2 w-1/3 rounded-full bg-cream/[0.04]" />
      </div>
    </div>
  )
}

export function SearchView() {
  const [query, setQuery] = useState('')
  const [shelf, setShelf] = useState<Shelf>(SHELVES[0])
  const { books, phase, isSearching } = useCatalog(query, shelf)

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Signature légère : évite de concaténer 24 ids à chaque rendu.
  const signature = `${phase}:${books.length}:${books[0]?.id ?? ''}`

  useGSAP(
    () => {
      if (phase !== 'ready' || books.length === 0) return
      gsap.from('[data-row]', {
        y: 20,
        autoAlpha: 0,
        duration: 0.5,
        stagger: 0.035,
        ease: EASE.swift,
        overwrite: 'auto',
        clearProps: 'opacity,visibility,transform',
      })
    },
    { dependencies: [signature], revertOnUpdate: true, scope: listRef },
  )

  const selectShelf = (next: Shelf) => {
    // Choisir une étagère est une intention de parcours : on quitte la recherche.
    setQuery('')
    setShelf(next)
    inputRef.current?.blur()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5">
      <div className="glass flex items-center gap-2.5 rounded-full px-4 py-3">
        <SearchIcon size={16} className="shrink-0 text-mist" />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Titre, auteur, sujet…"
          aria-label="Rechercher un livre"
          className="min-w-0 flex-1 bg-transparent text-sm text-cream placeholder:text-mist focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Effacer la recherche"
            className="grid size-6 shrink-0 place-items-center rounded-full bg-cream/10 text-cream/70"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Suggestions du catalogue — toujours accessibles */}
      <div className="no-scrollbar -ml-5 flex gap-2 overflow-x-auto overscroll-x-contain py-1 pl-5">
        {SHELVES.map((item) => {
          const isActive = !isSearching && item.id === shelf.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => selectShelf(item)}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors duration-300 ${
                isActive ? 'bg-cream text-void' : 'glass text-cream/65'
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      <p className="text-[10px] tracking-[0.2em] text-mist uppercase">
        {isSearching ? `Résultats · ${query.trim()}` : `Catalogue · ${shelf.label}`}
      </p>

      <div
        ref={listRef}
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4"
      >
        {(phase === 'loading' || (phase === 'ready' && books.length > 0)) && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-x-6 xl:grid-cols-3">
            {phase === 'loading'
              ? Array.from({ length: 6 }, (_, index) => <RowSkeleton key={index} />)
              : books.map((book) => <SearchResultRow key={book.id} book={book} />)}
          </div>
        )}

        {phase === 'error' && (
          <div className="flex h-full flex-col items-center justify-center gap-4 pb-10 text-center">
            <div className="glass grid size-16 place-items-center rounded-full">
              <WifiOff size={22} className="text-gold" />
            </div>
            <div>
              <h2 className="font-display text-2xl">Catalogue injoignable</h2>
              <p className="mx-auto mt-2 max-w-[15rem] text-sm text-mist">
                Open Library ne répond pas. Vérifie ta connexion et réessaie.
              </p>
            </div>
          </div>
        )}

        {phase === 'ready' && books.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 pb-10 text-center">
            <div className="glass grid size-16 place-items-center rounded-full">
              <SearchX size={22} className="text-cream/70" />
            </div>
            <div>
              <h2 className="font-display text-2xl">Aucun résultat</h2>
              <p className="mx-auto mt-2 max-w-[15rem] text-sm text-mist">
                Essaie un titre plus court, ou pioche dans une étagère du catalogue.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
