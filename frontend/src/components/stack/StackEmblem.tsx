/**
 * L'emblème de Page Stack : une pile de pages de manga sous un ciel de crépuscule. Aucune
 * image : un SVG, repris à la une des Activités et à l'accueil du jeu.
 */
export function StackEmblem({ className = 'block size-full', wide = false }: { className?: string; wide?: boolean }) {
  const pages = [
    { x: 14, y: 54, w: 44, hue: 340 },
    { x: 18, y: 45, w: 38, hue: 28 },
    { x: 13, y: 36, w: 42, hue: 200 },
    { x: 20, y: 27, w: 34, hue: 150 },
    { x: 17, y: 18, w: 36, hue: 275 },
  ]
  // Attributs SVG, pas du texte d'interface.
  const fit = wide ? 'xMidYMax slice' : 'xMidYMid meet' // i18n-ignore
  return (
    <svg viewBox={wide ? '-10 -16 92 88' : '0 0 72 72'} preserveAspectRatio={fit} className={className} aria-hidden>
      <defs>
        <linearGradient id="stack-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b2a8e" />
          <stop offset="0.6" stopColor="#ff8fb8" />
          <stop offset="1" stopColor="#ffd9a8" />
        </linearGradient>
      </defs>
      <rect x="-10" y="-16" width="92" height="88" fill="url(#stack-sky)" />
      <circle cx="54" cy="20" r="8" fill="#fff3c4" opacity="0.9" />
      <path d="M-10 58 L-4 50 L14 44 L26 54 L40 38 L56 54 L72 42 L82 50 V72 H-10 Z" fill="#4a2a7a" opacity="0.8" />
      <rect x="-10" y="62" width="92" height="10" fill="#4a2a24" />
      {pages.map((page, index) => (
        <g key={index}>
          <rect x={page.x} y={page.y + 2} width={page.w} height="8" rx="1.8" fill="#fffaf0" stroke="#1a1230" strokeWidth="1" />
          <rect x={page.x} y={page.y + 2} width={page.w} height="2.6" rx="1.2" fill={`hsl(${page.hue} 85% 62%)`} />
          <path d={`M${page.x + page.w * 0.45} ${page.y + 5} v4.2`} stroke="#1a1230" strokeWidth="0.8" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  )
}
