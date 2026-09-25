import { useEffect, useRef, useState } from 'react'
import { Check, Shuffle, SlidersHorizontal } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { DECK_ORIGINS, type DeckOrigin } from '../../services/discover'
import { Pressable } from '../ui/Pressable'

interface DeckFiltersProps {
  origin: DeckOrigin
  onOrigin: (origin: DeckOrigin) => void
  onReload: () => void
}

/**
 * Bouton « Filtres » du deck et son panneau : origine (Tous / Manga / Manhwa /
 * Manhua) et nouvelle sélection. Tient sur la ligne des étagères : sur mobile,
 * la carte garde toute la hauteur au lieu d'empiler deux rangées de puces.
 *
 * Un point sur le bouton signale un filtre actif. Le panneau se ferme sur un
 * tap dehors (un voile invisible l'absorbe : il n'ouvre pas la carte dessous),
 * sur Échap ou après un choix. Tant qu'il est ouvert, les flèches ne font pas swiper.
 */
export function DeckFilters({ origin, onOrigin, onReload }: DeckFiltersProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const filtered = origin !== 'all'

  /** Le focus revient au bouton (`Pressable` garde son propre ref pour l'animation). */
  const focusButton = () => rootRef.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus()

  const close = () => {
    setOpen(false)
    focusButton()
  }

  /*
   * Clavier pendant l'ouverture, en phase de CAPTURE sur window : passe avant
   * les raccourcis du deck. Échap ferme ; les flèches sont neutralisées pour
   * ne pas swiper une carte cachée sous le panneau.
   */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        focusButton()
      } else if (event.key.startsWith('Arrow')) {
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  // Ouverture : le panneau se déplie depuis le bouton ; le choix actif prend le focus.
  useGSAP(
    () => {
      if (!open) return
      // `opacity` et non `autoAlpha` : un élément en `visibility: hidden` ne peut pas prendre le focus.
      gsap.fromTo(
        '[data-filters-panel]',
        { opacity: 0, y: -6, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: EASE.swift },
      )
      rootRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    },
    { dependencies: [open], scope: rootRef },
  )

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Pressable
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={filtered ? t.deck.filtersActive(t.deck.origins[origin]) : t.deck.filters}
        title={t.deck.filters}
        className={`glass relative grid size-11 place-items-center rounded-full transition-colors ${
          open || filtered ? 'text-cream' : 'text-cream/70'
        }`}
      >
        <SlidersHorizontal size={17} />
        {filtered && (
          <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-glow ring-2 ring-void" />
        )}
      </Pressable>

      {open && (
        // Voile invisible : un tap dehors ferme le panneau sans toucher la carte dessous.
        <div aria-hidden className="fixed inset-0 z-30" onPointerDown={() => setOpen(false)} />
      )}

      {open && (
        <div
          data-filters-panel
          role="dialog"
          aria-label={t.deck.filters}
          className="glass-strong absolute top-full right-0 z-40 mt-2 w-56 origin-top-right rounded-2xl p-2 shadow-lift"
        >
          <p className="px-3 pt-1.5 pb-2 text-[10px] font-semibold tracking-[0.22em] text-mist uppercase">
            {t.deck.originLabel}
          </p>
          <div role="radiogroup" aria-label={t.deck.originLabel}>
            {DECK_ORIGINS.map((item) => {
              const active = item === origin
              return (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    onOrigin(item)
                    close()
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                    active ? 'bg-cream/10 font-semibold text-cream' : 'text-cream/70 hover:bg-cream/5 hover:text-cream'
                  }`}
                >
                  {t.deck.origins[item]}
                  {active && <Check size={15} strokeWidth={2.6} className="text-glow" />}
                </button>
              )
            })}
          </div>

          <div aria-hidden className="mx-3 my-2 h-px bg-cream/10" />

          <button
            type="button"
            onClick={() => {
              onReload()
              close()
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-cream/70 transition-colors hover:bg-cream/5 hover:text-cream"
          >
            <Shuffle size={15} />
            {t.deck.reload}
          </button>
        </div>
      )}
    </div>
  )
}
