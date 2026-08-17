import { useRef } from 'react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { hueFromString } from '../../lib/format'
import { FLAT_HEIGHT, flatWidth } from '../../lib/shelf'
import type { LibraryEntry } from '../../types/book'
import { STATUS_TOKEN } from '../../types/book'

interface FlatStackProps {
  entries: LibraryEntry[]
  onOpen: (entry: LibraryEntry) => void
}

/** Pile de livres couchés — casse la ligne des tranches, comme sur une vraie étagère. */
export function FlatStack({ entries, onOpen }: FlatStackProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { contextSafe } = useGSAP({ scope: ref })

  const nudge = contextSafe((element: EventTarget & HTMLElement, out: boolean) => {
    gsap.to(element, {
      x: out ? 5 : 0,
      duration: out ? 0.24 : 0.5,
      ease: out ? 'power2.out' : EASE.spring,
      overwrite: 'auto',
    })
  })

  return (
    <div ref={ref} data-spine className="flex shrink-0 flex-col-reverse justify-start">
      {entries.map((entry) => {
        const hue = hueFromString(entry.book.id)
        return (
          <button
            key={entry.book.id}
            type="button"
            title={entry.book.title}
            onClick={() => onOpen(entry)}
            onPointerDown={(event) => nudge(event.currentTarget, true)}
            onPointerUp={(event) => nudge(event.currentTarget, false)}
            onPointerLeave={(event) => nudge(event.currentTarget, false)}
            onPointerCancel={(event) => nudge(event.currentTarget, false)}
            className="relative overflow-hidden rounded-[3px] shadow-[0_5px_12px_-5px_rgb(0_0_0/0.9)] will-change-transform"
            style={{
              width: flatWidth(entry),
              height: FLAT_HEIGHT,
              background: `linear-gradient(180deg,
                hsl(${hue} 44% 21%) 0%,
                hsl(${hue} 38% 14%) 60%,
                hsl(${hue} 30% 9%) 100%)`,
            }}
          >
            {/* Tranche des pages, vue de dessus */}
            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-linear-to-t from-cream/35 to-transparent" />
            <span className="absolute inset-y-1 left-1.5 w-px bg-cream/20" />
            <span className="truncate px-2.5 pr-4 text-left text-[8px] leading-[15px] font-medium text-cream/80">
              {entry.book.title}
            </span>
            <span
              className="absolute top-1/2 right-1.5 size-1 -translate-y-1/2 rounded-full"
              style={{ backgroundColor: STATUS_TOKEN[entry.status] }}
            />
          </button>
        )
      })}
    </div>
  )
}
