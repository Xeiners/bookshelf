import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Star, X } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { BROWSE_STATUSES, MAX_GENRES, MIN_SCORES, type GenreFacet } from '../../services/browse'
import { DECK_ORIGINS } from '../../services/discover'
import { useSearchStore } from '../../store/useSearchStore'

interface SearchFiltersProps {
  genres: GenreFacet[]
  /** Nombre de titres pour les filtres courants (les résultats se mettent à jour en direct). */
  total: number | null
  onClose: () => void
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section data-filter-item className="py-4">
      <h3 className="text-[10px] font-semibold tracking-[0.22em] text-mist uppercase">{title}</h3>
      {hint && <p className="mt-1 text-[11px] text-mist/70">{hint}</p>}
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </section>
  )
}

function Choice({
  active,
  onClick,
  children,
  role = 'radio',
  disabled = false,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  role?: 'radio' | 'checkbox'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={active}
      disabled={disabled}
      onClick={() => {
        vibrate(6)
        onClick()
      }}
      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors disabled:opacity-35 ${
        active ? 'border-cream bg-cream text-void' : 'border-cream/12 bg-cream/[0.04] text-cream/75 hover:border-cream/30 hover:text-cream'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Panneau des filtres : feuille du bas sur mobile, tiroir latéral sur grand
 * écran. Rendu dans `document.body` (portail) : la page vit dans un contexte
 * d'empilement plus bas que la barre d'onglets, qui passerait sinon par-dessus. Chaque choix s'applique tout de suite (la grille se met à jour
 * derrière) ; le bouton du bas annonce le nombre de titres et referme.
 */
export function SearchFilters({ genres, total, onClose }: SearchFiltersProps) {
  const t = useT()
  const filters = useSearchStore((state) => state.filters)
  const update = useSearchStore((state) => state.update)
  const toggleGenre = useSearchStore((state) => state.toggleGenre)
  const resetFilters = useSearchStore((state) => state.resetFilters)

  const rootRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)

  const { contextSafe } = useGSAP(
    () => {
      const wide = window.matchMedia('(min-width: 768px)').matches
      gsap
        .timeline({ defaults: { ease: EASE.glide } })
        .fromTo('[data-filter-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 0)
        .fromTo('[data-filter-panel]', wide ? { xPercent: 105 } : { yPercent: 100 }, { xPercent: 0, yPercent: 0, duration: 0.55 }, 0)
        .from('[data-filter-item]', { y: 14, autoAlpha: 0, duration: 0.4, stagger: 0.04, ease: EASE.swift }, 0.15)
      rootRef.current?.querySelector<HTMLElement>('[data-filter-panel]')?.focus()
    },
    { scope: rootRef },
  )

  const close = () =>
    contextSafe(() => {
      if (closingRef.current) return
      closingRef.current = true
      const wide = window.matchMedia('(min-width: 768px)').matches
      gsap
        .timeline({ onComplete: onClose })
        .to('[data-filter-panel]', { ...(wide ? { xPercent: 105 } : { yPercent: 100 }), duration: 0.32, ease: 'power2.in' }, 0)
        .to('[data-filter-backdrop]', { autoAlpha: 0, duration: 0.28 }, 0)
    })()

  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const genreLimit = filters.genres.length >= MAX_GENRES

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[85]" role="dialog" aria-modal aria-label={t.search.filters}>
      <div data-filter-backdrop className="absolute inset-0 bg-void/80 opacity-0" onClick={close} />

      <div
        data-filter-panel
        tabIndex={-1}
        className="glass-strong absolute inset-x-0 bottom-0 flex max-h-[86svh] flex-col rounded-t-[2rem] pb-safe outline-none md:inset-y-4 md:right-4 md:left-auto md:max-h-none md:w-[26rem] md:rounded-[2rem] md:pb-0"
      >
        <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-2">
          <h2 className="font-display text-2xl text-cream">{t.search.filters}</h2>
          <button
            type="button"
            onClick={close}
            aria-label={t.common.close}
            className="glass grid size-9 place-items-center rounded-full text-cream/60"
          >
            <X size={16} />
          </button>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 divide-y divide-cream/[0.06] overflow-y-auto overscroll-contain px-6">
          <Section title={t.search.origin}>
            {DECK_ORIGINS.map((origin) => (
              <Choice key={origin} active={filters.origin === origin} onClick={() => update({ origin })}>
                {t.deck.origins[origin]}
              </Choice>
            ))}
          </Section>

          <Section title={t.search.status}>
            {BROWSE_STATUSES.map((status) => (
              <Choice key={status} active={filters.status === status} onClick={() => update({ status })}>
                {t.search.statuses[status]}
              </Choice>
            ))}
          </Section>

          <Section title={t.search.minScore}>
            {MIN_SCORES.map((score) => (
              <Choice key={score} active={filters.minScore === score} onClick={() => update({ minScore: score })}>
                {score === 0 ? (
                  t.search.anyScore
                ) : (
                  <>
                    <Star size={12} className="fill-gold text-gold" />
                    {t.search.scoreAtLeast(score / 20)}
                  </>
                )}
              </Choice>
            ))}
          </Section>

          <Section title={t.search.genres} hint={t.search.genresHint}>
            {genres.map((genre) => {
              const active = filters.genres.includes(genre.id)
              return (
                <Choice
                  key={genre.id}
                  role="checkbox"
                  active={active}
                  disabled={!active && genreLimit}
                  onClick={() => toggleGenre(genre.id)}
                >
                  {active && <Check size={12} strokeWidth={3} />}
                  {genre.label}
                  <span className={`tabular-nums ${active ? 'text-void/50' : 'text-mist/70'}`}>{genre.count}</span>
                </Choice>
              )
            })}
          </Section>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-cream/[0.06] px-6 py-4">
          <button
            type="button"
            onClick={() => {
              vibrate(8)
              resetFilters()
            }}
            className="text-xs font-medium text-mist transition-colors hover:text-cream"
          >
            {t.search.resetFilters}
          </button>
          <button
            type="button"
            onClick={close}
            className="ml-auto rounded-full bg-cream px-5 py-3 text-xs font-semibold text-void tabular-nums"
          >
            {total === null ? t.search.filters : t.search.showResults(total)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
