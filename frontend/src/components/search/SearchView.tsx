import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Search as SearchIcon, SearchX, SlidersHorizontal, Sparkles, Star, WifiOff, X } from 'lucide-react'
import { useCatalog } from '../../hooks/useCatalog'
import { useCollapse } from '../../hooks/useCollapse'
import { useLanguage, useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { activeFilterCount, effectiveSort, fetchGenres, type GenreFacet } from '../../services/browse'
import { useSearchStore } from '../../store/useSearchStore'
import { useUiStore } from '../../store/useUiStore'
import { CatalogCard } from './CatalogCard'
import { MemberSearch } from './MemberSearch'
import { NovelSearch } from './NovelSearch'
import { SearchFilters } from './SearchFilters'
import { SortMenu } from './SortMenu'

/**
 * Dernière demande de focus déjà servie. Au niveau du module : quand on arrive
 * d'une autre vue, SearchView n'est monté qu'après la transition — il doit alors
 * servir une demande restée en attente, pas seulement réagir à un changement.
 */
let servedFocusTick = 0

/** Distance avant le bas de la grille à laquelle on charge la page suivante. */
/** Distance (sous l'écran) à laquelle la page suivante est demandée : assez tôt pour ne jamais buter sur le bas. */
const PREFETCH_MARGIN = '0px 0px 1600px 0px'
/** Défilement vers le haut qui fait revenir la barre de recherche, et vers le bas qui la cache (px cumulés). */
const BAR_SHOW_DELTA = 10
const BAR_HIDE_DELTA = 24
/** En dessous : la barre reste toujours là (haut de la liste). */
const BAR_PINNED_TOP = 120

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
 * Page « Recherche » : tout le catalogue MangaDex (en cache côté API), en
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
  const scope = useSearchStore((state) => state.scope)
  const [panelOpen, setPanelOpen] = useState(false)
  const [genres, setGenres] = useState<GenreFacet[]>([])

  const { books, total, phase, hasMore, loadingMore, moreError, loadMore, sourceKey } = useCatalog(filters)

  const listRef = useRef<HTMLDivElement>(null)

  // En descendant dans les résultats, tout le haut disparaît : l'en-tête de l'app et le choix
  // Mangas / Romans / Membres (revenus seulement tout en haut, deux seuils pour ne pas clignoter),
  // puis la barre de recherche et les filtres — qui reviennent, eux, dès qu'on remonte un peu.
  const collapsed = useUiStore((state) => state.chromeCollapsed)
  const setCollapsed = useUiStore((state) => state.setChromeCollapsed)
  const scopeRef = useRef<HTMLDivElement>(null)
  useCollapse(scopeRef, collapsed, 12)
  const [barHidden, setBarHidden] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  useCollapse(barRef, barHidden, 12)
  /**
   * Dernière position, chemin parcouru dans le sens courant (px), et pause de la détection :
   * pendant que la barre se replie, la zone de défilement change de hauteur et le navigateur
   * peut corriger la position (tout en bas) — ce n'est pas un geste, la barre ne doit pas clignoter.
   */
  const scrollTrack = useRef({ top: 0, travel: 0, quietUntil: 0 })
  const showBar = (hidden: boolean) => {
    if (hidden === barHidden) return
    scrollTrack.current.quietUntil = performance.now() + 400
    scrollTrack.current.travel = 0
    setBarHidden(hidden)
  }
  const onListScroll = () => {
    const top = listRef.current?.scrollTop ?? 0
    if (top > 56) setCollapsed(true)
    else if (top < 8) setCollapsed(false)

    const track = scrollTrack.current
    const delta = top - track.top
    track.top = top
    if (delta === 0) return
    // Pendant la pause, une seule règle : en haut de la liste, la barre est toujours là.
    if (performance.now() < track.quietUntil) {
      if (top < BAR_PINNED_TOP) showBar(false)
      return
    }
    // Le chemin repart de zéro à chaque changement de sens : un petit geste vers le haut suffit.
    track.travel = Math.sign(delta) === Math.sign(track.travel) ? track.travel + delta : delta
    const typing = document.activeElement === inputRef.current
    if (top < BAR_PINNED_TOP || typing || track.travel <= -BAR_SHOW_DELTA) showBar(false)
    else if (track.travel >= BAR_HIDE_DELTA) showBar(true)
  }
  // Quitter le catalogue (romans, membres, autre vue) : tout se redéplie.
  useEffect(() => {
    if (scope !== 'catalog') setCollapsed(false)
    return () => setCollapsed(false)
  }, [scope, setCollapsed])
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

  // Défilement « génératif » : chaque tuile apparaît au moment où elle entre à l'écran (pas
  // quand sa page arrive), en cascade avec ses voisines. Une page ajoutée en bas ne rejoue
  // jamais l'entrée de la grille : seules les tuiles jamais vues sont mises en attente.
  const revealRef = useRef<IntersectionObserver | null>(null)
  const { contextSafe } = useGSAP({ scope: listRef })
  useEffect(() => {
    const root = listRef.current
    if (!root) return
    const reveal = contextSafe((tiles: Element[]) => {
      gsap.to(tiles, {
        y: 0,
        scale: 1,
        autoAlpha: 1,
        duration: 0.55,
        stagger: Math.min(0.06, 0.45 / tiles.length),
        ease: EASE.swift,
        clearProps: 'opacity,visibility,transform',
      })
    })
    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target)
        if (entering.length === 0) return
        for (const tile of entering) observer.unobserve(tile)
        // Dans l'ordre de la grille : la cascade descend ligne par ligne.
        entering.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        reveal(entering)
      },
      // Un peu avant le bord bas : la tuile finit d'apparaître quand on la regarde.
      { root, rootMargin: '0px 0px -6% 0px', threshold: 0.01 },
    )
    revealRef.current = observer
    return () => {
      observer.disconnect()
      revealRef.current = null
    }
  }, [contextSafe])

  const signature = `${phase}:${books.length}:${books[0]?.id ?? ''}`
  useGSAP(
    () => {
      if (phase !== 'ready') return
      const tiles = gsap.utils
        .toArray<HTMLElement>('[data-row]', listRef.current)
        .filter((tile) => !tile.hasAttribute('data-revealed'))
      if (tiles.length === 0) return
      for (const tile of tiles) tile.setAttribute('data-revealed', '')
      const observer = revealRef.current
      if (!observer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.set(tiles, { y: 28, scale: 0.95, autoAlpha: 0 })
      for (const tile of tiles) observer.observe(tile)
    },
    { dependencies: [signature], scope: listRef },
  )

  // Nouvelle recherche ou nouveaux filtres : on repart du haut. Ce défilement passe par
  // `onListScroll`, qui fait revenir la barre (en haut, elle est toujours là).
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

  if (scope === 'novels' || scope === 'members') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-5">
        <ScopeToggle />
        {scope === 'novels' ? <NovelSearch /> : <MemberSearch />}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5">
      <div ref={scopeRef} className="shrink-0">
        <ScopeToggle />
      </div>
      {/* Barre, filtres et compteur : un seul bloc, qui se replie en descendant et revient en remontant. */}
      <div ref={barRef} className="flex shrink-0 flex-col gap-3">
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
      </div>

      <div ref={listRef} onScroll={onListScroll} className="no-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pt-1 pb-4">
        {(phase === 'loading' || (phase === 'ready' && books.length > 0)) && (
          <div className={GRID}>
            {phase === 'loading'
              ? Array.from({ length: 12 }, (_, index) => <CardSkeleton key={index} />)
              : books.map((book) => <CatalogCard key={book.id} book={book} />)}
            {/* Tant qu'il reste des titres, des affiches fantômes attendent au bout : la suite se remplit à leur place. */}
            {phase === 'ready' && (loadingMore || (hasMore && !moreError)) &&
              Array.from({ length: 6 }, (_, index) => <CardSkeleton key={`more-${index}`} />)}
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

/** Mangas (catalogue MangaDex), romans (Open Library + Google Books) ou membres. */
function ScopeToggle() {
  const t = useT()
  const scope = useSearchStore((state) => state.scope)
  const setScope = useSearchStore((state) => state.setScope)
  return (
    <div role="radiogroup" aria-label={t.search.scopeLabel} className="glass flex w-full shrink-0 gap-1 rounded-full p-1 md:max-w-sm">
      {(['catalog', 'novels', 'members'] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={scope === value}
          onClick={() => {
            vibrate(6)
            setScope(value)
          }}
          className={`h-9 flex-1 rounded-full text-xs font-semibold transition-colors ${scope === value ? 'bg-cream text-void' : 'text-cream/70 hover:text-cream'}`}
        >
          {t.search.scopes[value]}
        </button>
      ))}
    </div>
  )
}
