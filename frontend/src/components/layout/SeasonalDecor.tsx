import type { CSSProperties } from 'react'
import moonUrl from '../../assets/moon-soul-eater.svg'
import { useT } from '../../i18n'
import { useThemeStore } from '../../store/useThemeStore'

/**
 * Décor du thème saisonnier, choisi par l'administration (cf. `useThemeStore`). Tout passe
 * DERRIÈRE l'interface (aucun bouton ni texte masqué) et ne coûte presque rien : des tracés
 * SVG peints une fois, aucun flou ni particule ; seuls quelques petits éléments s'animent, en
 * CSS (`transform`), et rien ne bouge si l'appareil demande moins d'animations.
 */
export function SeasonalDecor() {
  const theme = useThemeStore((state) => state.theme)
  if (theme === 'halloween') return <HalloweenDecor />
  return null
}

/** Chauves-souris : hauteur (% de l'écran), taille (px), durée de traversée (s), décalage (s), sens. */
const BATS = [
  { top: 14, size: 34, duration: 19, delay: -3, reverse: false },
  { top: 26, size: 22, duration: 26, delay: -14, reverse: true },
  { top: 9, size: 18, duration: 31, delay: -22, reverse: false },
  { top: 38, size: 26, duration: 23, delay: -9, reverse: true },
]

function HalloweenDecor() {
  return (
    <div aria-hidden data-seasonal-decor className="pointer-events-none fixed inset-0 -z-[4] overflow-hidden">
      {/* Ciel : une lueur orangée en haut, une brume violette en bas. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(70% 45% at 82% 0%, rgba(255,122,26,0.04), transparent 70%), radial-gradient(90% 40% at 20% 100%, rgba(124,58,237,0.04), transparent 72%)',
        }}
      />

      {/* En retrait : plus petite et voilée, elle ne doit pas lutter avec les cartes posées dessus. */}
      <Moon dim />

      <WebsAndBats />
    </div>
  )
}

/** Toiles d'araignée dans les coins du haut, l'araignée qui pend à son fil, et les chauves-souris. */
function WebsAndBats({ bats = BATS }: { bats?: typeof BATS }) {
  return (
    <>
      <Cobweb className="absolute -top-1 -left-1 w-[min(34vw,190px)]" />
      <Cobweb className="absolute -top-1 -right-1 w-[min(26vw,150px)] -scale-x-100" />
      <div data-seasonal-motion className="absolute top-0 left-[min(18vw,100px)] origin-top" style={{ animation: 'spider-bob 4.5s ease-in-out infinite' }}>
        <div className="mx-auto h-[min(16vh,120px)] w-px bg-white/25" />
        <Spider />
      </div>
      {bats.map((bat, index) => (
        <div
          key={index}
          data-seasonal-motion
          className="absolute left-0"
          style={{ top: `${bat.top}%`, animation: `bat-cross ${bat.duration}s linear ${bat.delay}s infinite ${bat.reverse ? 'reverse' : 'normal'}` }}
        >
          <div data-seasonal-motion style={{ animation: `bat-wave ${3 + index * 0.7}s ease-in-out infinite` }}>
            <Bat size={bat.size} flip={bat.reverse} flap={0.22 + index * 0.04} />
          </div>
        </div>
      ))}
    </>
  )
}

/**
 * Pour les écrans qui recouvrent tout (ouverture des boosters…) et masquent le décor de fond :
 * toiles d'araignée et deux chauves-souris, à poser DANS leur fond (derrière leur contenu).
 */
export function SeasonalOverlay() {
  const theme = useThemeStore((state) => state.theme)
  if (theme !== 'halloween') return null
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <WebsAndBats bats={BATS.slice(0, 2)} />
    </div>
  )
}

/**
 * Petite toile d'araignée dans un coin d'une surface (carte, tuile) ; rien hors thème. Le parent
 * doit être positionné (`relative`) : la toile épouse ses coins arrondis.
 */
