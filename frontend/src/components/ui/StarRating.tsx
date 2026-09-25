import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Star } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'

interface StarRatingProps {
  /** 0,5 → 5, ou `null` si pas encore noté. */
  value: number | null
  onChange: (value: number | null) => void
  size?: number
}

const STARS = [1, 2, 3, 4, 5] as const

/** Demi-étoile sous le doigt : moitié gauche d'une étoile = x,5. */
function valueAt(event: PointerEvent<HTMLDivElement>, row: HTMLDivElement): number {
  const box = row.getBoundingClientRect()
  const ratio = Math.min(0.999, Math.max(0, (event.clientX - box.left) / box.width))
  return Math.max(0.5, Math.ceil(ratio * 10) / 2)
}

/**
 * Note personnelle en demi-étoiles.
 *
 * - Tap ou clic : la moitié gauche d'une étoile vaut une demi-étoile.
 * - Glisser le doigt le long des étoiles : aperçu en direct, validé au relâché.
 * - Clavier (rôle `slider`) : flèches ±0,5, Début / Fin, Suppr pour effacer.
 * À chaque nouvelle note, les étoiles allumées « sautent » l'une après l'autre.
 */
export function StarRating({ value, onChange, size = 28 }: StarRatingProps) {
  const t = useT()
  const rowRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const dragging = useRef(false)
  const shown = preview ?? value ?? 0

  const { contextSafe } = useGSAP({ scope: rowRef })

  const commit = (next: number | null) =>
    contextSafe(() => {
      if (next === value) return
      vibrate(next === null ? 6 : [6, 20, 8])
      onChange(next)
      if (next !== null) {
        gsap.fromTo(
          gsap.utils.toArray<HTMLElement>('[data-star]').slice(0, Math.ceil(next)),
          { scale: 0.7 },
          { scale: 1, duration: 0.5, stagger: 0.05, ease: EASE.snap, overwrite: 'auto' },
        )
      }
    })()

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const row = rowRef.current
    if (!row) return
    dragging.current = true
    row.setPointerCapture(event.pointerId)
    setPreview(valueAt(event, row))
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const row = rowRef.current
    // Souris sans bouton : simple survol, aperçu seulement.
    if (row && (dragging.current || event.pointerType === 'mouse')) setPreview(valueAt(event, row))
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const row = rowRef.current
    if (!row || !dragging.current) return
    dragging.current = false
    setPreview(null)
    commit(valueAt(event, row))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = value ?? 0
    const keys: Record<string, number | null> = {
      ArrowRight: Math.min(5, current + 0.5),
      ArrowUp: Math.min(5, current + 0.5),
      ArrowLeft: Math.max(0.5, current - 0.5),
      ArrowDown: Math.max(0.5, current - 0.5),
      Home: 0.5,
      End: 5,
      Delete: null,
      Backspace: null,
    }
    if (!(event.key in keys)) return
    event.preventDefault()
    // Les flèches ne doivent pas atteindre d'autres raccourcis (deck, fermeture).
    event.stopPropagation()
    commit(keys[event.key] ?? null)
  }

  return (
    <div
      ref={rowRef}
      role="slider"
      tabIndex={0}
      aria-label={t.book.rateLabel}
      aria-valuemin={0.5}
      aria-valuemax={5}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null ? undefined : t.book.starsLabel(value)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => !dragging.current && setPreview(null)}
      onPointerCancel={() => {
        dragging.current = false
        setPreview(null)
      }}
      onKeyDown={onKeyDown}
      className="flex w-fit cursor-pointer touch-none gap-1 rounded-lg outline-offset-4 select-none"
    >
      {STARS.map((star) => {
        // Remplissage de cette étoile : 0, ½ ou plein.
        const fill = Math.min(1, Math.max(0, shown - (star - 1)))
        return (
          <span key={star} data-star className="relative block" style={{ width: size, height: size }}>
            <Star size={size} strokeWidth={1.6} className="absolute inset-0 text-cream/25" />
            <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star size={size} strokeWidth={1.6} className="fill-gold text-gold" />
            </span>
          </span>
        )
      })}
    </div>
  )
}
