import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Search as SearchIcon, SearchX, SlidersHorizontal, Sparkles, Star, WifiOff, X } from 'lucide-react'
import { useCatalog } from '../../hooks/useCatalog'
import { useLanguage, useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { activeFilterCount, effectiveSort, fetchGenres, type GenreFacet } from '../../services/browse'
import { useSearchStore } from '../../store/useSearchStore'
import { useUiStore } from '../../store/useUiStore'
import { CatalogCard } from './CatalogCard'
import { SearchFilters } from './SearchFilters'
import { SortMenu } from './SortMenu'

/**
 * Dernière demande de focus déjà servie. Au niveau du module : quand on arrive
 * d'une autre vue, SearchView n'est monté qu'après la transition — il doit alors
 * servir une demande restée en attente, pas seulement réagir à un changement.
 */
let servedFocusTick = 0

/** Distance avant le bas de la grille à laquelle on charge la page suivante. */
const PREFETCH_MARGIN = '0px 0px 900px 0px'

// i18n-ignore : classes CSS de la grille
const GRID = 'grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 md:grid-cols-4 md:gap-x-4 lg:grid-cols-5 2xl:grid-cols-6'

function CardSkeleton() {
  return (
    <div className="relative aspect-2/3 overflow-hidden rounded-2xl bg-carbon">
      <div className="animate-shimmer absolute inset-y-0 -left-full w-1/2 bg-linear-to-r from-transparent via-white/[0.05] to-transparent" />
      <div className="absolute inset-x-3 bottom-3 space-y-2">
        <div className="h-3 w-4/5 rounded-full bg-cream/[0.07]" />
        <div className="h-2 w-1/2 rounded-full bg-cream/[0.05]" />
      </div>
    </div>
  )
}

/** Puce d'un filtre actif : un tap la retire. */
function ActiveChip({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        vibrate(6)
        onRemove()
      }}
      aria-label={removeLabel}
      className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-glow/40 bg-glow/10 pr-2.5 pl-3.5 text-xs font-medium whitespace-nowrap text-cream"
    >
      {label}
      <X size={13} className="text-cream/60" />
    </button>
  )
}

/**
 * Page « Recherche » : tout le catalogue agrégé (AniList + MangaDex), en
 * grille d'affiches. Recherche plein texte (titres de toutes les langues,
 * auteurs), filtres combinables dans un panneau, tri, et le % de match de
 * chaque titre avec tes goûts.
 */
