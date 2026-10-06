import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { SHAKE_BELOW_MS, heat, tickInterval, type HeatStage } from '../../lib/bomb'
import { reducedMotion } from '../../lib/dle'
import { playBombTick } from '../../lib/sfx'
import type { BombStyle } from '../../services/bombApi'

interface BombProps {
  /** Syllabe imposée, au cœur de la bombe. */
  syllable: string | null
  /** Explosion, à l'heure LOCALE (ms) ; `null` : mèche éteinte (salon en attente, partie finie). */
  endsAt: number | null
  /** Durée totale de la mèche (ms). */
  totalMs: number
  /** Apparence : orbe d'énergie, bombe chibi, parchemin explosif. */
  variant?: BombStyle
  /** Tic-tac audible (bruitages actifs, partie en cours). */
  audible?: boolean
  /** Élément secoué quand il reste moins de 5 s. */
  shakeRef?: RefObject<HTMLElement | null>
  /** Élément qui reçoit aussi la couleur de la bombe (`--heat`, `--glow`) : l'arène s'y accorde. */
  themeRef?: RefObject<HTMLElement | null>
  /** La mèche est au bout (une fois par mèche). */
  onZero?: () => void
  /** Salon : la flèche d'énergie pointe vers le joueur qui tient la bombe (degrés). */
  pointTo?: number | null
  size?: number
}

/** Mèche : courbe qui part du bouchon et s'enroule vers le haut (unités du `viewBox`). */
const FUSE_PATH = 'M100 50 C 100 30, 118 22, 132 26 S 158 30, 166 12'

/**
 * La bombe de l'Anime Bomb Party, en trois styles, une même mèche : elle crépite et raccourcit,
 * la couleur passe du bleu-violet au jaune puis au rouge incandescent, le clignotement et le
 * tic-tac accélèrent ; sous 5 s, l'écran tremble. Tout s'anime image par image en écrivant
 * directement dans le DOM — seul le visage de la bombe chibi change d'état React (3 fois par mèche).
 */
