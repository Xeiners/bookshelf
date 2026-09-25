import { useRef } from 'react'
import { WandSparkles } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { CardBack, CARD_RATIO } from './TarotCard3D'

interface IntroDeckProps {
  width: number
  shuffling: boolean
  onDraw: () => void
}

/** Position de repos des trois dos empilés : un paquet légèrement éventé. */
const FAN = [
  { x: -18, rotation: -9 },
  { x: 0, rotation: 0 },
  { x: 18, rotation: 9 },
]

/**
 * Avant le tirage : le paquet flotte, un appel à l'action néo-brutaliste.
 * Pendant l'appel à l'API, les cartes se mélangent (elles passent l'une
 * derrière l'autre) — le temps de réponse devient un moment du rituel.
 */
export function IntroDeck({ width, shuffling, onDraw }: IntroDeckProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const height = Math.round(width * CARD_RATIO)

  useGSAP(
    () => {
      const cards = gsap.utils.toArray<HTMLElement>('[data-intro-card]')
      cards.forEach((card, index) => gsap.set(card, FAN[index] ?? {}))
      gsap.from('[data-intro-line]', { y: 18, autoAlpha: 0, duration: 0.7, stagger: 0.08, ease: EASE.swift })
      gsap.from(cards, { y: 60, autoAlpha: 0, duration: 0.9, stagger: 0.1, ease: EASE.snap })
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.to('[data-intro-stack]', { y: -8, duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1 })
      }
    },
    { scope: rootRef },
  )

  // Mélange : les cartes s'écartent et se croisent en boucle tant que l'API répond.
  useGSAP(
    () => {
      if (!shuffling) return
      const cards = gsap.utils.toArray<HTMLElement>('[data-intro-card]')
      gsap
        .timeline({ repeat: -1 })
        .to(cards, { x: (index) => (index - 1) * width * 0.55, rotation: (index) => (index - 1) * 14, duration: 0.28, ease: 'power2.out' })
        .to(cards, { x: (index) => (1 - index) * width * 0.2, rotation: 0, zIndex: (index) => 3 - index, duration: 0.28, ease: 'power2.inOut' })
        .to(cards, { x: (index) => FAN[index]?.x ?? 0, rotation: (index) => FAN[index]?.rotation ?? 0, duration: 0.3, ease: 'back.out(1.6)' })
    },
    { dependencies: [shuffling], scope: rootRef, revertOnUpdate: true },
  )

  return (
    <div ref={rootRef} className="flex flex-col items-center pt-10 text-center md:pt-12">
      <div data-intro-stack className="relative" style={{ width: width + 60, height: height + 20 }}>
        {FAN.map((_, index) => (
          <div
            key={index}
            data-intro-card
            className="absolute top-0 left-1/2 rounded-[14px] shadow-[0_30px_60px_-20px_rgb(0_0_0/0.9)]"
            style={{ width, height, marginLeft: -width / 2 }}
          >
            <CardBack index={index} />
          </div>
        ))}
      </div>

      <p data-intro-line className="mt-10 text-[10px] tracking-[0.32em] text-gold uppercase">
        {t.oracle.introEyebrow}
      </p>
      <h2 data-intro-line className="mt-2 font-display text-[2.2rem] leading-none text-cream md:text-[3rem]">
        {t.oracle.introTitle}
      </h2>
      <p data-intro-line className="mt-3 max-w-sm text-sm leading-relaxed text-cream/65">
        {t.oracle.introBody}
      </p>

      <div data-intro-line className="mt-7">
        <button
          type="button"
          onClick={onDraw}
          disabled={shuffling}
          className="inline-flex items-center gap-2.5 rounded-xl border-2 border-void bg-gold px-6 py-3.5 text-sm font-bold tracking-[0.06em] text-void uppercase shadow-[5px_5px_0_0_#f7f5f0] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_0_#f7f5f0] active:translate-y-0.5 active:shadow-[2px_2px_0_0_#f7f5f0] disabled:opacity-70"
        >
          <WandSparkles size={17} strokeWidth={2.4} />
          {shuffling ? t.oracle.shuffling : t.oracle.draw}
        </button>
      </div>

    </div>
  )
}
