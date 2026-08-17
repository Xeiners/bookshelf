import { useRef } from 'react'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import type { ReadingStatus } from '../../types/book'
import { STATUS_LABEL, STATUS_ORDER } from '../../types/book'

const COLOR_ACTIVE = '#06060a'
const COLOR_IDLE = '#9d9aab'

interface SegmentedTabsProps {
  value: ReadingStatus
  counts: Record<ReadingStatus, number>
  onChange: (status: ReadingStatus) => void
}

/** Sélecteur de statut — capsule glissante animée par GSAP. */
export function SegmentedTabs({ value, counts, onChange }: SegmentedTabsProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      // Comme la barre de navigation : `xPercent`, et pas d'easing qui dépasse.
      const index = STATUS_ORDER.indexOf(value)
      gsap.to('[data-thumb]', {
        xPercent: index * 100,
        duration: 0.4,
        ease: 'power3.out',
        overwrite: 'auto',
      })

      STATUS_ORDER.forEach((status) => {
        gsap.to(`[data-tint="${status}"]`, {
          color: status === value ? COLOR_ACTIVE : COLOR_IDLE,
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
      aria-label="Filtrer par statut"
      className="glass relative flex min-w-0 flex-1 items-stretch overflow-hidden rounded-full p-1"
    >
      <span
        data-thumb
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-cream will-change-transform"
      />

      {STATUS_ORDER.map((status) => (
        <button
          key={status}
          data-cell
          type="button"
          role="tab"
          aria-selected={status === value}
          onClick={() => {
            if (status === value) return
            vibrate(6)
            onChange(status)
          }}
          className="relative z-10 flex flex-1 items-center justify-center gap-1.5 py-2.5"
        >
          <span data-tint={status} className="text-xs font-medium text-mist">
            {STATUS_LABEL[status]}
          </span>
          <span data-tint={status} className="text-[10px] text-mist tabular-nums opacity-60">
            {counts[status]}
          </span>
        </button>
      ))}
    </div>
  )
}
