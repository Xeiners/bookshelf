/** Cadrage du dessin : remplir le cadre (rogné) ou s'y loger entier. */
const fit = (wide: boolean) => (wide ? 'xMidYMid slice' : 'xMidYMid meet') // i18n-ignore : attributs SVG

/**
 * L'emblème de Page Jump : un ciel de fin d'après-midi, des tomes qui flottent en escalier, et
 * le héros (une boule de papier au bandeau rouge) en plein bond, un éclat ✦ au-dessus de lui.
 * `wide` : remplit un cadre plus large que haut (rogné), sinon carré.
 */
export function JumpEmblem({ className = 'block size-16', wide = false }: { className?: string; wide?: boolean }) {
  return (
    <svg viewBox="0 0 72 72" preserveAspectRatio={fit(wide)} className={className} aria-hidden>
      <defs>
        <linearGradient id="jump-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a1f6e" />
          <stop offset="0.55" stopColor="#ff8a6b" />
          <stop offset="1" stopColor="#ffd59e" />
        </linearGradient>
      </defs>
      <rect width="72" height="72" fill="url(#jump-sky)" />
      {/* Nuages. */}
      <g fill="#ffffff" opacity="0.55">
        <circle cx="12" cy="52" r="5" />
        <circle cx="18" cy="53" r="4" />
        <circle cx="58" cy="30" r="4" />
        <circle cx="63" cy="31" r="3" />
      </g>
      {/* Étoiles, en haut. */}
      <g fill="#fff6d8">
        <rect x="8" y="9" width="1.2" height="1.2" />
        <rect x="30" y="5" width="1" height="1" />
        <rect x="62" y="12" width="1.2" height="1.2" />
      </g>
      {/* Tomes en escalier. */}
      {[
        { x: 8, y: 60, color: '#7c5cff' },
        { x: 40, y: 46, color: '#3fe0a0' },
        { x: 14, y: 30, color: '#ff6fb5' },
        { x: 44, y: 16, color: '#4cc9f0' },
      ].map((tome) => (
        <g key={tome.y}>
          <rect x={tome.x - 0.8} y={tome.y - 0.8} width="19.6" height="5.6" rx="1.6" fill="#1a1030" />
          <rect x={tome.x} y={tome.y} width="18" height="4" rx="1.2" fill={tome.color} />
          <rect x={tome.x + 2.5} y={tome.y + 0.7} width="14" height="1" fill="#fff4dc" />
        </g>
      ))}
      {/* Le héros en plein bond. */}
      <g transform="translate(36 36) rotate(-8)">
        <path d="M-4 -6 L-12 -9 L-11 -5 L-4 -4 Z" fill="#e63946" />
        <rect x="-6.6" y="-8.6" width="13.2" height="13.2" rx="6" fill="#1a1030" />
        <rect x="-5.8" y="-7.8" width="11.6" height="11.6" rx="5.4" fill="#fff4e0" />
        <rect x="-5.8" y="-6" width="11.6" height="2" fill="#e63946" />
        <ellipse cx="0.6" cy="-1.6" rx="0.9" ry="1.4" fill="#1a1030" />
        <ellipse cx="3.6" cy="-1.6" rx="0.9" ry="1.4" fill="#1a1030" />
      </g>
      {/* Un éclat ✦. */}
      <path d="M56 4 L57.2 7.8 L61 9 L57.2 10.2 L56 14 L54.8 10.2 L51 9 L54.8 7.8 Z" fill="#ffd35c" stroke="#1a1030" strokeWidth="0.6" />
    </svg>
  )
}
