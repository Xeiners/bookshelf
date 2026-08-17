import { useRef, useState } from 'react'
import { gsap, useGSAP } from '../../lib/gsap'
import { initials, proceduralGradient } from '../../lib/format'
import type { Book } from '../../types/book'

interface BookCoverProps {
  book: Book
  /** Calque flouté derrière l'image : rattrape les ratios de couverture atypiques. */
  bleed?: boolean
  eager?: boolean
  className?: string
}

/**
 * Couverture tolérante aux pannes : Open Library renvoie parfois un 502 sur
 * `-L.jpg`, on retente en `-M.jpg` puis on génère une couverture typographique.
 */
export function BookCover({ book, bleed = false, eager = false, className = '' }: BookCoverProps) {
  const [src, setSrc] = useState(book.cover)
  const [loaded, setLoaded] = useState(false)
  const layerRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (!loaded) return
      gsap.fromTo(
        layerRef.current,
        { autoAlpha: 0, scale: 1.06 },
        { autoAlpha: 1, scale: 1, duration: 0.85, ease: 'power2.out' },
      )
    },
    { dependencies: [loaded] },
  )

  const handleError = () => {
    // Dégradation en cascade : -L → -M → couverture procédurale.
    if (src?.endsWith('-L.jpg')) setSrc(src.replace('-L.jpg', '-M.jpg'))
    else setSrc(null)
  }

  if (!src) {
    return (
      <div
        className={`relative overflow-hidden ${className}`}
        style={{ backgroundImage: proceduralGradient(`${book.id}${book.title}`) }}
      >
        <div className="grain absolute inset-0 opacity-[0.14] mix-blend-overlay" />
        <div className="relative flex h-full flex-col justify-between p-6">
          <span className="font-display text-7xl leading-none text-cream/20">
            {initials(book.title)}
          </span>
          <div>
            <p className="font-display text-[clamp(1.75rem,7vw,2.5rem)] leading-[1.02] text-cream">
              {book.title}
            </p>
            <p className="mt-2 text-[11px] tracking-[0.22em] text-cream/50 uppercase">
              {book.authors[0] ?? 'Auteur inconnu'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden bg-carbon ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 overflow-hidden bg-carbon">
          <div className="animate-shimmer absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
        </div>
      )}

      <div ref={layerRef} className="absolute inset-0 opacity-0">
        {bleed && (
          <img
            src={src}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl saturate-150"
          />
        )}
        <img
          src={src}
          alt={`Couverture de ${book.title}`}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={handleError}
          className="relative h-full w-full object-cover"
        />
      </div>
    </div>
  )
}