export function Bomb({ syllable, endsAt, totalMs, variant = 'orb', audible = false, shakeRef, themeRef, onZero, pointTo = null, size = 248 }: BombProps) {
  const id = useId().replace(/:/g, '')
  const rootRef = useRef<HTMLDivElement>(null)
  const fuseRef = useRef<SVGPathElement>(null)
  const sparkRef = useRef<SVGGElement>(null)
  const onZeroRef = useRef(onZero)
  const [stage, setStage] = useState<HeatStage>('calm')
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
    // Les éléments tels qu'ils sont maintenant (le nettoyage les remet d'aplomb).
    const shaken = shakeRef?.current ?? null
    const themed = themeRef?.current ?? null
    let frame = 0
    let lastTick = 0
    let fired = false
    let shownStage: HeatStage | null = null

    const paint = (ratio: number) => {
      const { color, glow, stage: next } = heat(ratio)
      for (const target of [root, themed]) {
        target?.style.setProperty('--heat', color)
        target?.style.setProperty('--glow', glow)
      }
      // Clignotement et pulsation : de ~1,4 s mèche pleine à ~0,18 s au bout.
      root.style.setProperty('--pulse', `${(0.18 + ratio * 1.22).toFixed(2)}s`)
      fuse.style.strokeDasharray = `${(length * ratio).toFixed(1)} ${length.toFixed(1)}`
      const point = fuse.getPointAtLength(length * ratio)
      spark.setAttribute('transform', `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`)
      spark.style.opacity = ratio > 0 && endsAt !== null ? '1' : '0'
      if (next !== shownStage) {
        shownStage = next
        setStage(next)
      }
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
      if (shaken) {
        if (!still && remaining > 0 && remaining < SHAKE_BELOW_MS) {
          const force = (1 - remaining / SHAKE_BELOW_MS) * 5 + 0.6
          shaken.style.transform = `translate(${((Math.random() - 0.5) * force).toFixed(1)}px, ${((Math.random() - 0.5) * force).toFixed(1)}px)`
        } else shaken.style.transform = ''
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
  }, [endsAt, totalMs, audible, shakeRef, themeRef])

  const burning = endsAt !== null
  const long = (syllable?.length ?? 0) > 2
  const blink = { fill: 'var(--heat)', animation: burning ? 'bomb-blink var(--pulse) linear infinite' : 'none', opacity: 0 } // i18n-ignore
  /** Syllabe : où et comment l'écrire, selon le style. */
  const label =
    variant === 'chibi'
      ? { top: '78%', color: '#140c26', shadow: '0 1px 0 rgba(255,255,255,0.9)', scale: long ? 0.135 : 0.16 }
      : variant === 'talisman'
        ? { top: '55%', color: '#2b0a0a', shadow: '0 1px 0 rgba(255,244,220,0.8)', scale: long ? 0.16 : 0.19 }
        : { top: '57%', color: '#ffffff', shadow: '0 0 3px rgba(0,0,0,0.9), 0 2px 0 rgba(0,0,0,0.65), 0 0 18px var(--heat)', scale: long ? 0.17 : 0.2 }

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
        style={{ inset: '8% 6% -2% 6%', background: 'radial-gradient(closest-side, var(--glow), transparent 72%)', animation: 'bomb-pulse var(--pulse) ease-in-out infinite' }}
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
          <radialGradient id={`${id}-orb`} cx="38%" cy="34%" r="70%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="16%" stopOpacity="0.95" style={{ stopColor: 'var(--heat)' }} />
            <stop offset="52%" stopColor="#2b1658" />
            <stop offset="100%" stopColor="#07040f" />
          </radialGradient>
          <radialGradient id={`${id}-core`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopOpacity="0.55" style={{ stopColor: 'var(--heat)' }} />
            <stop offset="100%" stopOpacity="0" style={{ stopColor: 'var(--heat)' }} />
          </radialGradient>
          <radialGradient id={`${id}-chibi`} cx="36%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#5b5578" />
            <stop offset="35%" stopColor="#24203a" />
            <stop offset="100%" stopColor="#07060d" />
          </radialGradient>
          <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="#fbf0d4" />
            <stop offset="100%" stopColor="#e3cc98" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {variant === 'orb' && (
          <>
            {/* Anneaux d'énergie en orbite. */}
            <g data-bomb-fx style={{ transformOrigin: '100px 128px', animation: 'seal-spin 9s linear infinite' }}>
              <ellipse cx="100" cy="128" rx="92" ry="30" fill="none" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="2 7" style={{ stroke: 'var(--heat)' }} />
            </g>
            <g data-bomb-fx style={{ transformOrigin: '100px 128px', animation: 'seal-spin 14s linear infinite reverse' }}>
              <ellipse cx="100" cy="128" rx="30" ry="90" fill="none" stroke="#b46cff" strokeOpacity="0.3" strokeWidth="1.2" strokeDasharray="1 6" transform="rotate(35 100 128)" />
            </g>
          </>
        )}

        {/* Bouchon (nœud de ficelle pour le parchemin) et mèche : brûlée en sombre, vive jusqu'à l'étincelle. */}
        {variant === 'talisman' ? (
          <circle cx="100" cy="56" r="7" fill="#7a4a24" stroke="#3b2210" strokeWidth="1.5" />
        ) : (
          <rect x="88" y="44" width="24" height="16" rx="5" fill={variant === 'chibi' ? '#8b90a6' : '#2a1c45'} strokeOpacity="0.7" strokeWidth="1.5" style={{ stroke: variant === 'chibi' ? '#c9cde0' : 'var(--heat)' }} />
        )}
        <path d={FUSE_PATH} fill="none" stroke="#3b2a1d" strokeWidth="4.5" strokeLinecap="round" strokeOpacity="0.45" />
        <path ref={fuseRef} d={FUSE_PATH} fill="none" stroke="#e8c48a" strokeWidth="4.5" strokeLinecap="round" />

        {variant === 'orb' && (
          <>
            {/* Orbe vernie, cœur d'énergie, runes qui tournent. */}
            <circle cx="100" cy="128" r="70" fill={`url(#${id}-orb)`} strokeOpacity="0.55" strokeWidth="2" filter={`url(#${id}-glow)`} style={{ stroke: 'var(--heat)' }} />
            <circle cx="100" cy="128" r="54" fill={`url(#${id}-core)`} />
            <g data-bomb-fx style={{ transformOrigin: '100px 128px', animation: 'seal-spin 18s linear infinite' }}>
              <circle cx="100" cy="128" r="60" fill="none" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="6 4 1 4" style={{ stroke: 'var(--heat)' }} />
            </g>
            <circle data-bomb-fx cx="100" cy="128" r="70" style={blink} />
            <ellipse cx="74" cy="98" rx="20" ry="11" fill="#ffffff" fillOpacity="0.28" transform="rotate(-28 74 98)" />
          </>
        )}

        {variant === 'chibi' && <ChibiBody id={id} stage={stage} blink={blink} />}

        {variant === 'talisman' && (
          <g style={{ filter: 'drop-shadow(0 0 9px var(--heat))' }}>
            <g transform="rotate(-6 100 130)">
              <rect x="56" y="60" width="88" height="142" rx="5" fill={`url(#${id}-paper)`} stroke="#8a5a2b" strokeWidth="1.5" />
              <rect x="63" y="67" width="74" height="128" rx="3" fill="none" stroke="#b3261e" strokeOpacity="0.55" strokeWidth="1.2" />
              {/* Le sceau : 爆 en grand, effacé, et le cachet rouge en bas. */}
              <text x="100" y="146" textAnchor="middle" fontSize="70" fill="#b3261e" fillOpacity="0.16" style={{ fontWeight: 700 }}>
                爆
              </text>
              <circle cx="100" cy="180" r="9" fill="#b3261e" fillOpacity="0.85" />
              <text x="100" y="184" textAnchor="middle" fontSize="10" fill="#fbf0d4" style={{ fontWeight: 700 }}>
                封
              </text>
              <path d="M70 86 H130 M70 92 H118" stroke="#2b0a0a" strokeOpacity="0.35" strokeWidth="1.4" strokeLinecap="round" />
              <rect data-bomb-fx x="56" y="60" width="88" height="142" rx="5" style={blink} />
              {/* Bords qui roussissent avec la chaleur. */}
              <rect x="56" y="60" width="88" height="142" rx="5" fill="none" strokeWidth="3" strokeOpacity="0.55" style={{ stroke: 'var(--heat)' }} />
            </g>
          </g>
        )}

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

      {/* La syllabe, au cœur de la bombe (sur l'étiquette de la chibi, à l'encre sur le parchemin). */}
      {syllable && (
        <span
          className="absolute font-sans leading-none font-black tracking-[0.04em] uppercase"
          style={{ top: label.top, transform: `translateY(-50%)${variant === 'talisman' ? ' rotate(-6deg)' : ''}`, fontSize: Math.round(size * label.scale), color: label.color, textShadow: label.shadow }}
        >
          {syllable}
        </span>
      )}
    </div>
  )
}

