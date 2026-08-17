import { useEffect, useMemo, useRef, useState } from 'react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { SHELF_HEIGHT, SPINE_GAP, buildUnits, packShelves, rowFreeSpace } from '../../lib/shelf'
import type { LibraryEntry } from '../../types/book'
import { BookSpine } from './BookSpine'
import { FlatStack } from './FlatStack'

/** Retrait des livres par rapport aux extrémités de la planche. */
const SHELF_INSET = 10

interface ShelfWallProps {
  entries: LibraryEntry[]
  onOpen: (entry: LibraryEntry) => void
}

/**
 * Mur d'étagères. La rangée est en `overflow-hidden` et la planche dessinée
 * juste en dessous : le masque coïncide donc avec sa surface, et les livres qui
 * entrent par le bas semblent émerger du rayon.
 */
export function ShelfWall({ entries, onOpen }: ShelfWallProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)

  // Le rangement dépend de la largeur réelle, jamais d'une valeur devinée.
  useEffect(() => {
    const node = rootRef.current
    if (!node) return

    const observer = new ResizeObserver((observed) => {
      const width = observed[0]?.contentRect.width ?? 0
      setAvailable(Math.max(0, width - SHELF_INSET * 2))
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const rows = useMemo(() => {
    if (available <= 0) return []
    return packShelves(buildUnits(entries), available)
  }, [entries, available])

  const signature = rows.map((row) => row.map((unit) => unit.id).join(',')).join('|')

  useGSAP(
    () => {
      if (rows.length === 0) return
      gsap.from('[data-spine]', {
        y: 34,
        autoAlpha: 0,
        duration: 0.62,
        stagger: { amount: Math.min(0.6, 0.05 * rows.length * 3), from: 'start' },
        ease: EASE.swift,
        overwrite: 'auto',
        clearProps: 'opacity,visibility,transform',
      })
    },
    { dependencies: [signature], revertOnUpdate: true, scope: rootRef },
  )

  return (
    <div ref={rootRef} className="space-y-6">
      {rows.map((row, rowIndex) => {
        const free = rowFreeSpace(row, available)
        // Serre-livres seulement sur un rayon incomplet, sinon il n'a rien à retenir.
        const showBookend = free >= 18 && rowIndex === rows.length - 1

        return (
          <div key={row.map((unit) => unit.id).join('|')} className="relative">
            <div
              className="relative flex items-end overflow-hidden px-2.5"
              style={{ height: SHELF_HEIGHT, gap: SPINE_GAP }}
            >
              {row.map((unit) =>
                unit.kind === 'spine' ? (
                  <BookSpine key={unit.id} entry={unit.entry} onOpen={onOpen} />
                ) : (
                  <FlatStack key={unit.id} entries={unit.entries} onOpen={onOpen} />
                ),
              )}

              {showBookend && (
                <span
                  aria-hidden
                  className="h-24 w-2.5 shrink-0 rounded-[2px] bg-linear-to-b from-cream/85 via-cream/55 to-cream/25 shadow-[0_8px_16px_-6px_rgb(0_0_0/0.8)]"
                />
              )}
            </div>

            <div className="relative">
              <div className="h-[9px] rounded-[3px] bg-linear-to-b from-cream/28 via-cream/14 to-cream/5" />
              <div className="absolute inset-x-0 top-0 h-px bg-cream/45" />
              <div className="absolute inset-x-3 top-full h-6 bg-linear-to-b from-black/55 to-transparent blur-[3px]" />
            </div>
          </div>
        )
      })}
    </div>
  )
}
