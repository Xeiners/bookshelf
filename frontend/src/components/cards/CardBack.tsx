import { useId } from 'react'
import { CARD_RATIO } from './CollectibleCard'

/** Centre du sceau, dans le repère 63 × 88 de la carte. */
const CX = 31.5
const CY = 44

const point = (radius: number, degrees: number) => {
  const angle = ((degrees - 90) * Math.PI) / 180
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)] as const
}

/** Triangle inscrit, pointe vers le haut (0°) ou vers le bas (180°). */
const triangle = (radius: number, start: number) =>
  [0, 120, 240].map((offset) => point(radius, start + offset).map((value) => value.toFixed(2)).join(',')).join(' ')

/**
 * Glyphes de l'anneau runique : de petits tracés géométriques (pas de police
 * runique, absente de la plupart des téléphones), un tous les 30°.
 */
const GLYPHS = [
  'M0,-2 L0,2 M0,-2 L1.4,-0.6',
  'M-1,-2 L-1,2 M-1,-2 L1,0 L-1,2',
  'M0,-2 L0,2 M-1.3,-0.4 L1.3,-1.4',
  'M-1.2,2 L0,-2 L1.2,2 M-0.7,0.4 L0.7,0.4',
  'M0,-2 L0,2 M0,0 L1.4,-1.4 M0,0 L1.4,1.4',
  'M-1.3,-1.3 L1.3,1.3 M1.3,-1.3 L-1.3,1.3',
]

function GoldGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#fff4c8" />
      <stop offset="0.28" stopColor="#e2a93a" />
      <stop offset="0.5" stopColor="#fff0b3" />
      <stop offset="0.72" stopColor="#9a6a12" />
      <stop offset="1" stopColor="#ffe19a" />
    </linearGradient>
  )
}

/**
 * Dos commun à toutes les cartes : un sceau alchimique gravé à la feuille
 * d'or — double cadre, hexagramme, anneau de glyphes qui tourne lentement,
 * ornements d'angle — sur un fond d'encre gaufré.
 *
 * Performance : l'anneau qui tourne est un SVG À PART, animé par `transform`
 * (le compositeur le fait tourner sans repeindre) ; le reste est un SVG
 * statique, peint une fois. Ombre portée en `box-shadow`, pas en filtre SVG.
 */
export function CardBack({ width, animated = true }: { width: number; /** Anneau qui tourne ; coupé pour les petites vignettes. */ animated?: boolean }) {
  const height = Math.round(width * CARD_RATIO)
  // `useId` contient des « : », mal lus dans `url(#…)` : on les retire.
  const id = useId().replace(/:/g, '')
  const gold = `gold-${id}`
  const ringGold = `ring-gold-${id}`
  const ink = `ink-${id}`
  const lattice = `lattice-${id}`
  // Anneau : carré centré sur le sceau, en % de la carte.
  const ringSize = (42 / 63) * 100

  return (
    <div aria-hidden className="relative overflow-hidden rounded-[9%/6.5%]" style={{ width, height, boxShadow: '0 16px 30px -12px rgba(0,0,0,0.85), 0 0 22px -6px rgba(255,196,107,0.35)' }}>
      <svg width={width} height={height} viewBox="0 0 63 88" className="absolute inset-0 block">
        <defs>
          <GoldGradient id={gold} />
          <radialGradient id={ink} cx="0.5" cy="0.45" r="0.75">
            <stop offset="0" stopColor="#2a1a5c" />
            <stop offset="0.55" stopColor="#130d2b" />
            <stop offset="1" stopColor="#07060d" />
          </radialGradient>
          <pattern id={lattice} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0,0 L0,5" stroke="#ffc46b" strokeOpacity="0.07" strokeWidth="0.35" />
          </pattern>
        </defs>

        {/* Fond : encre profonde, gaufrage en losanges. */}
        <rect x="0" y="0" width="63" height="88" fill={`url(#${ink})`} />
        <rect x="0" y="0" width="63" height="88" fill={`url(#${lattice})`} />

        {/* Double cadre doré. */}
        <rect x="2.2" y="2.2" width="58.6" height="83.6" rx="4.4" fill="none" stroke={`url(#${gold})`} strokeWidth="1.1" />
        <rect x="4.6" y="4.6" width="53.8" height="78.8" rx="3" fill="none" stroke={`url(#${gold})`} strokeWidth="0.35" strokeOpacity="0.8" />

        {/* Ornements d'angle. */}
        {[
          [8.5, 8.5],
          [54.5, 8.5],
          [8.5, 79.5],
          [54.5, 79.5],
        ].map(([x, y]) => (
          <g key={`${x}-${y}`} transform={`translate(${x} ${y})`} fill={`url(#${gold})`}>
            <path d="M0,-2.4 L0.8,0 L0,2.4 L-0.8,0 Z" />
            <path d="M-2.4,0 L0,-0.8 L2.4,0 L0,0.8 Z" opacity="0.7" />
          </g>
        ))}

        {/* Sceau fixe : cercles, hexagramme, pointes, cœur. */}
        <g fill="none" stroke={`url(#${gold})`}>
          <circle cx={CX} cy={CY} r="21" strokeWidth="0.9" />
          <circle cx={CX} cy={CY} r="16.2" strokeWidth="0.4" />
          <polygon points={triangle(14.5, 0)} strokeWidth="0.6" />
          <polygon points={triangle(14.5, 180)} strokeWidth="0.6" />
          <circle cx={CX} cy={CY} r="7.2" strokeWidth="0.5" />
          <circle cx={CX} cy={CY} r="4.6" strokeWidth="0.3" strokeOpacity="0.7" />
        </g>
        <g fill={`url(#${gold})`}>
          {[0, 60, 120, 180, 240, 300].map((angle) => {
            const [x, y] = point(14.5, angle)
            return <circle key={angle} cx={x} cy={y} r="0.9" />
          })}
          <path d={`M${CX},${CY - 3.2} L${CX + 1.1},${CY} L${CX},${CY + 3.2} L${CX - 1.1},${CY} Z`} />
        </g>

        {/* Lustre : le métal accroche la lumière en haut à gauche. */}
        <path d="M0,0 L63,0 L0,40 Z" fill="#ffffff" opacity="0.05" />
      </svg>

      {/* Anneau de glyphes : SVG séparé, tourné par le compositeur. */}
      <svg
        viewBox="-21 -21 42 42"
        data-card-fx
        className="absolute"
        style={{
          width: `${ringSize}%`,
          left: `${50 - ringSize / 2}%`,
          top: `${50 - (ringSize * (63 / 88)) / 2}%`,
          aspectRatio: '1',
          animation: animated ? 'seal-spin 40s linear infinite' : undefined,
          willChange: animated ? 'transform' : undefined,
        }}
      >
        <defs>
          <GoldGradient id={ringGold} />
        </defs>
        <g fill="none" stroke={`url(#${ringGold})`} strokeWidth="0.45" strokeLinecap="round">
          {GLYPHS.flatMap((glyph, index) =>
            [0, 180].map((half) => {
              const angle = index * 30 + half
              const radians = ((angle - 90) * Math.PI) / 180
              const x = 18.6 * Math.cos(radians)
              const y = 18.6 * Math.sin(radians)
              return <path key={angle} d={glyph} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle})`} />
            }),
          )}
        </g>
      </svg>
    </div>
  )
}
