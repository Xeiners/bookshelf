import { useRef } from 'react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { useT } from '../../i18n'
import type { Shelf } from '../../services/catalog'

interface ShelfPickerProps {
  /** Étagères du catalogue, ou celles des romans. */
  shelves: Shelf[]
  active: Shelf
  onSelect: (shelf: Shelf) => void
}

/**
 * Rail d'étagères thématiques. Débord à gauche uniquement (`-ml-5 pl-5`) : les
 * puces filent jusqu'au bord, les boutons d'action restent épinglés à droite.
 */
export function ShelfPicker({ shelves, active, onSelect }: ShelfPickerProps) {
  const t = useT()
  const rowRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      gsap.from('[data-chip]', {
        y: 16,
        autoAlpha: 0,
        duration: 0.5,
        stagger: 0.035,
        ease: EASE.swift,
      })
    },
    { scope: rowRef },
  )

  // Recentre la puce active quand elle change (utile après un tap au bord).
  // Défilement du rail seul (`scrollIntoView` remontait aussi les parents) et
  // instantané au montage : pas de scroll animé par-dessus l'entrée de la vue.
  const centered = useRef(false)
  useGSAP(
    () => {
      const row = rowRef.current
      const chip = row?.querySelector<HTMLElement>('[data-active="true"]')
      if (!row || !chip) return
      const rowBox = row.getBoundingClientRect()
      const chipBox = chip.getBoundingClientRect()
      row.scrollTo({
        left: row.scrollLeft + chipBox.left - rowBox.left - (row.clientWidth - chipBox.width) / 2,
        behavior: centered.current ? 'smooth' : 'instant',
      })
      centered.current = true
    },
    { dependencies: [active.id] },
  )

  return (
    <div
      ref={rowRef}
      className="no-scrollbar -ml-5 flex min-w-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain py-1 pl-5"
      role="tablist"
      aria-label={t.shelves.pickerLabel}
    >
      {shelves.map((shelf) => {
        const isActive = shelf.id === active.id
        return (
          <button
            key={shelf.id}
            data-chip
            data-active={isActive}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(shelf)}
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors duration-300 ${
              isActive ? 'bg-cream text-void' : 'glass text-cream/65'
            }`}
          >
            {t.shelves.names[shelf.id]}
          </button>
        )
      })}
    </div>
  )
}
