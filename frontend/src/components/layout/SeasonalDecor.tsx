import type { CSSProperties } from 'react'
import moonUrl from '../../assets/moon-soul-eater.svg'
import { useT } from '../../i18n'
import { useThemeStore } from '../../store/useThemeStore'
import { ChristmasTree, Garland, Holly, Santa, SantaHat, Sleigh, SnowCap } from './ChristmasArt'

/**
 * Décor du thème saisonnier, choisi par l'administration (cf. `useThemeStore`) : Halloween ici,
 * Noël avec ses dessins dans `ChristmasArt.tsx`. Tout passe
 * DERRIÈRE l'interface (aucun bouton ni texte masqué) et ne coûte presque rien : des tracés
 * SVG peints une fois, aucun flou ni particule ; seuls quelques petits éléments s'animent, en
 * CSS (`transform`), et rien ne bouge si l'appareil demande moins d'animations.
 */
export function SeasonalDecor() {
  const theme = useThemeStore((state) => state.theme)
  if (theme === 'halloween') return <HalloweenDecor />
  if (theme === 'christmas') return <ChristmasDecor />
  return null
}

/**
 * Noël : une guirlande lumineuse tout le long du haut de l'écran, le sapin voilé dans le coin
 * bas (en retrait : il ne lutte pas avec les cartes), une neige légère qui tombe doucement, et le
 * traîneau qui traverse le ciel de temps en temps.
 */
