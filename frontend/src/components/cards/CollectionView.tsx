import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gift, Heart, Search } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'
import { useT } from '../../i18n'
import {
  DEFAULT_FILTER,
  RARITIES,
  RARITY_STYLE,
  completion,
  filterCollection,
  type CollectionCard,
  type CollectionFilter,
  type Ownership,
} from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { useUiStore } from '../../store/useUiStore'
import { CardZoom } from './CardZoom'
import { CollectibleCard } from './CollectibleCard'

const GAP = 12

/**
 * Rangées montées d'un coup, puis à chaque approche du bas de l'album : 600
 * cartes créées d'un seul bloc (pendant que la page glisse) faisaient ramer
 * l'entrée sur téléphone.
 */
const ROWS_PER_PAGE = 8

/** Colonnes de l'album selon la largeur disponible. */
const columnsFor = (width: number) => (width >= 1100 ? 6 : width >= 760 ? 5 : width >= 480 ? 4 : 3)

/**
 * « Ma collection » : l'album de toutes les cartes du set. Les cartes pas
 * encore obtenues sont en ombre chinoise. Filtres combinables : rareté,
 * possédées / manquantes, titre de l'œuvre. Toucher une carte obtenue
 * l'affiche en grand.
 */
export function CollectionView() {
  const t = useT()
  const { data, status, retry, signedIn } = useCollection()
  const openAuth = useUiStore((state) => state.openAuth)
  const [filter, setFilter] = useState<CollectionFilter>(DEFAULT_FILTER)
  const [zoomed, setZoomed] = useState<CollectionCard | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridWidth, setGridWidth] = useState(0)

  useEffect(() => {
    const node = gridRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setGridWidth(Math.floor(entry?.contentRect.width ?? 0)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const cards = useMemo(() => (data ? filterCollection(data.cards, filter) : []), [data, filter])
  const columns = columnsFor(gridWidth)
  const cardWidth = gridWidth > 0 ? Math.floor((gridWidth - GAP * (columns - 1)) / columns) : 0

  // Affichage progressif. Un autre filtre repart de la première page (dérivé, pas d'effet).
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const pageSize = columns * ROWS_PER_PAGE
  const [page, setPage] = useState({ filter, count: pageSize })
  const shown = page.filter === filter ? Math.max(page.count, pageSize) : pageSize
  const hasMore = shown < cards.length

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!hasMore || !sentinel) return
    // Recréé à chaque page : s'il est encore visible (grand écran), la suivante suit aussitôt.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setPage({ filter, count: shown + pageSize })
      },
      { root: scrollRef.current, rootMargin: '0px 0px 800px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, filter, shown, pageSize])

  const progressRef = useRef<HTMLDivElement>(null)
  const percent = data ? completion(data.owned, data.total) : 0
  useGSAP(
    () => {
      gsap.fromTo('[data-progress-fill]', { scaleX: 0 }, { scaleX: percent / 100, duration: 1, ease: EASE.glide })
    },
    { scope: progressRef, dependencies: [percent] },
  )

  const ownership: { id: Ownership; label: string }[] = [
    { id: 'all', label: t.cards.filters.all },
    { id: 'owned', label: t.cards.filters.owned },
    { id: 'missing', label: t.cards.filters.missing },
  ]

  return (
    <div ref={scrollRef} className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-8">
      {/* Invité : ses cartes d'essai ne vivent que sur l'appareil, jusqu'à l'inscription. */}
      {!signedIn && (
        <div className="mb-3 flex items-center gap-3 rounded-3xl border border-[#ffe39a]/25 bg-black/40 p-4">
          <p className="min-w-0 flex-1 text-sm text-cream/80">{t.activities.guest.banner}</p>
          <button type="button" onClick={openAuth} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-semibold text-void">
            <Gift size={14} aria-hidden />
            {t.activities.guest.keep}
          </button>
        </div>
      )}
      {/* Progression */}
      <div ref={progressRef} className="glass rounded-3xl p-4">
        <p className="text-sm font-semibold text-cream tabular-nums">{data ? t.cards.progress(data.owned, data.total) : '—'}</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream/10">
          <div data-progress-fill className="h-full origin-left rounded-full bg-gradient-to-r from-glow via-nope to-gold" style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
        {data && (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {RARITIES.map((rarity) => (
              <li key={rarity} className="flex items-center gap-1.5 text-[11px] text-mist tabular-nums">
                <span aria-hidden className="size-2 rounded-full" style={{ background: RARITY_STYLE[rarity].color }} />
                {t.cards.rarity[rarity]} {data.byRarity[rarity].owned}/{data.byRarity[rarity].total}
              </li>
            ))}
          </ul>
        )}
        {hasMore && cardWidth > 0 && <div ref={sentinelRef} aria-hidden className="h-px" />}
      </div>

      {/* Filtres */}
      <div role="group" aria-label={t.cards.filters.label} className="mt-4 flex flex-col gap-3">
        <label className="glass flex h-11 items-center gap-2 rounded-full px-4 focus-within:ring-1 focus-within:ring-glow/60">
          <Search size={16} className="shrink-0 text-mist" aria-hidden />
          <input
            type="search"
            value={filter.query}
            onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
            placeholder={t.cards.filters.search}
            aria-label={t.cards.filters.search}
            className="min-w-0 flex-1 bg-transparent text-sm text-cream outline-none placeholder:text-mist"
          />
        </label>
        <div className="glass flex self-start rounded-full p-1" role="radiogroup" aria-label={t.cards.filters.series}>
          {(['all', 1, 2] as const).map((series) => (
            <button
              key={series}
              type="button"
              role="radio"
              aria-checked={filter.series === series}
              onClick={() => setFilter((current) => ({ ...current, series }))}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${filter.series === series ? 'bg-glow text-white' : 'text-cream/75'}`}
            >
              {series === 'all' ? t.cards.filters.all : t.cards.filters.seriesName(series)}
            </button>
          ))}
        </div>
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5" role="radiogroup" aria-label={t.cards.filters.rarity}>
          {(['all', ...RARITIES] as const).map((rarity) => {
            const active = filter.rarity === rarity
            const color = rarity === 'all' ? '#f7f5f0' : RARITY_STYLE[rarity].color
            return (
              <button
                key={rarity}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setFilter((current) => ({ ...current, rarity }))}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${active ? 'text-void' : 'text-cream/80'}`}
                style={{ borderColor: `color-mix(in oklab, ${color} 55%, transparent)`, background: active ? color : 'transparent' }}
              >
                {rarity === 'all' ? t.cards.filters.all : t.cards.rarity[rarity]}
              </button>
            )
          })}
        </div>
        <div className="glass flex self-start rounded-full p-1" role="radiogroup" aria-label={t.cards.filters.label}>
          {ownership.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={filter.ownership === option.id}
              onClick={() => setFilter((current) => ({ ...current, ownership: option.id }))}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${filter.ownership === option.id ? 'bg-cream text-void' : 'text-cream/75'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Album */}
      <div ref={gridRef} className="mt-5">
        {status === 'error' && !data && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-mist">{t.cards.error}</p>
            <button type="button" onClick={retry} className="rounded-full bg-cream/10 px-4 py-2 text-xs font-semibold text-cream">
              {t.cards.retry}
            </button>
          </div>
        )}
        {data && cards.length === 0 && <p className="py-10 text-center text-sm text-mist">{t.cards.empty}</p>}
        {cardWidth > 0 && cards.length > 0 && (
          <ul className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP }}>
            {cards.slice(0, shown).map((card) => (
              <li key={card.id} style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${Math.round(cardWidth * 1.4)}px` }}>
                <button
                  type="button"
                  disabled={!card.owned}
                  onClick={() => setZoomed(card)}
                  className="relative block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-glow/70 disabled:cursor-default"
                >
                  <CollectibleCard
                    card={card}
                    width={cardWidth}
                    owned={card.owned}
                    interactive={card.owned && RARITY_STYLE[card.rarity].holo}
                    // Vignettes de téléphone : effets en boucle coupés (la vue en grand les garde).
                    effects={cardWidth >= 150}
                    badge={
                      card.owned && (card.count > 1 || card.isFavorite) ? (
                        <span className="flex items-center gap-1 rounded-full bg-void/75 px-1.5 py-0.5 text-[9px] font-semibold text-cream tabular-nums">
                          {card.isFavorite && <Heart size={9} className="fill-nope text-nope" />}
                          {card.count > 1 && `×${card.count}`}
                        </span>
                      ) : undefined
                    }
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Portail : la zone animée (`<main>`, transformée) piégerait un élément fixe. */}
      {zoomed && createPortal(<CardZoom card={zoomed} onClose={() => setZoomed(null)} />, document.body)}
    </div>
  )
}