export function SeasonalCorner({
  corner = 'right',
  size = 56,
  behind = false,
}: {
  corner?: 'left' | 'right'
  size?: number
  /** Sous le contenu de la surface (qui doit former un contexte d'empilement) : textes et boutons passent devant. */
  behind?: boolean
}) {
  const theme = useThemeStore((state) => state.theme)
  if (theme !== 'halloween') return null
  return (
    <span aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${behind ? '-z-10' : 'z-[1]'}`} style={{ borderRadius: 'inherit' }}>
      <Cobweb strong className={`absolute top-0 ${corner === 'right' ? 'right-0 -scale-x-100' : 'left-0'}`} style={{ width: size }} />
    </span>
  )
}

/**
 * Bandeau de fête en tête du hub des Activités : un titre, un mot, la lune qui ricane, deux
 * chauves-souris et une toile dans le coin ; rien hors thème.
 */
export function SeasonalHubBanner() {
  const t = useT()
  const theme = useThemeStore((state) => state.theme)
  if (theme !== 'halloween') return null
  const copy = t.seasonal.halloween
  return (
    <section
      aria-label={copy.title}
      className="relative isolate flex shrink-0 items-center gap-4 overflow-hidden rounded-[1.75rem] border border-[#ff7a1a]/30 py-4 pr-3 pl-5"
      style={{ background: 'radial-gradient(90% 130% at 100% 0%, rgba(255,122,26,0.24), transparent 62%), linear-gradient(120deg, #1a0b26, #140818 55%, #24100a)' }}
    >
      <Cobweb strong className="pointer-events-none absolute top-0 left-0 -z-10" style={{ width: 72 }} />
      <span aria-hidden className="pointer-events-none absolute top-3 right-[6.5rem] -z-10">
        <Bat size={8} flip={false} flap={0.26} />
      </span>
      <span aria-hidden className="pointer-events-none absolute right-[8.5rem] bottom-3 -z-10">
        <Bat size={6} flip flap={0.3} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold tracking-[0.28em] text-[#ffb64d]/85 uppercase">{copy.eyebrow}</p>
        <h2 className="mt-0.5 font-display text-2xl leading-tight text-[#ffd9a0]">{copy.title}</h2>
        <p className="mt-1 text-xs leading-snug text-cream/65">{copy.body}</p>
      </div>
      <Moon className="relative shrink-0" style={{ width: 80 }} />
    </section>
  )
}

/** Petite chauve-souris à côté d'un titre ; rien hors thème. */
export function SeasonalTitleMark() {
  const theme = useThemeStore((state) => state.theme)
  if (theme !== 'halloween') return null
  return (
    <span aria-hidden className="ml-2 inline-block align-middle">
      <Bat size={9} flip={false} flap={0.3} />
    </span>
  )
}

/**
 * La lune qui ricane, façon Soul Eater (`assets/moon-soul-eater.svg`), et son halo doré (un
 * dégradé : aucun flou). Par défaut en haut à droite de l'écran, entièrement visible, sous les
 * boutons de l'en-tête ; `className` et `style` la placent ailleurs (bandeau du hub).
 */
function Moon({ className = 'absolute', style, dim = false }: { className?: string; style?: CSSProperties; /** Décor de fond : voilée, sans halo marqué. */ dim?: boolean }) {
  return (
    <div className={className} style={style ?? { top: 'max(5rem, 10vh)', right: 'max(1rem, 3vw)', width: 'min(36vmin, 220px)', opacity: dim ? 0.3 : 1 }}>
      <div className="absolute -inset-[30%] rounded-full" style={{ background: `radial-gradient(closest-side, rgba(255,214,90,${dim ? 0.1 : 0.2}), rgba(255,170,40,${dim ? 0.03 : 0.07}) 55%, transparent)` }} />
      {/* Elle se balance doucement, comme suspendue (transform seulement ; immobile si l'appareil le demande). */}
      <img
        src={moonUrl}
        alt=""
        draggable={false}
        decoding="async"
        data-seasonal-motion
        className="relative block h-auto w-full"
        style={{ transformOrigin: '50% 12%', animation: 'moon-sway 6.5s ease-in-out infinite' }}
      />
    </div>
  )
}

/** Une chauve-souris, vue de face ; ses ailes battent (`flap`, en s). */
function Bat({ size, flip, flap }: { size: number; flip: boolean; flap: number }) {
  return (
    <svg viewBox="0 0 64 32" width={size * 2} height={size} style={{ transform: flip ? 'scaleX(-1)' : undefined }}>
      <g data-seasonal-motion style={{ transformOrigin: '32px 14px', animation: `bat-flap ${flap}s ease-in-out infinite alternate` } as CSSProperties}>
        <path
          d="M32 12 C28 8 22 4 12 4 C14 8 13 12 8 14 C4 14 2 12 0 12 C4 18 10 22 16 20 C18 24 24 26 28 22 C30 24 34 24 36 22 C40 26 46 24 48 20 C54 22 60 18 64 12 C62 12 60 14 56 14 C51 12 50 8 52 4 C42 4 36 8 32 12 Z"
          fill="#0b0612"
          stroke="#2a1640"
          strokeWidth="0.8"
        />
        <path d="M29 10 L30.5 6.5 L32 9.5 L33.5 6.5 L35 10 Z" fill="#0b0612" />
        <circle cx="30.4" cy="12.4" r="0.9" fill="#ff8a2a" />
        <circle cx="33.6" cy="12.4" r="0.9" fill="#ff8a2a" />
      </g>
    </svg>
  )
}

/** Toile d'araignée d'angle : rayons et fils en arcs, très discrets. */
function Cobweb({ className, style, strong = false }: { className: string; style?: CSSProperties; /** Petite toile (coin de carte) : traits plus marqués. */ strong?: boolean }) {
  const rays = [0, 15, 30, 45, 60, 75, 90]
  const rings = [22, 40, 58, 76, 94]
  const point = (radius: number, angle: number) => [radius * Math.cos((angle * Math.PI) / 180), radius * Math.sin((angle * Math.PI) / 180)] as const
  return (
    <svg viewBox="0 0 100 100" className={className} style={style} fill="none" stroke={strong ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.09)'} strokeWidth={strong ? 1.6 : 0.7}>
      {rays.map((angle) => {
        const [x, y] = point(100, angle)
        return <line key={angle} x1="0" y1="0" x2={x} y2={y} />
      })}
      {rings.map((radius) => (
        <path
          key={radius}
          d={rays
            .map((angle, index) => {
              const [x, y] = point(radius, angle)
              if (index === 0) return `M${x.toFixed(1)} ${y.toFixed(1)}`
              const [mx, my] = point(radius * 0.86, angle - 7.5)
              return `Q${mx.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`
            })
            .join(' ')}
        />
      ))}
    </svg>
  )
}

/** L'araignée, au bout de son fil. */
function Spider() {
  return (
    <svg viewBox="0 0 40 32" className="-mt-1 block w-7">
      <g stroke="#0b0612" strokeWidth="1.6" strokeLinecap="round" fill="none">
        <path d="M14 14 L6 8 L2 12 M14 17 L4 16 L1 21 M15 20 L6 24 L4 30 M17 21 L12 28" />
        <path d="M26 14 L34 8 L38 12 M26 17 L36 16 L39 21 M25 20 L34 24 L36 30 M23 21 L28 28" />
      </g>
      <ellipse cx="20" cy="18" rx="7" ry="6" fill="#0b0612" stroke="#3b1f55" strokeWidth="0.8" />
      <circle cx="20" cy="10.5" r="4" fill="#0b0612" stroke="#3b1f55" strokeWidth="0.8" />
      <circle cx="18.6" cy="10" r="0.8" fill="#ff8a2a" />
      <circle cx="21.4" cy="10" r="0.8" fill="#ff8a2a" />
    </svg>
  )
}