/**
 * La bombe chibi : noire et vernie, de grands yeux d'anime et une étiquette pour la syllabe.
 * Son visage suit la mèche : contente, puis inquiète (goutte de sueur), puis paniquée.
 */
function ChibiBody({ id, stage, blink }: { id: string; stage: HeatStage; blink: CSSProperties }) {
  const eye = (cx: number) =>
    stage === 'critical' ? (
      // Yeux fermés de panique : « > < ».
      <path d={cx < 100 ? `M${cx - 9} 110 L${cx + 6} 117 L${cx - 9} 124` : `M${cx + 9} 110 L${cx - 6} 117 L${cx + 9} 124`} fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <g>
        <ellipse cx={cx} cy="116" rx="11" ry={stage === 'warm' ? 12 : 14} fill="#ffffff" />
        <ellipse cx={cx + (stage === 'warm' ? 0 : 1)} cy={stage === 'warm' ? 119 : 118} rx="7" ry={stage === 'warm' ? 8 : 10} fill="#1b1430" />
        <circle cx={cx + 3} cy="113" r="3" fill="#ffffff" />
        <circle cx={cx - 2} cy="121" r="1.4" fill="#ffffff" fillOpacity="0.8" />
      </g>
    )
  return (
    <g>
      <circle cx="100" cy="128" r="68" fill={`url(#${id}-chibi)`} strokeWidth="2.5" style={{ stroke: 'var(--heat)', filter: 'drop-shadow(0 0 10px var(--glow))' }} />
      <ellipse cx="72" cy="96" rx="18" ry="10" fill="#ffffff" fillOpacity="0.22" transform="rotate(-30 72 96)" />
      <circle data-bomb-fx cx="100" cy="128" r="68" style={blink} />
      {/* Sourcils inquiets, puis froncés. */}
      {stage !== 'calm' && (
        <path d="M66 98 L86 104 M134 98 L114 104" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="3" strokeLinecap="round" />
      )}
      {eye(78)}
      {eye(122)}
      {/* Joues. */}
      <ellipse cx="62" cy="134" rx="8" ry="4.5" fill="#ff6fa8" fillOpacity={stage === 'critical' ? 0.8 : 0.5} />
      <ellipse cx="138" cy="134" rx="8" ry="4.5" fill="#ff6fa8" fillOpacity={stage === 'critical' ? 0.8 : 0.5} />
      {/* Bouche : sourire, vaguelette, puis cri. */}
      {stage === 'calm' && <path d="M93 134 Q100 141 107 134" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />}
      {stage === 'warm' && <path d="M92 137 Q96 133 100 137 T108 137" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />}
      {stage === 'critical' && <ellipse cx="100" cy="138" rx="6" ry="7" fill="#ff3b3b" stroke="#ffffff" strokeWidth="1.5" />}
      {/* Gouttes de sueur. */}
      {stage !== 'calm' && <path d="M150 92 q6 10 0 14 q-6 -4 0 -14z" fill="#9be8ff" fillOpacity="0.9" />}
      {stage === 'critical' && <path d="M48 100 q5 8 0 11 q-5 -3 0 -11z" fill="#9be8ff" fillOpacity="0.9" />}
      {/* L'étiquette de la syllabe. */}
      <rect x="50" y="148" width="100" height="38" rx="19" fill="#fff6e2" stroke="#140c26" strokeOpacity="0.55" strokeWidth="2.5" style={{ filter: 'drop-shadow(0 0 6px var(--glow))' }} />
    </g>
  )
}
