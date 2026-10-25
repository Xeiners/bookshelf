import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { PIXEL_STEPS } from '../../lib/dle'
import { gsap, useGSAP } from '../../lib/gsap'

interface PixelFrameProps {
  /**
   * Image à deviner, PRÉPARÉE par le serveur au cran du joueur (quelques gros pixels), puis
   * nette après la victoire : l'image d'origine n'arrive jamais avant (anti-triche).
   */
  src: string
  /** Erreurs commises : chacune affine les pixels d'un cran. */
  errors: number
  /** Trouvé (ou manche finie) : l'image nette. */
  revealed: boolean
  /** Couleur de l'aura derrière le cadre. */
  glow: string
  /** Portrait : cadré sur le visage (haut de l'image). */
  portrait: boolean
}

/**
 * Mode Pixels : l'image réduite à quelques pixels (8 de large au départ), puis de
 * plus en plus fins à chaque erreur, jusqu'à l'image nette à la quinzième — ou à
 * la victoire. Le serveur envoie l'image déjà réduite (un PNG de quelques pixels) ;
 * elle est dessinée telle quelle dans un canevas, agrandi par le navigateur sans
 * lissage (`image-rendering: pixelated`) : des pixels nets, aucun flou. Le cran
 * précédent reste affiché tant que le suivant se charge.
 */
export function PixelFrame({ src, errors, revealed, glow, portrait }: PixelFrameProps) {
  const t = useT()
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const first = useRef(true)
  // Victoire : l'image nette ne remplace les pixels qu'une fois chargée (jamais de cadre vide).
  const sharp = revealed && image !== null && image.src.endsWith(src)

  // Chaque cran est une nouvelle image (même origine : le canevas peut la dessiner).
  useEffect(() => {
    const element = new Image()
    element.decoding = 'async'
    element.onload = () => setImage(element)
    element.src = src
    return () => {
      element.onload = null
    }
  }, [src])

  // Le cran reçu, dessiné à sa taille : le canevas l'agrandit sans lissage.
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !image || sharp) return
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    context.fillStyle = '#0b0b12'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0)
  }, [image, sharp])

  useGSAP(
    () => {
      if (!image) return
      const duration = first.current ? 0 : sharp ? 0.9 : 0.35
      first.current = false
      // Victoire : les pixels s'effacent sur l'image nette.
      gsap.to(canvasRef.current, { opacity: sharp ? 0 : 1, duration, ease: 'power2.out' })
      if (duration === 0) return
      if (sharp) gsap.fromTo(frameRef.current, { scale: 0.95 }, { scale: 1, duration: 0.9, ease: 'elastic.out(1, 0.5)' })
      else gsap.fromTo(frameRef.current, { scale: 0.97 }, { scale: 1, duration: 0.45, ease: 'back.out(2)' })
    },
    { dependencies: [image, sharp] },
  )

  const step = revealed ? PIXEL_STEPS.length : Math.min(errors, PIXEL_STEPS.length)
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative">
        {/* Aura : un dégradé derrière le cadre (jamais d'ombre portée, lente sur téléphone). */}
        <div aria-hidden className="absolute -inset-8 rounded-full" style={{ background: `radial-gradient(closest-side, ${glow}55, transparent)` }} />
        <div
          ref={frameRef}
          className="relative aspect-[3/4] w-[12.5rem] overflow-hidden rounded-3xl border-2 bg-ink sm:w-[16rem]"
          style={{ borderColor: `${glow}88`, boxShadow: '0 0 0 4px rgba(11,9,24,1), 0 30px 60px -30px rgba(0,0,0,0.95)' }}
        >
          {!image && <div aria-hidden className="absolute inset-0 animate-pulse bg-white/[0.04]" />}
          {/* L'image nette (après la victoire seulement), dessous : elle apparaît quand les pixels s'effacent. */}
          {sharp && (
            <img src={src} alt={t.dle.modes.pixel.title} draggable={false} className={`h-full w-full object-cover select-none ${portrait ? 'object-top' : ''}`} />
          )}
          <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full will-change-[opacity]" style={{ imageRendering: 'pixelated' }} />
        </div>
      </div>
      {/* Progression : quinze crans jusqu'à l'image nette. */}
      {!revealed && (
        <div aria-hidden className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
          <div className="h-full origin-left rounded-full bg-cream/70 transition-transform duration-500" style={{ transform: `scaleX(${step / PIXEL_STEPS.length})` }} />
        </div>
      )}
    </div>
  )
}
