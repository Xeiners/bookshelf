import { useRef, type PointerEvent, type ReactNode, type Ref } from 'react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { CARD_NUMERALS } from './decks'

/** Proportions d'une carte de tarot. */
export const CARD_RATIO = 1.62
const GOLD = '#d9b25f'

export type CardState = 'sealed' | 'next' | 'revealed'

interface TarotCard3DProps {
  /** Position 0 → 2 : chiffre romain du dos. */
  index: number
  width: number
  /** Couleur néon de la face (ambiance, rythme ou teinte de la couverture). */
  tone: string
  state: CardState
  /**
   * Forcer un retournement sans animation. Inutile en général : une carte déjà
   * face visible à son montage (reprise d'un tirage) l'est d'office.
   */
  instant?: boolean
  /** Libellé accessible de la carte (face cachée ou scellée). */
  label: string
  onReveal?: () => void
  /** Carte déjà révélée : ouvrir le détail (la pépite, dans le résultat). */
  onOpen?: () => void
  /** Face avant. */
  children: ReactNode
  /** Enveloppe extérieure : cible des animations de distribution et du final. */
  ref?: Ref<HTMLDivElement>
}

/** Dos de carte : sceau doré (cercles, étoile à huit branches, croissant), sans aucun texte. */
export function CardBack({ index }: { index: number }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-[14px] [backface-visibility:hidden]"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% 45%, #2a1d4a 0%, #120d22 55%, #07060c 100%)',
        border: `2px solid ${GOLD}`,
      }}
    >
      <div className="absolute inset-[6px] rounded-[10px] border" style={{ borderColor: `${GOLD}66` }} />
      <div className="absolute inset-[10px] rounded-[8px] border" style={{ borderColor: `${GOLD}26` }} />

      <svg viewBox="0 0 100 162" className="absolute inset-0 h-full w-full" aria-hidden>
        <g fill="none" stroke={GOLD} strokeWidth="0.8">
          <circle cx="50" cy="81" r="30" strokeOpacity="0.55" />
          <circle cx="50" cy="81" r="22" strokeOpacity="0.8" />
          <rect x="34.5" y="65.5" width="31" height="31" strokeOpacity="0.7" />
          <rect x="34.5" y="65.5" width="31" height="31" strokeOpacity="0.7" transform="rotate(45 50 81)" />
          <circle cx="50" cy="81" r="7" strokeOpacity="0.9" />
          <line x1="50" y1="42" x2="50" y2="51" strokeOpacity="0.6" />
          <line x1="50" y1="111" x2="50" y2="120" strokeOpacity="0.6" />
          <line x1="16" y1="81" x2="20" y2="81" strokeOpacity="0.6" />
          <line x1="80" y1="81" x2="84" y2="81" strokeOpacity="0.6" />
        </g>
        {/* Croissant au cœur du sceau */}
        <path d="M52.5 76.5a5 5 0 1 0 0 9a6 6 0 1 1 0-9z" fill={GOLD} fillOpacity="0.9" />
        {/* Perles sur le cercle extérieur */}
        {Array.from({ length: 12 }, (_, bead) => {
          const angle = (bead / 12) * Math.PI * 2
          return (
            <circle key={bead} cx={50 + Math.cos(angle) * 30} cy={81 + Math.sin(angle) * 30} r="1.1" fill={GOLD} fillOpacity="0.8" />
          )
        })}
        {/* Losanges d'angle */}
        {[
          [16, 18],
          [84, 18],
          [16, 144],
          [84, 144],
        ].map(([x, y]) => (
          <path key={`${x}-${y}`} d={`M${x} ${y - 4}l3 4l-3 4l-3-4z`} fill={GOLD} fillOpacity="0.7" />
        ))}
      </svg>

      <span className="absolute inset-x-0 top-[9%] text-center font-display text-[13px] tracking-[0.3em]" style={{ color: GOLD }}>
        {CARD_NUMERALS[index]}
      </span>
      <span
        className="absolute inset-x-0 bottom-[9%] rotate-180 text-center font-display text-[13px] tracking-[0.3em]"
        style={{ color: GOLD }}
      >
        {CARD_NUMERALS[index]}
      </span>

      {/* Reflet doré qui balaie le dos au repos */}
      <span
        data-back-sheen
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-linear-to-r from-transparent via-[#f5d98a]/25 to-transparent"
      />
    </div>
  )
}

