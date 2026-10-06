import { useEffect, useId, useRef, type RefObject } from 'react'
import { SHAKE_BELOW_MS, heat, tickInterval } from '../../lib/bomb'
import { reducedMotion } from '../../lib/dle'
import { playBombTick } from '../../lib/sfx'

interface BombProps {
  /** Syllabe imposée, au cœur de l'orbe. */
  syllable: string | null
  /** Explosion, à l'heure LOCALE (ms) ; `null` : mèche éteinte (salon en attente, partie finie). */
  endsAt: number | null
  /** Durée totale de la mèche (ms). */
  totalMs: number
  /** Tic-tac audible (bruitages actifs, partie en cours). */
  audible?: boolean
  /** Élément secoué quand il reste moins de 5 s. */
  shakeRef?: RefObject<HTMLElement | null>
  /** La mèche est au bout (une fois par mèche). */
  onZero?: () => void
  /** Salon : la flèche d'énergie pointe vers le joueur qui tient la bombe (degrés). */
  pointTo?: number | null
  size?: number
}

/** Mèche : courbe qui part du bouchon et s'enroule vers le haut (unités du `viewBox`). */
const FUSE_PATH = 'M100 50 C 100 30, 118 22, 132 26 S 158 30, 166 12'

/**
 * La bombe de l'Anime Bomb Party : un orbe d'énergie occulte, sa mèche qui crépite et
 * raccourcit, la syllabe au centre. La couleur passe du bleu-violet au jaune puis au
 * rouge incandescent, le clignotement et le tic-tac accélèrent ; sous 5 s, l'écran tremble.
 * Tout s'anime image par image en écrivant directement dans le DOM (aucun rendu React).
 */
