import { useCallback, useEffect, useRef, useState } from 'react'
import { gsap, useGSAP } from '../../lib/gsap'
import { useT } from '../../i18n'
import { initials, proceduralGradient } from '../../lib/format'
import type { Book } from '../../types/book'

interface BookCoverProps {
  book: Book
  eager?: boolean
  className?: string
}

/**
 * Variante plus légère d'une couverture, ou `null` s'il n'y en a pas :
 * - API MangaDex : `?size=512` → `?size=256` ;
 * - anciennes entrées Open Library : `-L.jpg` → `-M.jpg`.
 */
function smallerCover(src: string | null): string | null {
  if (!src) return null
  if (src.includes('size=512')) return src.replace('size=512', 'size=256')
  if (src.includes('-L.jpg')) return src.replace('-L.jpg', '-M.jpg')
  return null
}

/**
 * Même URL, mais distincte pour le cache HTTP et le service worker : une
 * erreur passagère (réseau mobile, proxy MangaDex lent) ne doit pas condamner
 * la couverture dès le premier échec.
 */
function retryUrl(src: string): string {
  return `${src}${src.includes('?') ? '&' : '?'}retry=1`
}

/** Tentatives successives : originale, originale retentée, plus légère, puis procédurale. */
function coverAttempts(cover: string | null): string[] {
  if (!cover) return []
  const smaller = smallerCover(cover)
  return smaller ? [cover, retryUrl(cover), smaller] : [cover, retryUrl(cover)]
}

/** Délai sans réponse avant de passer à la tentative suivante, une fois l'image à l'écran. */
const STALL_TIMEOUT_MS = 12_000

/**
 * Couverture tolérante aux pannes : on retente, puis on descend en résolution
 * moyenne, puis on génère une couverture typographique.
 *
 * La clé remonte le composant quand le livre change : sans elle, une fiche
 * réutilisée pour un autre livre gardait l'image (ou l'échec) du précédent.
 */
export function BookCover(props: BookCoverProps) {
  return <CoverImage key={`${props.book.id}:${props.book.cover ?? ''}`} {...props} />
}

function CoverImage({ book, eager = false, className = '' }: BookCoverProps) {
  const t = useT()
  const [attempts] = useState(() => coverAttempts(book.cover))
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  // Une image `lazy` ne se charge qu'à l'approche de l'écran : le chronomètre
  // ne doit démarrer qu'à ce moment-là, sinon les couvertures plus bas dans une
  // liste basculaient en procédural avant même d'avoir été demandées.
  const [inView, setInView] = useState(() => eager || typeof IntersectionObserver === 'undefined')
  const rootRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const src = attempts[attempt] ?? null

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

  const handleError = useCallback(() => setAttempt((current) => current + 1), [])

  useEffect(() => {
    if (inView || !rootRef.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(rootRef.current)
    return () => observer.disconnect()
  }, [inView])

  // Une requête d'image peut rester pendante sans émettre d'erreur. On préfère
  // alors la tentative suivante à un squelette figé.
  useEffect(() => {
    if (!src || loaded || !inView) return
    const timeout = window.setTimeout(handleError, STALL_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [src, loaded, inView, handleError])

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
              {book.authors[0] ?? t.book.unknownAuthor}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className={`relative overflow-hidden bg-carbon ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 overflow-hidden bg-carbon">
          <div className="animate-shimmer absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
        </div>
      )}

      <div ref={layerRef} className="absolute inset-0 opacity-0">
        <img
          src={src}
          alt={t.book.coverAlt(book.title)}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          draggable={false}
          onLoad={(event) => {
            // Protection contre les anciennes réponses « image manquante » 1×1.
            if (event.currentTarget.naturalWidth <= 2) handleError()
            else setLoaded(true)
          }}
          onError={handleError}
          className="relative h-full w-full object-cover"
        />
      </div>
    </div>
  )
}