/**
 * Carte de tarot en 3D. Trois états : scellée (on ne peut pas encore la
 * retourner), « à toi » (elle pulse), révélée (face visible).
 *
 * Couches, de l'extérieur vers l'intérieur :
 *  - enveloppe (`ref`) : distribution et final, pilotés par la page ;
 *  - inclinaison : suit la souris sur ordinateur (`quickTo`) ;
 *  - pivot : `rotationY` 0 → 180 à la révélation.
 * Chaque transformation a son propre élément : aucune animation n'écrase l'autre.
 */
export function TarotCard3D({ index, width, tone, state, instant, label, onReveal, onOpen, children, ref }: TarotCard3DProps) {
  const height = Math.round(width * CARD_RATIO)
  const rootRef = useRef<HTMLDivElement>(null)
  const tiltRef = useRef<HTMLDivElement>(null)
  const flipRef = useRef<HTMLDivElement>(null)
  const tilt = useRef<{ x: gsap.QuickToFunc; y: gsap.QuickToFunc } | null>(null)

  const revealed = state === 'revealed'
  /** Face visible dès le montage : reprise, pas de retournement à jouer. */
  const revealedAtMount = useRef(revealed)

  // Mise en place : pivot, inclinaison, reflet du dos.
  useGSAP(
    () => {
      tilt.current = {
        x: gsap.quickTo(tiltRef.current, 'rotationX', { duration: 0.5, ease: 'power3.out' }),
        y: gsap.quickTo(tiltRef.current, 'rotationY', { duration: 0.5, ease: 'power3.out' }),
      }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.fromTo(
        '[data-back-sheen]',
        { xPercent: 0 },
        { xPercent: 520, duration: 1.6, ease: 'power2.inOut', repeat: -1, repeatDelay: 3.5 + index * 0.9, delay: 1 + index * 0.4 },
      )
    },
    { scope: rootRef },
  )

  // « À toi » : un anneau pulse autour de la carte à retourner.
  useGSAP(
    () => {
      if (state !== 'next') return
      gsap.fromTo(
        '[data-next-ring]',
        { autoAlpha: 0.25, scale: 1 },
        { autoAlpha: 0.9, scale: 1.035, duration: 1.1, ease: 'sine.inOut', yoyo: true, repeat: -1 },
      )
    },
    { dependencies: [state], scope: rootRef, revertOnUpdate: true },
  )

  // Révélation : soulèvement, pivot 3D, éclair sur la face, halo de la couleur de la carte.
  useGSAP(
    () => {
      if (!revealed) return

      /*
       * Déjà face visible au montage : placement direct, rejouable sans risque.
       * (Pas de garde « déjà fait » : sous StrictMode, le contexte GSAP est
       * annulé puis l'effet relancé — une garde laisserait la carte de dos.)
       * L'effet ne dépendant que de `revealed`, l'animation ne se joue qu'au
       * vrai passage face cachée → face visible.
       */
      if (instant || revealedAtMount.current) {
        gsap.set(flipRef.current, { rotationY: 180 })
        gsap.set('[data-card-halo]', { autoAlpha: 0.55, scale: 1 })
        return
      }

      gsap
        .timeline()
        .to(flipRef.current, { z: 70, duration: 0.28, ease: 'power2.out' })
        .to(flipRef.current, { rotationY: 180, duration: 0.95, ease: 'power3.inOut' }, 0.12)
        .to(flipRef.current, { z: 0, duration: 0.6, ease: EASE.spring }, 0.9)
        .fromTo('[data-card-flash]', { xPercent: -130, autoAlpha: 1 }, { xPercent: 230, duration: 0.8, ease: 'power2.inOut' }, 0.62)
        .fromTo(
          '[data-card-halo]',
          { autoAlpha: 0, scale: 0.55 },
          { autoAlpha: 1, scale: 1.15, duration: 0.55, ease: 'power2.out' },
          0.6,
        )
        .to('[data-card-halo]', { autoAlpha: 0.55, scale: 1, duration: 1.2, ease: 'sine.out' })
    },
    { dependencies: [revealed], scope: rootRef },
  )

  const interactive = state === 'next' && Boolean(onReveal)
  const openable = revealed && Boolean(onOpen)

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'touch' || state === 'sealed') return
    const box = event.currentTarget.getBoundingClientRect()
    const dx = (event.clientX - box.left) / box.width - 0.5
    const dy = (event.clientY - box.top) / box.height - 0.5
    tilt.current?.y(dx * 22)
    tilt.current?.x(-dy * 18)
  }

  const resetTilt = () => {
    tilt.current?.x(0)
    tilt.current?.y(0)
  }

  // Tactile : la carte s'enfonce et vibre sous le doigt.
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!interactive) return
    if (event.pointerType === 'touch') vibrate(8)
    gsap.to(tiltRef.current, { scale: 0.95, duration: 0.15, ease: 'power2.out', overwrite: 'auto' })
  }
  const onPointerUp = () => {
    gsap.to(tiltRef.current, { scale: 1, duration: 0.55, ease: EASE.spring, overwrite: 'auto' })
  }

  return (
    <div ref={ref} className="relative shrink-0" style={{ width, height }}>
      <div ref={rootRef} className="relative h-full w-full">
        {/* Halo néon : s'allume à la révélation */}
        <div
          data-card-halo
          aria-hidden
          className="pointer-events-none invisible absolute -inset-[30%] opacity-0"
          style={{ background: `radial-gradient(closest-side, ${tone}, transparent)` }}
        />

        {state === 'next' && (
          <div
            data-next-ring
            aria-hidden
            className="pointer-events-none absolute -inset-2 rounded-[18px] border-2"
            style={{ borderColor: GOLD, boxShadow: `0 0 24px ${GOLD}55` }}
          />
        )}

        <button
          type="button"
          aria-label={label}
          aria-disabled={!interactive}
          disabled={state === 'sealed'}
          onClick={() => {
            if (openable) {
              onOpen?.()
              return
            }
            if (!interactive) return
            vibrate([10, 40, 16])
            resetTilt()
            onReveal?.()
          }}
          onPointerMove={onPointerMove}
          onPointerLeave={() => {
            resetTilt()
            onPointerUp()
          }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={`absolute inset-0 [perspective:1000px] ${interactive || openable ? 'cursor-pointer' : 'cursor-default'} ${
            state === 'sealed' ? 'opacity-45 saturate-50' : ''
          } transition-[opacity,filter] duration-500`}
        >
          <div ref={tiltRef} className="relative h-full w-full [transform-style:preserve-3d] will-change-transform">
            <div ref={flipRef} className="absolute inset-0 [transform-style:preserve-3d]">
              <CardBack index={index} />

              {/* Face : néo-brutalisme sombre, bord franc et ombre dure à la couleur de la carte */}
              <div
                className="absolute inset-0 overflow-hidden rounded-[14px] bg-[#0c0b11] text-left [backface-visibility:hidden]"
                style={{
                  transform: 'rotateY(180deg)',
                  border: `2px solid ${tone}`,
                  boxShadow: `5px 5px 0 0 ${tone}`,
                }}
              >
                {children}
                <span
                  data-card-flash
                  aria-hidden
                  className="pointer-events-none invisible absolute inset-y-0 left-0 w-2/3 -skew-x-12 bg-linear-to-r from-transparent via-white/70 to-transparent opacity-0"
                />
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}