export function SearchView() {
  const t = useT()
  const language = useLanguage()
  const filters = useSearchStore((state) => state.filters)
  const update = useSearchStore((state) => state.update)
  const toggleGenre = useSearchStore((state) => state.toggleGenre)
  const [panelOpen, setPanelOpen] = useState(false)
  const [genres, setGenres] = useState<GenreFacet[]>([])

  const { books, total, phase, hasMore, loadingMore, moreError, loadMore, sourceKey } = useCatalog(filters)

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  /** La sentinelle est-elle dans la zone de préchargement ? */
  const nearEndRef = useRef(false)
  const focusTick = useUiStore((state) => state.searchFocusTick)

  const hasQuery = filters.query.trim().length > 0
  const filterCount = activeFilterCount(filters)

  // Genres proposés, libellés dans la langue courante.
  useEffect(() => {
    const controller = new AbortController()
    fetchGenres(language, controller.signal)
      .then(setGenres)
      .catch(() => undefined)
    return () => controller.abort()
  }, [language])
  const genreLabel = useMemo(() => new Map(genres.map((genre) => [genre.id, genre.label])), [genres])

  // Raccourci Ctrl/⌘ K : curseur dans le champ, texte existant sélectionné.
  useEffect(() => {
    if (focusTick <= servedFocusTick) return
    servedFocusTick = focusTick
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusTick])

  // Seules les tuiles jamais révélées s'animent : une page ajoutée en bas ne
  // rejoue pas l'entrée de toute la grille.
  const signature = `${phase}:${books.length}:${books[0]?.id ?? ''}`
  useGSAP(
    () => {
      if (phase !== 'ready') return
      const tiles = gsap.utils
        .toArray<HTMLElement>('[data-row]', listRef.current)
        .filter((tile) => !tile.hasAttribute('data-revealed'))
      if (tiles.length === 0) return
      for (const tile of tiles) tile.setAttribute('data-revealed', '')
      gsap.from(tiles, {
        y: 24,
        scale: 0.96,
        autoAlpha: 0,
        duration: 0.5,
        stagger: Math.min(0.03, 0.4 / tiles.length),
        ease: EASE.swift,
        clearProps: 'opacity,visibility,transform',
      })
    },
    { dependencies: [signature], scope: listRef },
  )

  // Nouvelle recherche ou nouveaux filtres : on repart du haut.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 })
  }, [sourceKey])

  // Sentinelle en bas de grille : son approche déclenche la page suivante.
  useEffect(() => {
    const root = listRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        nearEndRef.current = entry.isIntersecting
        if (entry.isIntersecting) loadMore()
      },
      { root, rootMargin: PREFETCH_MARGIN },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, phase])

  // L'observateur ne se redéclenche pas si la sentinelle reste visible : on enchaîne.
  useEffect(() => {
    if (nearEndRef.current && hasMore && !loadingMore) loadMore()
  }, [books.length, hasMore, loadingMore, loadMore])

  const chips: { key: string; label: string; remove: () => void }[] = [
    ...(filters.origin !== 'all'
      ? [{ key: 'origin', label: t.deck.origins[filters.origin], remove: () => update({ origin: 'all' }) }]
      : []),
    ...(filters.status !== 'any'
      ? [{ key: 'status', label: t.search.statuses[filters.status], remove: () => update({ status: 'any' }) }]
      : []),
    ...(filters.minScore > 0
      ? [{ key: 'score', label: `★ ${t.search.scoreAtLeast(filters.minScore / 20)}`, remove: () => update({ minScore: 0 }) }]
      : []),
    ...filters.genres.map((genre) => ({
      key: `genre-${genre}`,
      label: genreLabel.get(genre) ?? genre,
      remove: () => toggleGenre(genre),
    })),
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5">
      {/* Recherche */}
      <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-shadow focus-within:shadow-glow">
        <SearchIcon size={18} className="shrink-0 text-mist" />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          value={filters.query}
          onChange={(event) => update({ query: event.target.value })}
          placeholder={t.search.placeholder}
          aria-label={t.search.inputLabel}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-cream placeholder:text-mist focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {hasQuery && (
          <button
            type="button"
            onClick={() => {
              update({ query: '' })
              inputRef.current?.focus()
            }}
            aria-label={t.search.clear}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-cream/10 text-cream/70"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Filtres, tri, filtres actifs — au-dessus de la grille pour le menu de tri */}
      <div className="relative z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            vibrate(6)
            setPanelOpen(true)
          }}
          aria-haspopup="dialog"
          aria-label={filterCount > 0 ? t.search.filtersActive(filterCount) : t.search.filters}
          className={`flex h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-xs font-medium transition-colors ${
            filterCount > 0 ? 'bg-cream text-void' : 'glass text-cream/85'
          }`}
        >
          <SlidersHorizontal size={14} />
          {t.search.filters}
          {filterCount > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-void text-[10px] font-bold text-cream tabular-nums">
              {filterCount}
            </span>
          )}
        </button>

        <SortMenu sort={filters.sort} hasQuery={hasQuery} onChange={(sort) => update({ sort })} />

        {chips.length > 0 && (
          <div className="no-scrollbar -mr-5 flex min-w-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain pr-5">
            {chips.map((chip) => (
              <ActiveChip key={chip.key} label={chip.label} removeLabel={t.search.removeFilter(chip.label)} onRemove={chip.remove} />
            ))}
          </div>
        )}
      </div>

      {/* Compteur, et ce que « Pour toi » veut dire */}
      <div className="flex min-h-4 items-center gap-2 text-[10px] tracking-[0.2em] text-mist uppercase">
        {phase === 'ready' && <span className="tabular-nums">{t.search.count(total)}</span>}
        {effectiveSort(filters.sort, hasQuery) === 'match' && phase === 'ready' && (
          <span className="flex items-center gap-1 truncate tracking-normal normal-case">
            <Sparkles size={11} className="shrink-0 text-glow" />
            <span className="truncate">{t.search.matchHint}</span>
          </span>
        )}
      </div>

      <div ref={listRef} className="no-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pt-1 pb-4">
        {(phase === 'loading' || (phase === 'ready' && books.length > 0)) && (
          <div className={GRID}>
            {phase === 'loading'
              ? Array.from({ length: 12 }, (_, index) => <CardSkeleton key={index} />)
              : books.map((book) => <CatalogCard key={book.id} book={book} />)}
            {loadingMore && Array.from({ length: 4 }, (_, index) => <CardSkeleton key={`more-${index}`} />)}
          </div>
        )}

        {phase === 'ready' && books.length > 0 && (
          <div className="flex justify-center pt-6 pb-2">
            {moreError ? (
              <button
                type="button"
                onClick={() => loadMore(true)}
                className="glass flex items-center gap-2 rounded-full px-4 py-2.5 text-xs text-cream/75"
              >
                <RotateCcw size={13} />
                {t.search.retryMore}
              </button>
            ) : (
              !hasMore && (
                <p className="text-[10px] tracking-[0.2em] text-mist/70 uppercase">{t.search.end(books.length)}</p>
              )
            )}
          </div>
        )}

        {/* Sentinelle du défilement infini : toujours montée. */}
        <div ref={sentinelRef} aria-hidden className="h-px" />

        {phase === 'error' && (
          <div className="flex h-full flex-col items-center justify-center gap-4 pb-10 text-center">
            <div className="glass grid size-16 place-items-center rounded-full">
              <WifiOff size={22} className="text-gold" />
            </div>
            <div>
              <h2 className="font-display text-2xl">{t.search.unreachableTitle}</h2>
              <p className="mx-auto mt-2 max-w-[15rem] text-sm text-mist">{t.search.unreachableBody}</p>
            </div>
          </div>
        )}

        {phase === 'ready' && books.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 pb-10 text-center">
            <div className="glass grid size-16 place-items-center rounded-full">
              {filterCount > 0 ? <Star size={22} className="text-cream/70" /> : <SearchX size={22} className="text-cream/70" />}
            </div>
            <div>
              <h2 className="font-display text-2xl">{t.search.noResultsTitle}</h2>
              <p className="mx-auto mt-2 max-w-[16rem] text-sm text-mist">
                {filterCount > 0 ? t.search.noMatchBody : t.search.noResultsBody}
              </p>
            </div>
            {filterCount > 0 && (
              <button
                type="button"
                onClick={() => useSearchStore.getState().resetFilters()}
                className="rounded-full bg-cream px-5 py-2.5 text-xs font-semibold text-void"
              >
                {t.search.resetFilters}
              </button>
            )}
          </div>
        )}
      </div>

      {panelOpen && (
        <SearchFilters genres={genres} total={phase === 'ready' ? total : null} onClose={() => setPanelOpen(false)} />
      )}
    </div>
  )
}