export function Bomb({ syllable, endsAt, totalMs, audible = false, shakeRef, onZero, pointTo = null, size = 248 }: BombProps) {
  const id = useId().replace(/:/g, '')
  const rootRef = useRef<HTMLDivElement>(null)
  const fuseRef = useRef<SVGPathElement>(null)
  const sparkRef = useRef<SVGGElement>(null)
  const onZeroRef = useRef(onZero)
  useEffect(() => {
    onZeroRef.current = onZero
  })

  useEffect(() => {
    const root = rootRef.current
    const fuse = fuseRef.current
    const spark = sparkRef.current
    if (!root || !fuse || !spark) return
    const length = fuse.getTotalLength()
    const still = reducedMotion()
    // L'élément secoué, tel qu'il est maintenant (le nettoyage le remet d'aplomb).
    const shaken = shakeRef?.current ?? null
    let frame = 0
    let lastTick = 0
    let fired = false

    const paint = (ratio: number) => {
      const { color, glow } = heat(ratio)
      root.style.setProperty('--heat', color)
      root.style.setProperty('--glow', glow)
      // Clignotement et pulsation : de ~1,4 s mèche pleine à ~0,18 s au bout.
      root.style.setProperty('--pulse', `${(0.18 + ratio * 1.22).toFixed(2)}s`)
      fuse.style.strokeDasharray = `${(length * ratio).toFixed(1)} ${length.toFixed(1)}`
      const point = fuse.getPointAtLength(length * ratio)
      spark.setAttribute('transform', `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`)
      spark.style.opacity = ratio > 0 && endsAt !== null ? '1' : '0'
    }

    const loop = () => {
      if (endsAt === null) {
        paint(1)
        if (shaken) shaken.style.transform = ''
        return
      }
      const now = Date.now()
      const remaining = Math.max(0, endsAt - now)
      const ratio = totalMs > 0 ? Math.min(1, remaining / totalMs) : 0
      paint(ratio)
      if (audible && remaining > 0 && now - lastTick >= tickInterval(ratio)) {
        lastTick = now
        playBombTick(1 - ratio)
      }
      // Secousse : de plus en plus forte dans les 5 dernières secondes.
      const target = shaken
      if (target) {
        if (!still && remaining > 0 && remaining < SHAKE_BELOW_MS) {
          const force = (1 - remaining / SHAKE_BELOW_MS) * 5 + 0.6
          target.style.transform = `translate(${((Math.random() - 0.5) * force).toFixed(1)}px, ${((Math.random() - 0.5) * force).toFixed(1)}px)`
        } else target.style.transform = ''
      }
      if (remaining === 0 && !fired) {
        fired = true
        onZeroRef.current?.()
      }
      frame = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      cancelAnimationFrame(frame)
      if (shaken) shaken.style.transform = ''
    }
  }, [endsAt, totalMs, audible, shakeRef])

  const burning = endsAt !== null
  const long = (syllable?.length ?? 0) > 2

  return (
    <div
      ref={rootRef}
      className="relative grid place-items-center select-none"
      style={{ width: size, height: size * 1.08, ['--heat' as string]: '#6fd6ff', ['--glow' as string]: 'rgba(124,92,255,0.65)', ['--pulse' as string]: '1.4s' }}
    >
      {/* Aura : respire au rythme de la mèche. */}
      <div
        aria-hidden
        data-bomb-fx
        className="absolute rounded-full"
        style={{
          inset: '8% 6% -2% 6%',
          background: 'radial-gradient(closest-side, var(--glow), transparent 72%)',
          animation: `bomb-pulse var(--pulse) ease-in-out infinite`,
          transition: 'background 300ms',
        }}
      />

      {/* Flèche d'énergie vers le joueur qui tient la bombe. */}
      {pointTo !== null && (
        <div aria-hidden className="absolute transition-transform duration-500 ease-out" style={{ inset: '14% 4% 0 4%', transform: `rotate(${pointTo}deg)` }}>
          <span
            className="absolute top-1/2 right-[-6px] h-0 w-0 -translate-y-1/2 border-y-[10px] border-l-[16px] border-y-transparent"
            style={{ borderLeftColor: 'var(--heat)', filter: 'drop-shadow(0 0 8px var(--heat))' }}
          />
        </div>
      )}

      <svg viewBox="0 -6 200 222" className="relative h-full w-full overflow-visible" aria-hidden>
        <defs>
          <radialGradient id={`${id}-body`} cx="38%" cy="34%" r="70%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="16%" stopOpacity="0.95" style={{ stopColor: 'var(--heat)' }} />
            <stop offset="52%" stopColor="#2b1658" />
            <stop offset="100%" stopColor="#07040f" />
          </radialGradient>
          <radialGradient id={`${id}-core`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopOpacity="0.55" style={{ stopColor: 'var(--heat)' }} />
            <stop offset="100%" stopOpacity="0" style={{ stopColor: 'var(--heat)' }} />
          </radialGradient>
          <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Anneaux d'énergie en orbite. */}
        <g data-bomb-fx style={{ transformOrigin: '100px 128px', animation: 'seal-spin 9s linear infinite' }}>
          <ellipse cx="100" cy="128" rx="92" ry="30" fill="none" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="2 7" style={{ stroke: 'var(--heat)' }} />
        </g>
        <g data-bomb-fx style={{ transformOrigin: '100px 128px', animation: 'seal-spin 14s linear infinite reverse' }}>
          <ellipse cx="100" cy="128" rx="30" ry="90" fill="none" stroke="#b46cff" strokeOpacity="0.3" strokeWidth="1.2" strokeDasharray="1 6" transform="rotate(35 100 128)" />
        </g>

        {/* Bouchon et mèche (brûlée en sombre, vive jusqu'à l'étincelle). */}
        <rect x="88" y="44" width="24" height="16" rx="5" fill="#2a1c45" strokeOpacity="0.7" strokeWidth="1.5" style={{ stroke: 'var(--heat)' }} />
        <path d={FUSE_PATH} fill="none" stroke="#3b2a1d" strokeWidth="4.5" strokeLinecap="round" strokeOpacity="0.45" />
        <path ref={fuseRef} d={FUSE_PATH} fill="none" stroke="#e8c48a" strokeWidth="4.5" strokeLinecap="round" />

        {/* Le corps : orbe vernie, cœur d'énergie, runes qui tournent. */}
        <circle cx="100" cy="128" r="70" fill={`url(#${id}-body)`} strokeOpacity="0.55" strokeWidth="2" filter={`url(#${id}-glow)`} style={{ stroke: 'var(--heat)' }} />
        <circle cx="100" cy="128" r="54" fill={`url(#${id}-core)`} />
        <g data-bomb-fx style={{ transformOrigin: '100px 128px', animation: 'seal-spin 18s linear infinite' }}>
          <circle cx="100" cy="128" r="60" fill="none" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="6 4 1 4" style={{ stroke: 'var(--heat)' }} />
        </g>
        {/* Clignotement : un voile qui flashe de plus en plus vite. */}
        <circle data-bomb-fx cx="100" cy="128" r="70" style={{ fill: 'var(--heat)', animation: burning ? 'bomb-blink var(--pulse) linear infinite' : 'none', opacity: 0 }} />
        <ellipse cx="74" cy="98" rx="20" ry="11" fill="#ffffff" fillOpacity="0.28" transform="rotate(-28 74 98)" />

        {/* Étincelle au bout de la mèche, et ses braises. */}
        <g ref={sparkRef} style={{ opacity: 0, transition: 'opacity 200ms' }}>
          <circle r="9" fillOpacity="0.35" style={{ fill: 'var(--heat)' }} />
          <g data-bomb-fx style={{ animation: 'bomb-flicker 0.18s linear infinite' }}>
            <path d="M0 -9 L2 -2 L9 0 L2 2 L0 9 L-2 2 L-9 0 L-2 -2 Z" fill="#fff6c8" />
          </g>
          {[0, 1, 2, 3].map((index) => (
            <circle
              key={index}
              data-bomb-fx
              r="1.6"
              fill="#ffd36b"
              style={{
                animation: `bomb-ember ${0.5 + index * 0.13}s ease-out ${index * 0.11}s infinite`,
                ['--ember-x' as string]: `${[10, -8, 14, -12][index]}px`,
                ['--ember-y' as string]: `${[-14, -10, -4, -16][index]}px`,
              }}
            />
          ))}
        </g>
      </svg>

      {/* La syllabe, au cœur de l'orbe. */}
      {syllable && (
        <span
          className="absolute font-display leading-none font-bold tracking-[0.06em] text-white uppercase"
          // Taille proportionnelle à la bombe (grande au jeu, petite sur l'artefact du hub).
          style={{ top: '57%', transform: 'translateY(-50%)', fontSize: Math.round(size * (long ? 0.168 : 0.2)), textShadow: '0 0 18px var(--heat), 0 2px 0 rgba(0,0,0,0.45)' }}
        >
          {syllable}
        </span>
      )}
    </div>
  )
}
