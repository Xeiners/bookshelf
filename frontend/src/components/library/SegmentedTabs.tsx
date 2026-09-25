import { useRef } from 'react'
import { Heart } from 'lucide-react'
import { useT } from '../../i18n'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import type { LibraryTab } from '../../types/book'
import { LIBRARY_TABS } from '../../types/book'

const COLOR_ACTIVE = '#06060a'
const COLOR_IDLE = '#9d9aab'

interface SegmentedTabsProps {
  value: LibraryTab
  counts: Record<LibraryTab, number>
  onChange: (tab: LibraryTab) => void
}

/**
 * Sélecteur d'onglet — capsule glissante animée par GSAP. Trois statuts, plus
 * les favoris : un cœur seul (son nom est porté par `aria-label`) pour que
 * quatre onglets tiennent sur un téléphone.
 */
export function SegmentedTabs({ value, counts, onChange }: SegmentedTabsProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      // Comme la barre de navigation : `xPercent`, et pas d'easing qui dépasse.
      const index = LIBRARY_TABS.indexOf(value)
      gsap.to('[data-thumb]', {
        xPercent: index * 100,
        duration: 0.4,
        ease: 'power3.out',
        overwrite: 'auto',
      })

      LIBRARY_TABS.forEach((tab) => {
        gsap.to(`[data-tint="${tab}"]`, {
          color: tab === value ? COLOR_ACTIVE : COLOR_IDLE,
          duration: 0.3,
          overwrite: 'auto',
        })
      })
    },
    { dependencies: [value], scope: rootRef },
  )

  return (
    <div
      ref={rootRef}
      role="tablist"
      aria-label={t.status.filterLabel}
      className="glass relative flex min-w-0 flex-1 items-stretch overflow-hidden rounded-full p-1"
    >
      <span
        data-thumb
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-full bg-cream will-change-transform"
      />

      {LIBRARY_TABS.map((tab) => (
        <button
          key={tab}
          data-cell
          type="button"
          role="tab"
          aria-selected={tab === value}
          aria-label={tab === 'favorites' ? `${t.library.favorites} (${counts[tab]})` : undefined}
          onClick={() => {
            if (tab === value) return
            vibrate(6)
            onChange(tab)
          }}
          className="relative z-10 flex min-w-0 flex-1 items-center justify-center gap-1 py-2.5"
        >
          {tab === 'favorites' ? (
            <Heart data-tint={tab} size={14} strokeWidth={2.4} className="shrink-0 text-mist" />
          ) : (
            <span data-tint={tab} className="truncate text-xs font-medium text-mist">
              {t.status[tab]}
            </span>
          )}
          {/* Sous 360 px, les compteurs laissent la place aux libellés. */}
          <span data-tint={tab} className="hidden text-[10px] text-mist tabular-nums opacity-60 min-[360px]:inline">
            {counts[tab]}
          </span>
        </button>
      ))}
    </div>
  )
}
