import type { CSSProperties } from 'react'

/*
 * Noël : les dessins du thème (sapin, Père Noël, traîneau, guirlande, houx, bonnet), en SVG à
 * plat — aplats et traits, aucun flou. Ce qui bouge le fait en CSS (`data-seasonal-motion`, coupé
 * si l'appareil demande moins d'animations) : le traîneau et le bras du Père Noël par `transform`
 * (composité), et les ampoules clignotent par paliers (`steps`), en deux groupes qui alternent :
 * l'écran ne se repeint qu'à chaque bascule, quelques fois par seconde.
 */

const XMAS = {
  red: '#e3263a',
  redDark: '#a5102a',
  gold: '#ffd35c',
  goldDark: '#c9952a',
  green: '#2f9a5f',
  greenDark: '#1d6e43',
  snow: '#f4f7ff',
  snowShade: '#c9d6ee',
  skin: '#ffd2b4',
  ink: '#2a1a14',
  blue: '#6cc8ff',
  wood: '#6b3f22',
  deer: '#9a6440',
} as const

const BULBS = [XMAS.red, XMAS.gold, '#5fe08a', XMAS.blue]

/** Les deux groupes d'ampoules : l'un s'allume quand l'autre s'éteint. */
const twinkle = (index: number): CSSProperties => ({ animation: `xmas-twinkle 2.4s steps(1, end) ${index % 2 ? '-1.2s' : '0s'} infinite` })

type Point = readonly [number, number]
/** Un point d'une courbe de Bézier quadratique. */
const quad = (a: Point, b: Point, c: Point, t: number): Point => [
  (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t ** 2 * c[0],
  (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t ** 2 * c[1],
]

/** Une étoile à cinq branches, centrée en (x, y). */
const starPoints = (x: number, y: number, outer: number, inner: number) =>
  Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5
    const radius = index % 2 ? inner : outer
    return `${(x + Math.cos(angle) * radius).toFixed(1)},${(y + Math.sin(angle) * radius).toFixed(1)}`
  }).join(' ')

/** Une ampoule pendue à son fil, en (x, y). */
function Bulb({ x, y, index }: { x: number; y: number; index: number }) {
  const color = BULBS[index % BULBS.length]
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
      <rect x="-1.7" y="-0.5" width="3.4" height="3.4" rx="0.7" fill="#24352d" />
      <g data-seasonal-motion style={twinkle(index)}>
        <circle cy="8" r="7" fill={color} opacity="0.2" />
        <ellipse cy="7.6" rx="3.1" ry="4.6" fill={color} />
        <ellipse cx="-1.1" cy="6" rx="0.9" ry="1.6" fill="#fff" opacity="0.75" />
      </g>
    </g>
  )
}

/**
 * Une guirlande lumineuse qui pend en festons, de gauche à droite (`swags` festons de 100 unités
 * chacun). Sa largeur en pixels se règle par `style` ; le parent coupe ce qui dépasse.
 */
export function Garland({ swags, className, style }: { swags: number; className?: string; style?: CSSProperties }) {
  const wire = `M0 3 ${Array.from({ length: swags }, (_, index) => `Q${index * 100 + 50} 26 ${index * 100 + 100} 3`).join(' ')}`
  const bulbs = Array.from({ length: swags }, (_, swag) =>
    [0.2, 0.4, 0.6, 0.8].map((t) => {
      const [x, y] = quad([swag * 100, 3], [swag * 100 + 50, 26], [swag * 100 + 100, 3], t)
      return { x, y }
    }),
  ).flat()
  return (
    <svg viewBox={`0 0 ${swags * 100} 40`} className={className} style={style} aria-hidden>
      <path d={wire} fill="none" stroke="#163b2a" strokeWidth="1.6" />
      {bulbs.map((bulb, index) => (
        <Bulb key={index} x={bulb.x} y={bulb.y} index={index} />
      ))}
      {/* Aux attaches : un nœud rouge et deux feuilles de houx. */}
      {Array.from({ length: swags + 1 }, (_, index) => (
        <g key={index} transform={`translate(${index * 100} 3)`}>
          <path d="M0 0 Q-6 -1 -9 3 Q-4 4 0 0 Z M0 0 Q6 -1 9 3 Q4 4 0 0 Z" fill={XMAS.green} />
          <circle r="2.6" fill={XMAS.red} />
        </g>
      ))}
    </svg>
  )
}

