import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { PIXEL_STEPS, pixelColumns } from '../../lib/dle'
import { gsap, useGSAP } from '../../lib/gsap'

interface PixelFrameProps {
  /** Image à deviner (portrait, couverture), servie par une adresse qui ne la nomme pas. */
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

/** Format du cadre (largeur / hauteur), le même que les couvertures. */
const RATIO = 3 / 4

/**
 * Mode Pixels : l'image réduite à quelques pixels (8 de large au départ), puis de
 * plus en plus fins à chaque erreur, jusqu'à l'image nette à la quinzième — ou à
 * la victoire. L'image est dessinée dans un tout petit canevas, agrandi par le
 * navigateur sans lissage (`image-rendering: pixelated`) : des pixels nets, aucun
 * flou, et un seul petit dessin par erreur (léger sur téléphone).
 */
export function PixelFrame({ src, errors, revealed, glow, portrait }: PixelFrameProps) {
  const t = useT()
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const columns = revealed ? null : pixelColumns(errors)
  const first = useRef(true)

  // L'image, chargée une fois (même origine : le canevas peut la dessiner).
  useEffect(() => {
    const element = new Image()
    element.decoding = 'async'
    element.onload = () => setImage(element)
    element.src = src
    return () => {
      element.onload = null
    }
  }, [src])

  // Un cran : l'image redessinée à la nouvelle taille de pixel, cadrée comme une couverture.
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !image || columns === null) return
    const rows = Math.round(columns / RATIO)
    canvas.width = columns
    canvas.height = rows
    // Lissage À LA RÉDUCTION : chaque pixel prend la couleur moyenne de sa zone.
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    const { naturalWidth: width, naturalHeight: height } = image
    const wide = width / height > RATIO
    const sw = wide ? height * RATIO : width
    const sh = wide ? height : width / RATIO
    const sx = (width - sw) / 2
    const sy = wide || portrait ? 0 : (height - sh) / 2
    // Fond opaque d'abord : un portrait détouré (PNG transparent) ne laisse jamais voir l'image nette dessous.
    context.fillStyle = '#0b0b12'
    context.fillRect(0, 0, columns, rows)
    context.drawImage(image, sx, sy, sw, sh, 0, 0, columns, rows)
  }, [image, columns, portrait])

  useGSAP(
    () => {
      if (!image) return
      const duration = first.current ? 0 : revealed ? 0.9 : 0.35
      first.current = false
      // Victoire (ou dernier cran) : les pixels s'effacent sur l'image nette.
      gsap.to(canvasRef.current, { opacity: columns === null ? 0 : 1, duration, ease: 'power2.out' })
      if (duration === 0) return
      if (revealed) gsap.fromTo(frameRef.current, { scale: 0.95 }, { scale: 1, duration: 0.9, ease: 'elastic.out(1, 0.5)' })
      else gsap.fromTo(frameRef.current, { scale: 0.97 }, { scale: 1, duration: 0.45, ease: 'back.out(2)' })
    },
    { dependencies: [image, columns, revealed] },
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
          {/* L'image nette, dessous : invisible tant que les pixels sont là, elle apparaît quand ils s'effacent. */}
          {image && (
            <img
              src={src}
              alt={t.dle.modes.pixel.title}
              draggable={false}
              className={`h-full w-full object-cover transition-opacity duration-700 select-none ${portrait ? 'object-top' : ''}`}
              style={{ opacity: columns === null ? 1 : 0 }}
            />
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
