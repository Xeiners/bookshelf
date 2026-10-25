import { useEffect, useRef, useState } from 'react'
import { ZoomIn } from 'lucide-react'
import { useT } from '../../i18n'
import { zoomScale } from '../../lib/dle'
import { gsap, useGSAP } from '../../lib/gsap'

interface ZoomFrameProps {
  /**
   * Couverture à deviner, PRÉPARÉE par le serveur au cran du joueur : seulement le détail
   * zoomé, puis l'image entière après la victoire. L'original n'arrive jamais avant (anti-triche).
   */
  src: string
  /** Erreurs déjà commises : chacune dézoome d'un cran. */
  errors: number
  /** Trouvé (ou manche finie) : la couverture entière. */
  revealed: boolean
}

/**
 * Mode couverture : un détail de la couverture, grossi autour d'un point choisi
 * par le serveur. Chaque erreur recule d'un cran : le nouveau détail, plus large,
 * arrive en se reculant doucement ; la victoire montre tout. Le cran précédent
 * reste affiché tant que le suivant se charge.
 */
export function ZoomFrame({ src, errors, revealed }: ZoomFrameProps) {
  const t = useT()
  const imageRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  /** Image affichée : la nouvelle ne remplace l'ancienne qu'une fois chargée (pas d'écran vide). */
  const [shown, setShown] = useState<string | null>(null)
  const scale = revealed ? 1 : zoomScale(errors)
  const first = useRef(true)

  useEffect(() => {
    const element = new Image()
    element.decoding = 'async'
    element.onload = () => setShown(src)
    element.src = src
    return () => {
      element.onload = null
    }
  }, [src])

  useGSAP(
    () => {
      if (!shown) return
      if (first.current) {
        first.current = false
        gsap.fromTo(imageRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 })
        return
      }
      // Le détail suivant arrive en se reculant : on sent le dézoom.
      gsap.fromTo(imageRef.current, { scale: revealed ? 1.25 : 1.18 }, { scale: 1, duration: revealed ? 1.2 : 0.8, ease: revealed ? 'power3.out' : 'expo.out' })
      // Une erreur secoue le cadre, la victoire le fait respirer.
      if (revealed) gsap.fromTo(frameRef.current, { scale: 0.96 }, { scale: 1, duration: 0.9, ease: 'elastic.out(1, 0.5)' })
      else gsap.fromTo(frameRef.current, { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.3)' })
    },
    { dependencies: [shown] },
  )

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={frameRef}
        className="relative aspect-[3/4] w-full max-w-[12.5rem] overflow-hidden rounded-3xl border-2 border-[#ffe39a]/40 bg-ink sm:max-w-[16rem]"
        style={{ boxShadow: '0 0 0 4px rgba(11,9,24,1), 0 0 34px -6px rgba(124,92,255,0.55), 0 30px 60px -30px rgba(0,0,0,0.95)' }}
      >
        {!shown && <div aria-hidden className="absolute inset-0 animate-pulse bg-white/[0.04]" />}
        {shown && (
          <img
            ref={imageRef}
            src={shown}
            alt={t.dle.game.zoomHint}
            draggable={false}
            decoding="async"
            className="h-full w-full object-cover will-change-transform select-none"
          />
        )}
        {/* Vignette : le regard va au centre du détail. */}
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 50%, transparent 55%, rgba(5,5,10,0.55))' }} />
      </div>
      {!revealed && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-semibold text-cream/80 tabular-nums">
          <ZoomIn size={12} aria-hidden />
          {t.dle.game.zoom(scale.toLocaleString(undefined, { maximumFractionDigits: 2 }))}
        </span>
      )}
    </div>
  )
}
