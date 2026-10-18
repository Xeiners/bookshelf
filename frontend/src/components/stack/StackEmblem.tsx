/**
 * L'emblème de Page Stack : une pile de tomes de manga debout, devant le Mont Fuji au coucher du
 * soleil. Aucune image : un SVG, repris à la une des Activités et à l'accueil du jeu.
 */
export function StackEmblem({ className = 'block size-full', wide = false }: { className?: string; wide?: boolean }) {
  const tomes = [
    { x: 22, y: 46, w: 28, h: 26, from: '#ff9a5c', to: '#c0368f' },
    { x: 24, y: 31, w: 24, h: 17, from: '#6ad0ff', to: '#6a5cff' },
    { x: 20, y: 17, w: 28, h: 16, from: '#7affc4', to: '#1f8a78' },
  ]
  // Attributs SVG, pas du texte d'interface.
  const fit = wide ? 'xMidYMax slice' : 'xMidYMid meet' // i18n-ignore
  return (
    <svg viewBox={wide ? '-10 -16 92 88' : '0 0 72 72'} preserveAspectRatio={fit} className={className} aria-hidden>
      <defs>
        <linearGradient id="stack-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b1a5e" />
          <stop offset="0.5" stopColor="#b8437f" />
          <stop offset="1" stopColor="#ffb07a" />
        </linearGradient>
        {tomes.map((tome, index) => (
          <linearGradient key={index} id={`stack-tome-${index}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={tome.from} />
            <stop offset="1" stopColor={tome.to} />
          </linearGradient>
        ))}
      </defs>
      <rect x="-10" y="-16" width="92" height="88" fill="url(#stack-sky)" />
      <circle cx="52" cy="46" r="11" fill="#ffe0a0" opacity="0.95" />
      <path d="M-10 66 L10 52 C16 46 20 40 24 36 L30 36 C34 40 38 46 44 52 L62 62 L82 54 V72 H-10 Z" fill="#4a2a7a" opacity="0.85" />
      <path d="M17 66 L31 38 L35 38 L49 66 Z" fill="#59307f" />
      <path d="M26 41 L36 41 L34 38 L28 38 Z" fill="#ffd9d0" />
      <rect x="-10" y="64" width="92" height="8" fill="#4a2a24" />
      {tomes.map((tome, index) => (
        <g key={index}>
          <rect x={tome.x} y={tome.y} width={tome.w} height={tome.h} rx="1.4" fill={`url(#stack-tome-${index})`} stroke="#1a1230" strokeWidth="1" />
          <rect x={tome.x} y={tome.y} width={tome.w * 0.1} height={tome.h} rx="1" fill="#000" opacity="0.28" />
          <circle cx={tome.x + tome.w * 0.58} cy={tome.y + tome.h * 0.38} r={tome.w * 0.18} fill="#fff" opacity="0.4" />
          <rect x={tome.x + tome.w * 0.22} y={tome.y + tome.h * 0.78} width={tome.w * 0.6} height={tome.h * 0.07} fill="#fff" opacity="0.8" />
        </g>
      ))}
    </svg>
  )
}
