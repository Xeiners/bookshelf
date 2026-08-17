import { useRef } from 'react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import type { Shelf } from '../../services/openLibrary'
import { SHELVES } from '../../services/openLibrary'

interface ShelfPickerProps {
  active: Shelf
  onSelect: (shelf: Shelf) => void
}

/**
 * Rail d'étagères thématiques. Débord à gauche uniquement (`-ml-5 pl-5`) : les
 * puces filent jusqu'au bord, les boutons d'action restent épinglés à droite.
 */
export function ShelfPicker({ active, onSelect }: ShelfPickerProps) {
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
  useGSAP(
    () => {
      rowRef.current
        ?.querySelector<HTMLElement>('[data-active="true"]')
        ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    },
    { dependencies: [active.id] },
  )

  return (
    <div
      ref={rowRef}
      className="no-scrollbar -ml-5 flex min-w-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain py-1 pl-5"
      role="tablist"
      aria-label="Étagères thématiques"
    >
      {SHELVES.map((shelf) => {
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
            {shelf.label}
          </button>
        )
      })}
    </div>
  )
}
