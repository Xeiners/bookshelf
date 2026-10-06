import { useId } from 'react'

/** Texte gravé sur l'anneau du cercle : répété pour en faire le tour. */
const RUNES = '爆 ✦ BOMB PARTY ✦ ばくはつ ✦ '.repeat(4) // i18n-ignore

/**
 * Le terrain de la bombe : un cercle magique au sol. Anneau de runes qui tourne, hexagramme
 * en sens inverse, cercles concentriques et halo : tout prend la couleur de la bombe
 * (`--heat`, posée par la bombe sur un parent), du bleu au rouge à mesure que la mèche brûle.
 */
export function Arena() {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <radialGradient id={`${id}-floor`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopOpacity="0.22" style={{ stopColor: 'var(--heat, #6fd6ff)' }} />
          <stop offset="45%" stopColor="#7c5cff" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        <path id={`${id}-ring`} d="M100 100 m-82 0 a82 82 0 1 1 164 0 a82 82 0 1 1 -164 0" />
      </defs>

      {/* Sol : un halo coloré par la bombe. */}
      <circle cx="100" cy="100" r="96" fill={`url(#${id}-floor)`} style={{ transition: 'fill 400ms' }} />

      {/* Anneau extérieur : double trait et runes qui tournent. */}
      <circle cx="100" cy="100" r="90" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="0.6" />
      <circle cx="100" cy="100" r="76" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="0.6" />
      <g data-bomb-fx style={{ transformOrigin: '100px 100px', animation: 'seal-spin 60s linear infinite' }}>
        <text fontSize="6.2" letterSpacing="1.2" fill="#ffffff" fillOpacity="0.22" style={{ fontWeight: 600 }}>
          <textPath href={`#${id}-ring`}>{RUNES}</textPath>
        </text>
      </g>
      <g data-bomb-fx style={{ transformOrigin: '100px 100px', animation: 'seal-spin 24s linear infinite reverse' }}>
        <circle cx="100" cy="100" r="88" fill="none" strokeOpacity="0.4" strokeWidth="0.9" strokeDasharray="0.5 5" style={{ stroke: 'var(--heat, #6fd6ff)' }} />
      </g>

      {/* Hexagramme et cercle intérieur, en sens inverse. */}
      <g data-bomb-fx style={{ transformOrigin: '100px 100px', animation: 'seal-spin 40s linear infinite reverse' }}>
        <polygon points="100,38 153.7,131 46.3,131" fill="none" strokeOpacity="0.18" strokeWidth="0.8" style={{ stroke: 'var(--heat, #6fd6ff)' }} />
        <polygon points="100,162 46.3,69 153.7,69" fill="none" strokeOpacity="0.18" strokeWidth="0.8" style={{ stroke: 'var(--heat, #6fd6ff)' }} />
        <circle cx="100" cy="100" r="62" fill="none" stroke="#b46cff" strokeOpacity="0.16" strokeWidth="0.7" />
      </g>
      {/* Repères aux six pointes. */}
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <circle
          key={angle}
          cx={100 + Math.cos((angle * Math.PI) / 180) * 76}
          cy={100 + Math.sin((angle * Math.PI) / 180) * 76}
          r="1.6"
          fillOpacity="0.55"
          style={{ fill: 'var(--heat, #6fd6ff)' }}
        />
      ))}
    </svg>
  )
}
