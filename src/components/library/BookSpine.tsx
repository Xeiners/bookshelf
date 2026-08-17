import { useRef } from 'react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { spineMetrics } from '../../lib/shelf'
import type { LibraryEntry } from '../../types/book'
import { STATUS_TOKEN } from '../../types/book'

interface BookSpineProps {
  entry: LibraryEntry
  onOpen: (entry: LibraryEntry) => void
}

/** Toile du dos : sombre et saturée, teinte stable par livre. */
function spineCloth(hue: number): string {
  return `linear-gradient(100deg,
    hsl(${hue} 34% 9%) 0%,
    hsl(${hue} 46% 20%) 34%,
    hsl(${hue} 40% 16%) 72%,
    hsl(${hue} 30% 10%) 100%)`
}

/** Un livre vu de dos : épaisseur selon la pagination, hauteur déterministe. */
export function BookSpine({ entry, onOpen }: BookSpineProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const { book, status } = entry
  const { width, height, hue } = spineMetrics(entry)

  const { contextSafe } = useGSAP({ scope: ref })

  const lift = contextSafe((out: boolean) => {
    gsap.to(ref.current, {
      y: out ? -12 : 0,
      rotate: out ? -3.5 : 0,
      duration: out ? 0.26 : 0.55,
      ease: out ? 'power2.out' : EASE.spring,
      overwrite: 'auto',
    })
  })

  return (
    <button
      ref={ref}
      data-spine
      type="button"
      title={book.title}
      onClick={() => onOpen(entry)}
      onPointerDown={() => lift(true)}
      onPointerUp={() => lift(false)}
      onPointerLeave={() => lift(false)}
      onPointerCancel={() => lift(false)}
      className="relative shrink-0 origin-bottom overflow-hidden rounded-t-[4px] rounded-b-[2px] shadow-[0_8px_18px_-6px_rgb(0_0_0/0.85)] will-change-transform"
      style={{ width, height, background: spineCloth(hue) }}
    >
      <span className="absolute inset-y-px right-0 w-[3px] bg-linear-to-l from-cream/40 to-cream/5" />
      <span className="absolute inset-0 bg-linear-to-r from-black/55 via-transparent to-black/30" />
      <span className="absolute inset-x-1.5 top-2.5 h-px bg-cream/25" />
      <span className="absolute inset-x-1.5 bottom-5 h-px bg-cream/20" />

      <span className="absolute inset-0 flex items-center justify-center px-1 pb-6">
        <span className="max-h-full truncate text-[9.5px] leading-none font-medium text-cream/85 [writing-mode:vertical-rl] rotate-180">
          {book.title}
        </span>
      </span>

      <span
        className="absolute bottom-2 left-1/2 size-1.5 -translate-x-1/2 rounded-full"
        style={{ backgroundColor: STATUS_TOKEN[status] }}
      />
    </button>
  )
}
