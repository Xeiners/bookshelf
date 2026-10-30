import type { CSSProperties } from 'react'

/** Côté d'un calque carré centré sur le paquet (valeur CSS), et le décalage qui le centre. */
const centered = (size: string): CSSProperties => ({ width: size, height: size, left: `calc(${size} / -2)`, top: `calc(${size} / -2)` })

/** Masque radial : plein au centre, éteint avant les bords (aucune arête visible, même agrandi). */
const radialMask = (stops: string): CSSProperties => ({ maskImage: `radial-gradient(closest-side, ${stops})`, WebkitMaskImage: `radial-gradient(closest-side, ${stops})` })

/*
 * Tailles plafonnées : un calque de 2 000 px sur un écran ×3 pèserait des centaines de Mo de
 * mémoire graphique. Ce qui doit couvrir tout l'écran (éclair, lignes de vitesse) est un
 * calque à la taille de la fenêtre, centré sur le paquet par `--fx-x` / `--fx-y`.
 */
const GLOW = 'min(120vmin, 640px)'
const RAYS = 'min(150vmin, 760px)'
const AT = 'var(--fx-x, 50%) var(--fx-y, 45%)'

/** Ondes de choc : autant d'anneaux que la Mythique en lance. */
export const FX_RINGS = 4

/**
 * Calque d'effets plein écran de la révélation, piloté par `CardReveal` (attributs `data-fx-*`).
 * De l'arrière vers l'avant : lueurs pastel (Mythique), voile sombre, lignes de vitesse, puis,
 * centrés sur le paquet (`data-fx-origin`) : rayons, rayons irisés, lueur, ondes de choc ; enfin
 * l'éclair. La couleur vient de la variable `--fx-color`, posée à chaque révélation.
 *
 * Aucun flou ni mode de fusion animé : des dégradés peints une fois, dont seules l'opacité
 * et la transformation bougent (le compositeur s'en charge seul).
 */
export function RevealFx({ ring }: { /** Diamètre de départ des ondes de choc (≈ la carte). */ ring: number }) {
  return (
    <div data-fx aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden" style={{ '--fx-color': '#ffffff' } as CSSProperties}>
      <div data-fx-hue="0" className="absolute inset-0 opacity-0" style={{ background: 'radial-gradient(60% 45% at 18% 22%, rgba(255,94,196,0.5), transparent 70%)' }} />
      <div data-fx-hue="1" className="absolute inset-0 opacity-0" style={{ background: 'radial-gradient(60% 45% at 84% 30%, rgba(76,201,240,0.5), transparent 70%)' }} />
      <div data-fx-hue="2" className="absolute inset-0 opacity-0" style={{ background: 'radial-gradient(70% 45% at 50% 88%, rgba(255,196,107,0.45), transparent 70%)' }} />
      <div data-fx-dim className="absolute inset-0 bg-[#020205] opacity-0" />
      {/* Lignes de vitesse qui convergent vers la carte (charge de la Mythique). */}
      <div
        data-fx-zoom
        className="absolute inset-0 opacity-0"
        style={{
          background: `repeating-conic-gradient(from 0deg at ${AT}, rgba(255,255,255,0.7) 0deg 0.5deg, transparent 0.5deg 6deg)`,
          maskImage: `radial-gradient(circle at ${AT}, transparent 14vmin, rgba(0,0,0,0.55) 30vmin, #000 70vmin)`,
          WebkitMaskImage: `radial-gradient(circle at ${AT}, transparent 14vmin, rgba(0,0,0,0.55) 30vmin, #000 70vmin)`,
          transformOrigin: AT,
          willChange: 'transform, opacity',
        }}
      />

      <div data-fx-origin className="absolute size-0" style={{ left: '50%', top: '45%' }}>
        <div
          data-fx-rays
          className="absolute rounded-full opacity-0"
          style={{
            ...centered(RAYS),
            ...radialMask('#000 6%, rgba(0,0,0,0.45) 38%, transparent 70%'),
            background: 'repeating-conic-gradient(from 0deg, var(--fx-color) 0deg 4deg, transparent 4deg 13deg)',
            willChange: 'transform, opacity',
          }}
        />
        {/* Rayons irisés (Mythique) : l'arc-en-ciel, découpé en rayons par le masque (rayons ∩ fondu radial). */}
        <div
          data-fx-prism
          className="absolute rounded-full opacity-0"
          style={{
            ...centered(RAYS),
            background: 'conic-gradient(from 0deg, #ff5ec4, #ffc46b, #3fe0a0, #4cc9f0, #b46cff, #ff5ec4)',
            maskImage: 'repeating-conic-gradient(from 0deg, #000 0deg 3.5deg, transparent 3.5deg 10deg), radial-gradient(closest-side, #000 8%, rgba(0,0,0,0.5) 40%, transparent 72%)',
            WebkitMaskImage: 'repeating-conic-gradient(from 0deg, #000 0deg 3.5deg, transparent 3.5deg 10deg), radial-gradient(closest-side, #000 8%, rgba(0,0,0,0.5) 40%, transparent 72%)',
            maskComposite: 'intersect',
            WebkitMaskComposite: 'source-in',
            willChange: 'transform, opacity',
          }}
        />
        <div
          data-fx-glow
          className="absolute rounded-full opacity-0"
          style={{
            ...centered(GLOW),
            background: 'radial-gradient(closest-side, color-mix(in oklab, var(--fx-color) 70%, transparent), color-mix(in oklab, var(--fx-color) 22%, transparent) 45%, transparent 72%)',
            willChange: 'transform, opacity',
          }}
        />
        {Array.from({ length: FX_RINGS }, (_, index) => (
          <div
            key={index}
            data-fx-ring={index}
            className="absolute rounded-full opacity-0"
            style={{
              ...centered(`${ring}px`),
              background: 'radial-gradient(closest-side, transparent 70%, var(--ring, var(--fx-color)) 86%, rgba(255,255,255,0.95) 92%, transparent 100%)',
            }}
          />
        ))}
      </div>

      {/* Éclair de la révélation : blanc au cœur, à la couleur de la carte autour. */}
      <div
        data-fx-flash
        className="absolute inset-0 opacity-0"
        style={{
          background: `radial-gradient(circle at ${AT}, #ffffff 0, rgba(255,255,255,0.9) 9vmin, color-mix(in oklab, var(--fx-color) 55%, transparent) 30vmin, transparent 75vmin)`,
          willChange: 'opacity',
        }}
      />
    </div>
  )
}
