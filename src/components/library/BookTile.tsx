import { useRef } from 'react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { formatAuthors } from '../../lib/format'
import type { LibraryEntry } from '../../types/book'
import { STATUS_TOKEN } from '../../types/book'
import { BookCover } from '../ui/BookCover'

interface BookTileProps {
  entry: LibraryEntry
  onOpen: (entry: LibraryEntry) => void
}

/** Tuile de la grille « Mes livres ». */
export function BookTile({ entry, onOpen }: BookTileProps) {
  const rootRef = useRef<HTMLButtonElement>(null)
  const { book, status, progress } = entry

  useGSAP(
    () => {
      if (status !== 'reading') return
      gsap.to('[data-bar]', {
        scaleX: Math.max(progress, 0.02),
        duration: 0.9,
        ease: EASE.swift,
      })
    },
    { dependencies: [progress, status], scope: rootRef },
  )

  const { contextSafe } = useGSAP({ scope: rootRef })

  const scaleTo = contextSafe((value: number) => {
    gsap.to(rootRef.current, {
      scale: value,
      duration: value === 1 ? 0.5 : 0.18,
      ease: value === 1 ? EASE.spring : 'power2.out',
      overwrite: 'auto',
    })
  })

  return (
    <button
      ref={rootRef}
      data-tile
      type="button"
      onClick={() => onOpen(entry)}
      onPointerDown={() => scaleTo(0.95)}
      onPointerUp={() => scaleTo(1)}
      onPointerLeave={() => scaleTo(1)}
      onPointerCancel={() => scaleTo(1)}
      className="group text-left will-change-transform"
    >
      <div className="relative aspect-2/3 overflow-hidden rounded-2xl bg-carbon shadow-lift">
        <BookCover book={book} className="h-full w-full" />
        <div className="absolute inset-0 bg-linear-to-t from-void/70 via-transparent to-transparent" />
        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/10 ring-inset" />

        <span
          className="absolute top-2.5 right-2.5 size-2.5 rounded-full ring-2 ring-void/60"
          style={{ backgroundColor: STATUS_TOKEN[status] }}
        />

        {status === 'reading' && (
          <div className="absolute inset-x-2.5 bottom-2.5 h-1 overflow-hidden rounded-full bg-cream/20">
            <div data-bar className="h-full origin-left scale-x-0 rounded-full bg-gold" />
          </div>
        )}
      </div>

      <p className="mt-2.5 line-clamp-2 text-[13px] leading-snug font-medium text-cream">
        {book.title}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-mist">{formatAuthors(book.authors)}</p>
    </button>
  )
}
