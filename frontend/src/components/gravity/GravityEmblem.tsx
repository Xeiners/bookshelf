import { useId } from 'react'

/**
 * L'emblème de Gravity Ninja : un couloir au soleil couchant, deux ninjas — l'un court sur le toit
 * d'en bas, l'autre la tête en bas sous celui d'en haut — et la flèche de l'inversion.
 * Identifiants propres à chaque exemplaire : une copie cachée (page masquée) ne prive pas les autres de leurs dégradés.
 */
export function GravityEmblem({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b1b4d" />
          <stop offset="0.55" stopColor="#d9577a" />
          <stop offset="1" stopColor="#ffb36b" />
        </linearGradient>
        <radialGradient id={`${id}-sun`}>
          <stop offset="0" stopColor="#fff6d8" />
          <stop offset="0.5" stopColor="#ffe3a0" />
          <stop offset="1" stopColor="#ffe3a0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="160" height="90" fill={`url(#${id}-sky)`} />
      <circle cx="112" cy="44" r="22" fill={`url(#${id}-sun)`} />
      <path d="M0 64 L14 52 L26 58 L40 46 L56 56 L70 48 L86 57 L102 47 L118 55 L134 45 L160 56 L160 90 L0 90 Z" fill="#7a3f73" />
      <g fill="#2a1236">
        <path d="M18 70 h22 l-4 -5 h-14 z M22 65 h14 v-6 h-14 z M20 59 h18 l-4 -4 h-10 z" />
        <path d="M120 70 h26 l-5 -6 h-16 z M125 64 h16 v-7 h-16 z M123 57 h20 l-5 -5 h-10 z" />
      </g>
      {/* Plafond (tuiles) et sol. */}
      <rect x="0" y="0" width="96" height="14" fill="#3b2433" />
      <path d="M0 14 h96" stroke="#ffb38a" strokeWidth="1.2" />
      {Array.from({ length: 16 }, (_, index) => (
        <circle key={`top-${index}`} cx={3 + index * 6} cy="12" r="3" fill="#c9473a" />
      ))}
      <rect x="40" y="76" width="120" height="14" fill="#3b2433" />
      <path d="M40 76 h120" stroke="#ffb38a" strokeWidth="1.2" />
      {Array.from({ length: 20 }, (_, index) => (
        <circle key={`bottom-${index}`} cx={43 + index * 6} cy="78" r="3" fill="#c9473a" />
      ))}
      {/* Ninja sous le plafond, la tête en bas. */}
      <g transform="translate(58 14) scale(1 -1)">
        <NinjaGlyph />
      </g>
      {/* Ninja sur le sol. */}
      <g transform="translate(100 76)">
        <NinjaGlyph />
      </g>
      {/* La flèche d'inversion. */}
      <g stroke="#fff4c8" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9">
        <path d="M80 62 V30" />
        <path d="M75 36 L80 30 L85 36" />
        <path d="M75 56 L80 62 L85 56" />
      </g>
    </svg>
  )
}

/** Un ninja minuscule, pieds à l'origine, qui court vers la droite. */
function NinjaGlyph() {
  return (
    <g>
      <path d="M-2 -13 C-10 -12 -16 -9 -21 -11 C-16 -7 -9 -8 -2 -10 Z" fill="#e3313f" />
      <path d="M-3 -2 L-6 0 M2 -2 L5 0" stroke="#1f2547" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M-4 -2 L-1 -14 L4 -13 L3 -2 Z" fill="#1f2547" />
      <path d="M-1 -11 L-11 -8" stroke="#1f2547" strokeWidth="2" strokeLinecap="round" />
      <circle cx="2" cy="-17" r="3.6" fill="#f3c9a6" />
      <path d="M-1.6 -16.5 h7.2 v3 h-7.2 z" fill="#161b36" />
      <path d="M-1.8 -19.4 h7.4 v1.6 h-7.4 z" fill="#dfe5ef" />
      <path d="M-1.4 -20.6 L-5 -22 L-2 -19 Z" fill="#151829" />
    </g>
  )
}
