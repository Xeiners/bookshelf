import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'
import { RARITY_STYLE } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playFlip, playReveal } from '../../lib/sfx'
import type { TradeCard } from '../../services/tradesApi'
import { ParticleBurst, type Burst } from '../boosters/ParticleBurst'
import { CollectibleCard } from '../cards/CollectibleCard'

interface TradeSwapAnimationProps {
  given: TradeCard
  received: TradeCard
  onDone: () => void
}

/** Écart des deux cartes au repos, en largeurs de carte. */
const SPREAD = 0.62

/**
 * Échange conclu, en plein écran : les deux cartes se font face, se croisent
 * en tournoyant (un tour complet sur elles-mêmes, en 3D), puis la carte cédée
 * s'éloigne et la carte reçue vient au centre. Uniquement `transform` et
 * `opacity` (perspective dans la transformation, pas de `preserve-3d`), aucun
 * flou : la lueur est un dégradé radial immobile. Un souffle accompagne le
 * croisement ; à l'arrivée, le carillon de la rareté reçue et une gerbe
 * d'étincelles à sa couleur (canevas).
 */
export function TradeSwapAnimation({ given, received, onDone }: TradeSwapAnimationProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const [width] = useState(() => Math.round(Math.min(180, Math.max(120, window.innerWidth * 0.32))))
  const [closing, setClosing] = useState(false)
  const [burst, setBurst] = useState<Burst | null>(null)
  const color = RARITY_STYLE[received.rarity].color

  /** La carte reçue arrive au centre : carillon de sa rareté, étincelles à sa couleur. */
  const reveal = () => {
    playReveal(received.rarity)
    vibrate([14, 30, 20])
    setBurst({
      id: performance.now(),
      x: window.innerWidth / 2,
      y: window.innerHeight / 2 - 30,
      colors: [color, '#fff4c8', '#ffffff', '#ffc46b'],
      count: received.rarity === 'MYTHIC' || received.rarity === 'LEGENDARY' ? 140 : 70,
      kind: 'sparks',
      spread: Math.PI * 2,
    })
  }

  useGSAP(
    () => {
      const offset = width * SPREAD
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const timeline = gsap.timeline({ defaults: { ease: 'power2.inOut' } })
      timeline.fromTo('[data-swap-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, ease: 'none' })
      if (reduced) {
        timeline
          .set('[data-swap-given]', { autoAlpha: 0 })
          .set('[data-swap-received]', { autoAlpha: 1, scale: 1.12 })
          .set('[data-swap-glow], [data-swap-text]', { autoAlpha: 1 })
        return
      }
      const perspective = { transformPerspective: 900 }
      timeline
        // Face à face : ta carte à gauche, la leur à droite.
        .fromTo('[data-swap-given]', { ...perspective, x: -offset * 1.8, autoAlpha: 0, scale: 0.85 }, { x: -offset, autoAlpha: 1, scale: 1, duration: 0.4, ease: EASE.swift }, 0.05)
        .fromTo('[data-swap-received]', { ...perspective, x: offset * 1.8, autoAlpha: 0, scale: 0.85 }, { x: offset, autoAlpha: 1, scale: 1, duration: 0.4, ease: EASE.swift }, '<')
        // Le croisement : un tour complet chacune, l'une passe devant, l'autre derrière.
        .to('[data-swap-given]', { x: offset, y: -18, rotationY: 360, scale: 0.9, duration: 0.8 }, '+=0.2')
        .to('[data-swap-received]', { x: -offset, y: 18, rotationY: -360, scale: 1.08, zIndex: 2, duration: 0.8, onStart: () => (vibrate(10), playFlip()) }, '<')
        // La carte cédée s'en va ; la carte reçue vient au centre.
        .to('[data-swap-given]', { x: offset * 2.4, y: 0, autoAlpha: 0, scale: 0.75, duration: 0.45, ease: EASE.exit })
        .to('[data-swap-received]', { x: 0, y: 0, scale: 1.12, duration: 0.55, ease: EASE.snap, onStart: reveal }, '<')
        .fromTo('[data-swap-glow]', { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.6, ease: EASE.glide }, '<')
        .fromTo('[data-swap-text]', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: EASE.glide }, '<0.15')
    },
    { scope: rootRef },
  )

  useGSAP(
    () => {
      if (!closing) return
      gsap.to(rootRef.current, { autoAlpha: 0, duration: 0.25, ease: EASE.exit, onComplete: onDone })
    },
    { dependencies: [closing], scope: rootRef },
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setClosing(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return createPortal(
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={t.trades.swap.title} className="fixed inset-0 z-[95] flex flex-col items-center justify-center px-6">
      <div data-swap-backdrop aria-hidden className="absolute inset-0 bg-[#050507]/[0.97]" onClick={() => setClosing(true)} />
      <ParticleBurst burst={burst} />
      {/* Au-dessus du canevas des étincelles (z-[3]) : elles jaillissent derrière les cartes. */}
      <div className="pointer-events-none relative z-[4] flex items-center justify-center" style={{ width: width * 3, height: Math.round(width * 1.6) }}>
        <div
          data-swap-glow
          aria-hidden
          className="invisible absolute inset-0"
          style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${color} 45%, transparent), transparent)` }}
        />
        <div data-swap-given className="invisible absolute will-change-transform">
          <CollectibleCard card={given} width={width} effects={false} lazy={false} />
        </div>
        <div data-swap-received className="invisible absolute will-change-transform">
          <CollectibleCard card={received} width={width} lazy={false} />
        </div>
      </div>
      <div data-swap-text className="invisible relative z-[4] mt-8 flex flex-col items-center gap-1 text-center">
        <p className="font-display text-3xl text-cream">{t.trades.swap.title}</p>
        <p className="text-sm text-cream/70">
          {received.name} · {t.trades.swap.received}
        </p>
        <button
          type="button"
          onClick={() => setClosing(true)}
          className="mt-5 rounded-full bg-gold px-6 py-2.5 text-sm font-semibold text-void"
        >
          {t.trades.swap.close}
        </button>
      </div>
    </div>,
    document.body,
  )
}
