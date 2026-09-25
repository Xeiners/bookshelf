import { useEffect, useRef, useState } from 'react'
import { ArrowUpDown, Check } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { BROWSE_SORTS, effectiveSort, type BrowseSort } from '../../services/browse'

interface SortMenuProps {
  sort: BrowseSort
  /** Sans recherche, « Pertinence » n'a pas de sens : l'option est masquée. */
  hasQuery: boolean
  onChange: (sort: BrowseSort) => void
}

/** Menu de tri : bouton compact et liste déroulante. */
export function SortMenu({ sort, hasQuery, onChange }: SortMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = effectiveSort(sort, hasQuery)
  const options = BROWSE_SORTS.filter((option) => option !== 'relevance' || hasQuery)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  useGSAP(
    () => {
      if (!open) return
      gsap.fromTo('[data-sort-panel]', { opacity: 0, y: -6, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: EASE.swift })
      rootRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    },
    { dependencies: [open], scope: rootRef },
  )

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.search.sortBy(t.search.sorts[current])}
        className="glass flex h-10 items-center gap-2 rounded-full px-3.5 text-xs font-medium text-cream/85"
      >
        <ArrowUpDown size={14} className="text-mist" />
        {t.search.sorts[current]}
      </button>

      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-30" onPointerDown={() => setOpen(false)} />
          <div
            data-sort-panel
            role="menu"
            aria-label={t.search.sort}
            className="glass-strong absolute top-full left-0 z-40 mt-2 w-52 origin-top-left rounded-2xl p-1.5 shadow-lift"
          >
            {options.map((option) => (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={option === current}
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                  option === current ? 'bg-cream/10 font-semibold text-cream' : 'text-cream/70 hover:bg-cream/5 hover:text-cream'
                }`}
              >
                {t.search.sorts[option]}
                {option === current && <Check size={15} strokeWidth={2.6} className="text-glow" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