function ChristmasDecor() {
  return (
    <div aria-hidden data-seasonal-decor className="pointer-events-none fixed inset-0 -z-[4] overflow-hidden">
      {/* Ciel : une lueur dorée en haut, un voile de sapin en bas. */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(70% 45% at 82% 0%, rgba(255,211,92,0.04), transparent 70%), radial-gradient(90% 40% at 20% 100%, rgba(47,154,95,0.05), transparent 72%)' }}
      />
      <ChristmasTree className="absolute right-[max(0.5rem,2vw)] bottom-[max(4.5rem,9vh)] h-auto w-[min(36vmin,220px)] opacity-[0.28]" />
      <Snowfall />
      <LightsAndSleigh />
    </div>
  )
}

/**
 * Les flocons du fond, tirés une fois (toujours les mêmes, à des places irrégulières) : la
 * profondeur (`depth`, 0 au loin → 1 tout près) règle leur taille, leur éclat et leur vitesse ;
 * chacun a son balancement et son moment de départ.
 */
const FLAKES = (() => {
  let seed = 20251224
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  return Array.from({ length: 30 }, (_, index) => {
    const depth = random() ** 1.6
    return {
      left: random() * 100,
      size: 2.2 + depth * 5,
      opacity: 0.3 + depth * 0.55,
      fall: 30 - depth * 15 + random() * 6,
      delay: -random() * 36,
      sway: ['s', 'm', 'l'][index % 3]!,
      swayTime: 3.2 + random() * 2.6,
    }
  })
})()

/**
 * Il neige doucement : chaque flocon descend (l'élément du dehors) en se balançant (celui du
 * dedans). Un disque aux bords doux (dégradé : aucun flou), et transform seulement.
 */
function Snowfall() {
  return (
    <div className="absolute inset-0">
      {FLAKES.map((flake, index) => (
        <div key={index} data-seasonal-motion className="absolute top-0" style={{ left: `${flake.left}%`, animation: `snow-fall ${flake.fall.toFixed(1)}s linear ${flake.delay.toFixed(1)}s infinite` }}>
          <div
            data-seasonal-motion
            className="rounded-full"
            style={{
              width: flake.size,
              height: flake.size,
              opacity: flake.opacity,
              background: 'radial-gradient(circle, #ffffff 0 38%, rgba(255,255,255,0.5) 62%, rgba(255,255,255,0) 72%)',
              animation: `snow-sway-${flake.sway} ${flake.swayTime.toFixed(1)}s ease-in-out ${(index * -0.7).toFixed(1)}s infinite alternate`,
            }}
          />
        </div>
      ))}
    </div>
  )
}

/** La guirlande en haut, et le traîneau qui passe (`sleigh` : il passe aussi). */
function LightsAndSleigh({ sleigh = true }: { sleigh?: boolean }) {
  return (
    <>
      <div className="absolute inset-x-0 top-0 overflow-hidden">
        <Garland swags={30} className="block h-auto max-w-none" style={{ width: 30 * 84 }} />
      </div>
      {sleigh && (
        <div data-seasonal-motion className="absolute top-[14%] left-0" style={{ animation: 'sleigh-cross 36s linear -9s infinite' }}>
          <div data-seasonal-motion style={{ animation: 'sleigh-bob 3.2s ease-in-out infinite' }}>
            <Sleigh className="block h-auto w-[min(48vw,220px)]" />
          </div>
        </div>
      )}
    </>
  )
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
 * toiles d'araignée et deux chauves-souris (Noël : la neige, la guirlande et le traîneau), à poser DANS leur
 * fond (derrière leur contenu).
 */
export function SeasonalOverlay() {
  const theme = useThemeStore((state) => state.theme)
  if (theme !== 'halloween' && theme !== 'christmas') return null
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {theme === 'halloween' ? (
        <WebsAndBats bats={BATS.slice(0, 2)} />
      ) : (
        <>
          <Snowfall />
          <LightsAndSleigh />
        </>
      )}
    </div>
  )
}

/**
 * Petite toile d'araignée (Noël : un brin de houx) dans un coin d'une surface (carte, tuile) ; rien hors thème. Le parent
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
  if (theme !== 'halloween' && theme !== 'christmas') return null
  return (
    <span aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${behind ? '-z-10' : 'z-[1]'}`} style={{ borderRadius: 'inherit' }}>
      {theme === 'halloween' ? (
        <Cobweb strong className={`absolute top-0 ${corner === 'right' ? 'right-0 -scale-x-100' : 'left-0'}`} style={{ width: size }} />
      ) : (
        <Holly className={`absolute top-1 ${corner === 'right' ? 'right-1 -scale-x-100' : 'left-1'}`} style={{ width: Math.round(size * 0.66) }} />
      )}
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
  if (theme === 'christmas') return <ChristmasHubBanner />
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

/**
 * Noël, en tête du hub : la guirlande qui pend du bord, le mot de l'équipe, et à droite le Père
 * Noël qui fait coucou au pied de son sapin.
 */
function ChristmasHubBanner() {
  const t = useT()
  const copy = t.seasonal.christmas
  return (
    <section
      aria-label={copy.title}
      className="relative isolate flex shrink-0 items-end gap-2 overflow-hidden rounded-[1.75rem] border border-[#ffd35c]/25 pt-6 pr-2 pb-3 pl-5"
      style={{ background: 'radial-gradient(90% 130% at 100% 0%, rgba(227,38,58,0.26), transparent 62%), linear-gradient(120deg, #0c2a1d, #0a1a14 55%, #2a0a12)' }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-0.5 -z-10 overflow-hidden">
        <Garland swags={10} className="block h-auto max-w-none" style={{ width: 10 * 66 }} />
      </div>
      <div className="min-w-0 flex-1 self-center pt-2">
        <p className="text-[10px] font-semibold tracking-[0.28em] text-[#ffd35c]/85 uppercase">{copy.eyebrow}</p>
        <h2 className="mt-0.5 font-display text-2xl leading-tight text-[#fff1d6]">{copy.title}</h2>
        <p className="mt-1 text-xs leading-snug text-cream/65">{copy.body}</p>
      </div>
      <div aria-hidden className="relative h-[6.6rem] w-[7.4rem] shrink-0">
        <ChristmasTree className="absolute right-0 bottom-0 h-auto w-[5rem]" />
        <Santa className="absolute bottom-0 left-0 w-[4.4rem]" />
      </div>
    </section>
  )
}

/**
 * Noël : de la neige posée sur le bord du haut d'une surface (carte, bannière) ; avec `garland`,
 * une guirlande qui pend sous la neige. Rien hors thème. Le parent doit être positionné et couper
 * ce qui dépasse ; poser ce décor après ce qu'il doit recouvrir.
 */
export function SeasonalSnow({ garland = false }: { garland?: boolean }) {
  const theme = useThemeStore((state) => state.theme)
  if (theme !== 'christmas') return null
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ borderRadius: 'inherit' }}>
      {garland && (
        <span className="absolute inset-x-0 top-0 overflow-hidden">
          <Garland swags={12} className="block h-auto max-w-none" style={{ width: 12 * 64 }} />
        </span>
      )}
      <SnowCap className="absolute inset-x-0 top-0 block h-3 w-full" />
    </span>
  )
}

/** Un bonnet de Père Noël posé sur un avatar ou une carte (`className` le place) ; rien hors thème. */
export function SeasonalHat({ className }: { className: string }) {
  const theme = useThemeStore((state) => state.theme)
  if (theme !== 'christmas') return null
  return <SantaHat className={`pointer-events-none ${className}`} />
}

/** Petite chauve-souris (Noël : un bonnet) à côté d'un titre ; rien hors thème. */
export function SeasonalTitleMark() {
  const theme = useThemeStore((state) => state.theme)
  if (theme === 'christmas') {
    return (
      <span aria-hidden className="ml-2 inline-block align-middle">
        <SantaHat className="block h-auto w-5 -rotate-12" />
      </span>
    )
  }
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