/** Les étages du sapin : la silhouette entière, sa moitié droite (à l'ombre), et son bord festonné (enneigé). */
const TIERS = [
  {
    full: 'M60 62 L110 128 Q101 136 92 129 Q83 137 74 130 Q67 137 60 130 Q53 137 46 130 Q37 137 28 129 Q19 136 10 128 Z',
    shade: 'M60 62 L110 128 Q101 136 92 129 Q83 137 74 130 Q67 137 60 130 Z',
    rim: 'M110 128 Q101 136 92 129 Q83 137 74 130 Q67 137 60 130 Q53 137 46 130 Q37 137 28 129 Q19 136 10 128',
  },
  {
    full: 'M60 38 L100 98 Q91 106 82 99 Q71 107 60 100 Q49 107 38 99 Q29 106 20 98 Z',
    shade: 'M60 38 L100 98 Q91 106 82 99 Q71 107 60 100 Z',
    rim: 'M100 98 Q91 106 82 99 Q71 107 60 100 Q49 107 38 99 Q29 106 20 98',
  },
  {
    full: 'M60 14 L90 68 Q80 76 70 69 Q60 76 50 69 Q40 76 30 68 Z',
    shade: 'M60 14 L90 68 Q80 76 70 69 Q60 76 50 69 Z',
    rim: 'M90 68 Q80 76 70 69 Q60 76 50 69 Q40 76 30 68',
  },
]
/** Les guirlandes dorées drapées sur chaque étage (début, point de contrôle, fin). */
const DRAPES: [Point, Point, Point][] = [
  [[26, 110], [60, 130], [92, 106]],
  [[34, 84], [60, 98], [86, 80]],
  [[44, 50], [60, 60], [76, 46]],
]
const BAUBLES = [
  { x: 34, y: 121, color: XMAS.red },
  { x: 70, y: 125, color: XMAS.blue },
  { x: 92, y: 118, color: XMAS.gold },
  { x: 42, y: 92, color: XMAS.gold },
  { x: 77, y: 93, color: XMAS.red },
  { x: 52, y: 62, color: XMAS.blue },
  { x: 67, y: 38, color: XMAS.red },
]

/**
 * Le sapin : trois étages en deux verts (la moitié droite à l'ombre), bords enneigés, guirlandes
 * dorées semées d'ampoules, boules, l'étoile au sommet, et les cadeaux au pied, sur la neige.
 */
