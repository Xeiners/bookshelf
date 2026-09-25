import { useRef } from 'react'
import { Heart } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'

interface FavoriteButtonProps {
  active: boolean
  onToggle: () => void
  className?: string
  size?: number
}

/**
 * Cœur « coup de cœur ». En l'allumant : le cœur bondit et une onde rose
 * s'en échappe ; en l'éteignant, un simple rebond.
 */
export function FavoriteButton({ active, onToggle, className = '', size = 16 }: FavoriteButtonProps) {
  const t = useT()
  const rootRef = useRef<HTMLButtonElement>(null)
  const { contextSafe } = useGSAP({ scope: rootRef })

  const toggle = () =>
    contextSafe(() => {
      const turningOn = !active
      vibrate(turningOn ? [8, 24, 12] : 6)
      onToggle()
      gsap.fromTo('[data-heart]', { scale: turningOn ? 0.55 : 0.85 }, { scale: 1, duration: 0.6, ease: EASE.spring })
      if (turningOn) {
        gsap.fromTo('[data-ripple]', { scale: 0.4, autoAlpha: 0.7 }, { scale: 1.9, autoAlpha: 0, duration: 0.6, ease: 'power2.out' })
      }
    })()

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={toggle}
      aria-pressed={active}
      aria-label={active ? t.book.unfavorite : t.book.favorite}
      title={active ? t.book.unfavorite : t.book.favorite}
      className={`relative grid place-items-center rounded-full transition-colors ${active ? 'text-nope' : 'text-cream/60'} ${className}`}
    >
      <span data-ripple aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-2 border-nope opacity-0" />
      <Heart data-heart size={size} strokeWidth={2.2} className={active ? 'fill-nope' : undefined} />
    </button>
  )
}