export function ChristmasTree({ className, style }: { className?: string; style?: CSSProperties }) {
  const lights = DRAPES.flatMap(([a, b, c]) => [0.12, 0.37, 0.63, 0.88].map((t) => quad(a, b, c, t)))
  return (
    <svg viewBox="0 0 120 152" className={className} style={style} aria-hidden>
      <ellipse cx="60" cy="144" rx="57" ry="7.5" fill={XMAS.snow} />
      <ellipse cx="66" cy="146" rx="44" ry="4.5" fill={XMAS.snowShade} opacity="0.6" />
      <rect x="53" y="124" width="14" height="18" rx="2" fill={XMAS.wood} />
      {TIERS.map((tier) => (
        <g key={tier.full}>
          <path d={tier.full} fill={XMAS.green} />
          <path d={tier.shade} fill={XMAS.greenDark} />
          <path d={tier.rim} fill="none" stroke={XMAS.snow} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
      {DRAPES.map(([a, b, c]) => (
        <path key={a.join()} d={`M${a.join(' ')} Q${b.join(' ')} ${c.join(' ')}`} fill="none" stroke={XMAS.gold} strokeWidth="1.6" strokeLinecap="round" />
      ))}
      {BAUBLES.map((bauble) => (
        <g key={`${bauble.x}-${bauble.y}`} transform={`translate(${bauble.x} ${bauble.y})`}>
          <rect x="-1.4" y="-5.8" width="2.8" height="2" rx="0.5" fill={XMAS.goldDark} />
          <circle r="4.3" fill={bauble.color} />
          <circle cx="-1.4" cy="-1.4" r="1.2" fill="#fff" opacity="0.7" />
        </g>
      ))}
      {lights.map(([x, y], index) => (
        <circle key={index} data-seasonal-motion cx={x.toFixed(1)} cy={y.toFixed(1)} r="1.7" fill={BULBS[index % BULBS.length]} style={twinkle(index)} />
      ))}
      {/* L'étoile du sommet, sur son halo (un aplat clair, aucun flou). */}
      <circle cx="60" cy="13" r="13" fill={XMAS.gold} opacity="0.18" />
      <polygon points={starPoints(60, 13, 10, 4.4)} fill={XMAS.gold} stroke="#fff1b0" strokeWidth="1" strokeLinejoin="round" />
      {/* Les cadeaux. */}
      <g>
        <rect x="16" y="127" width="25" height="16" rx="1.5" fill={XMAS.red} />
        <rect x="26.5" y="127" width="4" height="16" fill={XMAS.gold} />
        <rect x="16" y="133" width="25" height="4" fill={XMAS.gold} />
        <path d="M28.5 127 C24 120 18 122 21 126 Z M28.5 127 C33 120 39 122 36 126 Z" fill={XMAS.gold} stroke={XMAS.goldDark} strokeWidth="0.6" />
      </g>
      <g>
        <rect x="80" y="131" width="21" height="12" rx="1.5" fill="#3a7bd5" />
        <rect x="88.5" y="131" width="4" height="12" fill={XMAS.snow} />
        <path d="M90.5 131 C87 126 82 128 85 130.5 Z M90.5 131 C94 126 99 128 96 130.5 Z" fill={XMAS.snow} />
      </g>
      <g>
        <rect x="64" y="135" width="13" height="9" rx="1.2" fill={XMAS.gold} />
        <rect x="69" y="135" width="3" height="9" fill={XMAS.red} />
      </g>
    </svg>
  )
}

/**
 * Le Père Noël, en buste : bonnet qui retombe et son pompon, joues roses, yeux plissés de rire,
 * moustache et grande barbe. Il fait coucou de la main droite (un bras à part, qui pivote).
 */
export function Santa({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={className} style={style} aria-hidden>
      <div className="relative">
        <svg viewBox="0 0 100 104" className="block h-auto w-full">
          {/* Le manteau, sa bande de fourrure. */}
          <path d="M12 104 Q14 86 30 82 L60 82 Q76 86 78 104 Z" fill={XMAS.red} />
          <path d="M60 82 Q76 86 78 104 L64 104 Q64 90 58 82 Z" fill={XMAS.redDark} opacity="0.6" />
          <rect x="40" y="86" width="9" height="18" fill={XMAS.snow} />
          {/* Le bonnet, qui retombe sur la droite. */}
          <path d="M18 44 C20 18 42 4 62 8 C78 11 88 24 90 36 C86 33 81 32 77 34 C71 26 61 24 53 28 C45 32 41 38 40 44 Z" fill={XMAS.red} />
          <path d="M62 8 C78 11 88 24 90 36 C86 33 81 32 77 34 C72 26 66 23 58 24 C62 18 64 12 62 8 Z" fill={XMAS.redDark} opacity="0.55" />
          <circle cx="88" cy="38" r="7.5" fill={XMAS.snow} />
          <circle cx="90" cy="40" r="4" fill={XMAS.snowShade} opacity="0.6" />
          {/* Le visage. */}
          <ellipse cx="44" cy="60" rx="19" ry="16" fill={XMAS.skin} />
          <rect x="14" y="38" width="60" height="13" rx="6.5" fill={XMAS.snow} />
          <rect x="14" y="46" width="60" height="5" rx="2.5" fill={XMAS.snowShade} opacity="0.55" />
          <circle cx="31" cy="64" r="4.2" fill="#ff8f8f" opacity="0.75" />
          <circle cx="57" cy="64" r="4.2" fill="#ff8f8f" opacity="0.75" />
          <path d="M30 54 Q35 50.5 40 54 M48 54 Q53 50.5 58 54" fill="none" stroke={XMAS.snow} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M31.5 58.5 Q35 55 38.5 58.5 M49.5 58.5 Q53 55 56.5 58.5" fill="none" stroke={XMAS.ink} strokeWidth="2.2" strokeLinecap="round" />
          {/* La barbe, la moustache, le nez. */}
          <path d="M24 63 Q20 84 34 94 Q44 101 54 94 Q68 84 64 63 Q58 71 50 69 Q44 75 38 69 Q30 71 24 63 Z" fill={XMAS.snow} />
          <path d="M33 82 Q44 90 55 82 M37 90 Q44 95 51 90" fill="none" stroke={XMAS.snowShade} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M44 67 Q37.5 62.5 30.5 68 Q36 73 44 70 Z M44 67 Q50.5 62.5 57.5 68 Q52 73 44 70 Z" fill={XMAS.snow} stroke={XMAS.snowShade} strokeWidth="0.8" />
          <path d="M40.5 74 Q44 77 47.5 74" fill="none" stroke="#a03a2a" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="44" cy="64.5" r="4.4" fill="#ff9e8a" />
          <circle cx="42.8" cy="63.2" r="1.2" fill="#fff" opacity="0.6" />
        </svg>
        {/* Le bras levé, qui fait coucou : il pivote à l'épaule. */}
        <div data-seasonal-motion className="absolute" style={{ left: '72%', top: '50%', width: '30%', transformOrigin: '30% 100%', animation: 'santa-wave 2.8s ease-in-out infinite' }}>
          <svg viewBox="0 0 30 40" className="block h-auto w-full">
            <path d="M5 40 L10 19 L21 21 L17 40 Z" fill={XMAS.red} />
            <path d="M8.5 22 L22 24 L23.5 16.5 L10 14.5 Z" fill={XMAS.snow} />
            <ellipse cx="17" cy="9" rx="7" ry="8" fill={XMAS.green} />
            <ellipse cx="9.5" cy="11.5" rx="2.6" ry="4" transform="rotate(-30 9.5 11.5)" fill={XMAS.green} />
            <ellipse cx="15" cy="6" rx="2" ry="2.6" fill="#fff" opacity="0.25" />
          </svg>
        </div>
      </div>
    </div>
  )
}

/** Un renne au galop, tourné vers la droite, en (x, 0) ; le premier de l'attelage a le nez rouge. */
function Reindeer({ x, glowing }: { x: number; glowing: boolean }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <g stroke={XMAS.deer} strokeWidth="2.4" strokeLinecap="round">
        <path d="M10 38 L17 46 M7 39 L12 47 M-10 38 L-17 45 M-7 39 L-11 47" />
      </g>
      <ellipse cx="-15" cy="31" rx="3" ry="2" fill="#f1e2c8" />
      <ellipse cx="0" cy="34" rx="15" ry="6.5" fill={XMAS.deer} />
      <ellipse cx="0" cy="37" rx="10" ry="3" fill="#c48a5e" opacity="0.6" />
      <path d="M8 30 L16 17 L21 19.5 L14 33 Z" fill={XMAS.deer} />
      <ellipse cx="20" cy="17" rx="5" ry="3.6" fill={XMAS.deer} />
      <ellipse cx="24" cy="18.5" rx="3.2" ry="2.4" fill={XMAS.deer} />
      <path d="M16.5 14 Q14 11.5 13 13.5 Q14.5 15 16.5 15 Z" fill={XMAS.deer} />
      <g stroke="#ecd6aa" strokeWidth="1.3" strokeLinecap="round" fill="none">
        <path d="M18.5 14 L15.5 5 M16.8 9.5 L12.5 7.5 M15.9 7 L17.2 3" />
        <path d="M20.5 13.5 L21.5 4 M21 8.5 L25 6.5" />
      </g>
      <circle cx="20.5" cy="16" r="0.9" fill={XMAS.ink} />
      {glowing && <circle cx="27.4" cy="18.4" r="5" fill="#ff2a3a" opacity="0.28" />}
      <circle cx="27.4" cy="18.4" r={glowing ? 2.4 : 1.4} fill={glowing ? '#ff2a3a' : XMAS.ink} />
      <path d="M6 28 L4 40" stroke={XMAS.gold} strokeWidth="1.6" />
    </g>
  )
}

/**
 * Le traîneau du Père Noël, tiré par deux rennes vers la droite : la hotte pleine de cadeaux, le
 * Père Noël aux rênes, et une traînée de poussière d'or derrière (des points posés, rien ne s'en
 * échappe).
 */
export function Sleigh({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="-28 0 258 60" className={className} style={style} aria-hidden>
      {[
        [-6, 40, 1.6],
        [-14, 34, 1.2],
        [-21, 42, 1],
        [-26, 36, 0.7],
      ].map(([x, y, r]) => (
        <circle key={x} cx={x} cy={y} r={r} fill={XMAS.gold} opacity="0.8" />
      ))}
      <path d="M64 26 Q100 21 133 29 M137 29 Q165 23 188 29" fill="none" stroke={XMAS.gold} strokeWidth="1" />
      <Reindeer x={125} glowing={false} />
      <Reindeer x={180} glowing />
      {/* La hotte et ses cadeaux. */}
      <rect x="17" y="3" width="9" height="8" rx="1" fill={XMAS.gold} />
      <rect x="26" y="0" width="8" height="9" rx="1" fill={XMAS.blue} transform="rotate(12 30 4.5)" />
      <path d="M13 26 Q9 9 23 7 Q34 5 37 15 Q39 24 35 30 L15 30 Z" fill="#2f6b45" />
      <path d="M17 12 Q24 14 33 11" fill="none" stroke="#24543a" strokeWidth="1.4" strokeLinecap="round" />
      {/* Le Père Noël, aux rênes. */}
      <ellipse cx="56" cy="26" rx="10" ry="9" fill={XMAS.red} />
      <path d="M60 24 L66 27" stroke={XMAS.red} strokeWidth="4" strokeLinecap="round" />
      <circle cx="67" cy="27" r="2.2" fill={XMAS.green} />
      <circle cx="58" cy="13" r="5.2" fill={XMAS.skin} />
      <path d="M53 14 Q53 23 58 24 Q63 23 63 14 Q60.5 17 58 16 Q55.5 17 53 14 Z" fill={XMAS.snow} />
      <path d="M52.5 11 Q56 1 67 4 L64 10 Z" fill={XMAS.red} />
      <rect x="52" y="9.5" width="12.5" height="3" rx="1.5" fill={XMAS.snow} />
      <circle cx="67" cy="4.5" r="2.1" fill={XMAS.snow} />
      {/* Le traîneau, ses patins dorés. */}
      <path d="M8 22 Q6 46 26 46 L76 46 Q88 46 90 34 Q91 28 86 26 Q82 32 74 32 L30 32 Q22 32 20 22 Z" fill={XMAS.red} stroke={XMAS.redDark} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M22 38 L80 38" stroke={XMAS.gold} strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
      <path d="M22 46 L20 54 M62 46 L62 54" stroke={XMAS.gold} strokeWidth="2" strokeLinecap="round" />
      <path d="M4 54 L80 54 Q94 54 96 44" fill="none" stroke={XMAS.gold} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

/** Un brin de houx : deux feuilles piquantes et trois baies, pour un coin de carte (en haut à gauche). */
export function Holly({ className, style }: { className?: string; style?: CSSProperties }) {
  const leaf = 'M0 0 Q4 -6 8 -5 L10 -9 Q13 -6 16 -6 L19 -10 Q22 -6 26 -5 L29 -8 Q32 -4 34 0 Q32 4 29 8 L26 5 Q22 6 19 10 L16 6 Q13 6 10 9 L8 5 Q4 6 0 0 Z'
  return (
    <svg viewBox="0 0 60 60" className={className} style={style} aria-hidden>
      {[18, 70].map((angle) => (
        <g key={angle} transform={`translate(9 9) rotate(${angle})`}>
          <path d={leaf} fill={XMAS.green} stroke={XMAS.greenDark} strokeWidth="1" strokeLinejoin="round" />
          <path d="M2 0 L31 0" stroke={XMAS.greenDark} strokeWidth="1" />
        </g>
      ))}
      {[
        [11, 13],
        [17, 9],
        [9, 19],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="3.8" fill={XMAS.red} stroke={XMAS.redDark} strokeWidth="0.8" />
          <circle cx={x - 1.1} cy={y - 1.1} r="1" fill="#fff" opacity="0.75" />
        </g>
      ))}
    </svg>
  )
}

/** De la neige posée sur le bord du haut d'une surface, avec ses coulures ; étirée à sa largeur. */
export function SnowCap({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 120 14" preserveAspectRatio="none" className={className} style={style} aria-hidden>
      <path d="M0 0H120V5Q116 9 112 6Q108 12 103 7Q97 10 92 6Q88 8 84 6Q80 13 75 7Q69 10 63 6Q58 9 53 6Q49 12 44 7Q38 10 32 6Q27 9 22 6Q18 11 13 6Q8 9 4 6Q2 7 0 5Z" fill={XMAS.snow} />
      <path
        d="M0 5Q2 7 4 6Q8 9 13 6Q18 11 22 6Q27 9 32 6Q38 10 44 7Q49 12 53 6Q58 9 63 6Q69 10 75 7Q80 13 84 6Q88 8 92 6Q97 10 103 7Q108 12 112 6Q116 9 120 5"
        fill="none"
        stroke={XMAS.snowShade}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** Un paquet cadeau : couvercle, ruban de satin blanc et son nœud. */
export function GiftBox({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 32 32" className={className} style={style} aria-hidden>
      <path d="M16 9 C11 1 4 4 8 8.5 Z M16 9 C21 1 28 4 24 8.5 Z" fill={XMAS.snow} stroke={XMAS.snowShade} strokeWidth="0.8" />
      <rect x="5" y="14" width="22" height="16" rx="2" fill={XMAS.red} />
      <rect x="18" y="14" width="9" height="16" rx="2" fill={XMAS.redDark} opacity="0.5" />
      <rect x="3" y="9" width="26" height="6" rx="1.6" fill="#ff4d5e" />
      <rect x="13.5" y="9" width="5" height="21" fill={XMAS.snow} />
      <circle cx="16" cy="9" r="2" fill={XMAS.snowShade} />
    </svg>
  )
}

/** Un gros nœud de ruban rouge satiné : deux boucles, le cœur noué, deux pans fourchus. */
export function Bow({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 60 44" className={className} style={style} aria-hidden>
      <path d="M28 22 L17 41 L22 38.5 L24.5 44 L32 23 Z" fill={XMAS.redDark} />
      <path d="M32 22 L43 41 L38 38.5 L35.5 44 L28 23 Z" fill={XMAS.red} />
      <path d="M30 21 C18 3 1 5 5 18 C8 27 22 26 30 21 Z" fill={XMAS.red} />
      <path d="M30 21 C42 3 59 5 55 18 C52 27 38 26 30 21 Z" fill={XMAS.red} />
      <path d="M30 21 C22 11 12 11 12 17 C13 22 23 23 30 21 Z" fill={XMAS.redDark} opacity="0.7" />
      <path d="M30 21 C38 11 48 11 48 17 C47 22 37 23 30 21 Z" fill={XMAS.redDark} opacity="0.7" />
      <path d="M9 11 C13 6 19 7 22 10" fill="none" stroke="#ff9aa4" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      <path d="M38 10 C41 7 47 6 51 11" fill="none" stroke="#ff9aa4" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      <ellipse cx="30" cy="21" rx="5.5" ry="6.5" fill={XMAS.red} stroke={XMAS.redDark} strokeWidth="1" />
      <ellipse cx="28.6" cy="19" rx="1.6" ry="2.2" fill="#fff" opacity="0.45" />
    </svg>
  )
}

/** Un petit bonnet de Père Noël, posé à côté d'un titre. */
export function SantaHat({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 34 26" className={className} style={style} aria-hidden>
      <path d="M3 21 C4 9 13 2 22 4 C27 5 30 10 30 15 L26 13 C23 9 18 8 14 10 C10 12 9 16 9 21 Z" fill={XMAS.red} />
      <rect x="1" y="18.5" width="21" height="6" rx="3" fill={XMAS.snow} />
      <circle cx="29.5" cy="16.5" r="3.4" fill={XMAS.snow} />
    </svg>
  )
}
