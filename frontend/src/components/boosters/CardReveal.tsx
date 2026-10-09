import { useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { useT } from '../../i18n'
import { RARITY_STYLE, rarityRank, type Rarity } from '../../lib/boosters'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playFlip, playReveal, playRiser } from '../../lib/sfx'
import type { PulledCard } from '../../services/cardsApi'
import { CardBack } from '../cards/CardBack'
import { IRIDESCENT } from '../cards/cardFrames'
import { CARD_RATIO, CollectibleCard } from '../cards/CollectibleCard'
import type { Burst } from './ParticleBurst'

const RAINBOW = ['#ff5ec4', '#ffc46b', '#3fe0a0', '#4cc9f0', '#b46cff', '#ffffff']
const GOLD = ['#ffc46b', '#ffe3a8', '#ffffff', '#ff9f43']
const VIOLET = ['#d08bff', '#b46cff', '#ffffff', '#ff5ec4']

/** Mise en scène d'une révélation, de la Commune à la Mythique. */
interface Staging {
  /** Suspense avant le retournement (s). */
  suspense: number
  flip: number
  /** Tremblement d'écran (px), 0 : aucun. */
  shake: number
  burst: { colors: string[]; count: number; kind: Burst['kind'] } | null
  flash: number
}

const STAGING: Record<Rarity, Staging> = {
  COMMON: { suspense: 0, flip: 0.55, shake: 0, burst: null, flash: 0.75 },
  RARE: { suspense: 0, flip: 0.6, shake: 0, burst: { colors: ['#86b0ff', '#ffffff'], count: 26, kind: 'sparks' }, flash: 0.85 },
  EPIC: { suspense: 0.3, flip: 0.75, shake: 5, burst: { colors: VIOLET, count: 80, kind: 'sparks' }, flash: 0.9 },
  LEGENDARY: { suspense: 0.3, flip: 0.9, shake: 9, burst: { colors: GOLD, count: 130, kind: 'confetti' }, flash: 1 },
  MYTHIC: { suspense: 0.3, flip: 1.05, shake: 13, burst: { colors: RAINBOW, count: 170, kind: 'confetti' }, flash: 1 },
}

interface CardRevealProps {
  cards: PulledCard[]
  /** Colonnes, largeur d'une carte et écart (px) : cf. `revealLayout`. */
  layout: { columns: number; width: number; gap: number }
  onAllRevealed: () => void
  /** Gerbe de particules à lancer sur le canevas plein écran. */
  onBurst: (burst: Burst) => void
  /** Tremblement d'écran, en pixels. */
  onShake: (intensity: number) => void
  /** Carte déjà retournée, touchée : l'afficher en grand, avec le résumé de l'œuvre. */
  onInspect: (pulled: PulledCard) => void
  /** Contenu de la zone sous les cartes une fois tout révélé (boutons de fin). */
  footer?: ReactNode
  /** Mode « Informer » : toucher une carte la coche ou la décoche (index dans le tirage). */
  selection?: { picked: ReadonlySet<number>; toggle: (index: number) => void } | null
}

/**
 * Les cartes jaillissent du booster en arc de cercle, face cachée, et flottent
 * devant l'utilisateur. Toucher une carte la retourne (perspective 1000 px) :
 * - Commune / Rare : retournement net, flash blanc (et quelques étincelles bleues) ;
 * - Épique, Légendaire, Mythique : 300 ms de suspense (la carte se soulève et
 *   se charge), retournement, tremblement d'écran, rayon de lumière qui
 *   traverse la carte, onde de choc et explosion de particules — plus ample
 *   à chaque rang.
 */
export function CardReveal({ cards, layout, onAllRevealed, onBurst, onShake, onInspect, footer, selection }: CardRevealProps) {
  const { columns, width, gap } = layout
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState<boolean[]>(() => cards.map(() => false))
  const busy = useRef<Set<number>>(new Set())
  /** Cartes retournées, lues par les minuteurs de « Tout révéler » (l'état React y serait périmé). */
  const done = useRef<Set<number>>(new Set())
  const height = Math.round(width * CARD_RATIO)
  const { contextSafe } = useGSAP({ scope: rootRef })

  // Jaillissement en arc : du centre (l'ouverture du booster) vers la place de chaque carte.
  useGSAP(
    () => {
      const row = rowRef.current?.getBoundingClientRect()
      const nodes = gsap.utils.toArray<HTMLElement>('[data-reveal-card]')
      const center = row ? row.left + row.width / 2 : 0
      nodes.forEach((node, index) => {
        const box = node.getBoundingClientRect()
        const fromX = center - (box.left + box.width / 2)
        // Éventail par rangée : en grille 2 × 2, chaque colonne penche de son côté.
        const perRow = Math.min(columns, nodes.length)
        const tilt = ((index % perRow) - (perRow - 1) / 2) * (perRow <= 2 ? 5 : 4)
        gsap
          .timeline({ delay: index * 0.14 })
          .fromTo(node, { x: fromX, scale: 0.3, rotation: tilt * 7, autoAlpha: 0 }, { x: 0, scale: 1, rotation: tilt, autoAlpha: 1, duration: 1, ease: 'power1.out' })
          .fromTo(node, { y: 120 }, { keyframes: [{ y: -170, duration: 0.5, ease: 'power2.out' }, { y: 0, duration: 0.55, ease: 'power2.inOut' }] }, 0)
          // Puis elles flottent, chacune à son rythme, en attendant d'être retournées.
          .to(node.querySelector('[data-bob]'), { y: -7, duration: 1.5 + index * 0.2, ease: 'sine.inOut', repeat: -1, yoyo: true })
      })
    },
    { scope: rootRef },
  )

  // Enveloppe créée à l'appel, pas au rendu : aucune ref n'est lue pendant le rendu.
  const reveal = (index: number) =>
    contextSafe(() => {
      if (done.current.has(index) || busy.current.has(index)) return
      const pulled = cards[index]
      if (!pulled) return
      busy.current.add(index)
      const { rarity } = pulled.card
      const stage = STAGING[rarity]
      const tier = rarityRank(rarity)
      const card = `[data-reveal-card="${index}"]`
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

      const burstFromCard = () => {
        const box = rootRef.current?.querySelector(card)?.getBoundingClientRect()
        if (box && stage.burst) {
          onBurst({
            id: Date.now() + index,
            x: box.left + box.width / 2,
            y: box.top + box.height / 2,
            ...stage.burst,
            spread: tier >= 3 ? Math.PI * 2 : Math.PI * 1.7,
          })
        }
      }

      const finish = () => {
        busy.current.delete(index)
        done.current.add(index)
        setRevealed((current) => current.map((value, position) => value || position === index))
        if (done.current.size === cards.length) onAllRevealed()
      }

      gsap.killTweensOf(`${card} [data-bob]`)
      const timeline = gsap.timeline({ onComplete: finish })
      if (reduced) {
        timeline.set(`${card} [data-bob]`, { y: 0 }).set(`${card} [data-flip]`, { rotationY: 180, transformPerspective: 1000 })
        return
      }

      // Un seul geste continu : la carte cesse de flotter PENDANT qu'elle se prépare et tourne
      // (plus de petit saut avant le retournement), courbes sinusoïdales, retour sans rebond.
      const flipAt = stage.suspense
      const revealAt = flipAt + stage.flip * 0.5
      timeline.to(`${card} [data-bob]`, { y: 0, duration: flipAt + stage.flip * 0.5, ease: 'sine.inOut' }, 0)

      if (stage.suspense > 0) {
        // Micro-suspense : la carte se soulève, frémit et se charge de lumière ; le son monte.
        vibrate([18, 30, 18])
        playRiser(stage.suspense)
        timeline
          .to(card, { y: -16, scale: 1.07, duration: stage.suspense, ease: 'sine.out' }, 0)
          .to(`${card} [data-halo]`, { autoAlpha: 1, scale: 1.25, duration: stage.suspense, ease: 'sine.in' }, 0)
          .to(`${card} [data-flip]`, { x: 1.5, duration: 0.05, repeat: Math.max(1, Math.round(stage.suspense / 0.05) - 1), yoyo: true, ease: 'sine.inOut' }, 0)
      } else {
        playFlip()
        vibrate(10)
        // Légère élévation à mi-course : la carte « respire » en tournant, sans à-coup.
        timeline.to(card, { scale: 1.05, duration: stage.flip / 2, ease: 'sine.out', yoyo: true, repeat: 1 }, 0)
      }

      timeline
        // Perspective de 1000 px dans le transform même : pas de `preserve-3d` en amont.
        .to(`${card} [data-flip]`, { rotationY: 180, transformPerspective: 1000, x: 0, duration: stage.flip, ease: 'sine.inOut' }, flipAt)
        // Face visible (mi-course) : son, flash, onde de choc, rayon, particules, tremblement.
        .add(() => {
          playReveal(rarity)
          if (tier >= 3) vibrate([60, 40, 140])
          else if (tier === 2) vibrate(30)
          burstFromCard()
          if (stage.shake > 0) onShake(stage.shake)
        }, revealAt)
        // Le flash monte puis s'efface : jamais d'apparition brutale.
        .fromTo(`${card} [data-flash]`, { autoAlpha: 0 }, { keyframes: [{ autoAlpha: stage.flash, duration: 0.08, ease: 'sine.out' }, { autoAlpha: 0, duration: 0.5, ease: 'sine.inOut' }] }, revealAt)
      if (tier >= 1) {
        timeline.fromTo(`${card} [data-shock]`, { scale: 0.3, autoAlpha: 1 }, { scale: tier >= 3 ? 2.8 : 2.1, autoAlpha: 0, duration: 0.8, ease: 'power2.out' }, revealAt)
      }
      if (tier >= 2) {
        timeline.fromTo(`${card} [data-beam]`, { xPercent: -260, autoAlpha: 1 }, { xPercent: 260, autoAlpha: 0.2, duration: 0.7, ease: 'sine.inOut' }, revealAt + 0.05)
      }
      if (stage.suspense > 0) {
        timeline
          .to(card, { y: 0, scale: 1, duration: 0.7, ease: 'power3.out' }, revealAt + 0.1)
          .to(`${card} [data-halo]`, { scale: 1, autoAlpha: 0.7, duration: 0.7, ease: 'sine.out' }, revealAt + 0.1)
      }
    })()

  const revealAll = () => {
    cards.forEach((_, index) => window.setTimeout(() => reveal(index), index * 320))
  }

  const remaining = revealed.filter((value) => !value).length

  return (
    <div ref={rootRef} className="flex flex-col items-center gap-7">
      <div
        ref={rowRef}
        className="grid items-end justify-center"
        style={{ gridTemplateColumns: `repeat(${columns}, ${width}px)`, gap }}
      >
        {cards.map((pulled, index) => {
          const style = RARITY_STYLE[pulled.card.rarity]
          const shown = revealed[index]
          const picked = selection?.picked.has(index) ?? false
          return (
            <button
              key={`${pulled.card.id}-${index}`}
              type="button"
              data-reveal-card={index}
              // Face cachée : la retourner ; déjà retournée : son résumé (ou, pour « Informer », la cocher).
              onClick={() => (!shown ? reveal(index) : selection ? selection.toggle(index) : onInspect(pulled))}
              aria-label={shown ? (selection ? pulled.card.title : t.boosters.inspect(pulled.card.title)) : t.boosters.cardBack(index + 1)}
              aria-pressed={selection ? picked : undefined}
              className="relative rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
              style={{ width, height, willChange: 'transform' }}
            >
              {selection && (
                <span
                  aria-hidden
                  className={`pointer-events-none absolute -inset-1 z-[3] rounded-[11%/8%] transition-[box-shadow,opacity] duration-200 ${picked ? 'opacity-100' : 'opacity-0'}`}
                  style={{ boxShadow: `0 0 0 3px #fff4c8, 0 0 26px ${style.color}` }}
                >
                  <span className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full bg-[#fff4c8] text-void shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
                    <Check size={16} strokeWidth={3} />
                  </span>
                </span>
              )}
              {/* `will-change` : chaque carte a son calque ; flotter ne la repeint pas. */}
              <div
                data-bob
                className="relative h-full w-full transition-[opacity,filter] duration-200"
                style={{ willChange: 'transform', ...(selection && !picked ? { opacity: 0.55, filter: 'saturate(0.6)' } : null) }}
              >
                {/* Halo de rareté, derrière la carte. */}
                <span
                  data-halo
                  aria-hidden
                  className="pointer-events-none absolute -inset-[22%] opacity-0"
                  style={{
                    background: pulled.card.rarity === 'MYTHIC' ? IRIDESCENT : `radial-gradient(closest-side, ${style.color}, transparent 72%)`,
                    borderRadius: '40%',
                    maskImage: 'radial-gradient(closest-side, #000 35%, transparent 75%)',
                    WebkitMaskImage: 'radial-gradient(closest-side, #000 35%, transparent 75%)',
                  }}
                />
                {/* Onde de choc. */}
                <span
                  data-shock
                  aria-hidden
                  className="pointer-events-none absolute inset-0 m-auto aspect-square w-full rounded-full border-2 opacity-0"
                  style={{ borderColor: pulled.card.rarity === 'MYTHIC' ? '#ffffff' : style.color, boxShadow: `0 0 24px ${style.color}` }}
                />
                <div data-flip className="relative h-full w-full [transform-style:preserve-3d]" style={{ willChange: 'transform' }}>
                  <div className="absolute inset-0 [backface-visibility:hidden]">
                    <CardBack width={width} />
                  </div>
                  <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                    <CollectibleCard
                      card={pulled.card}
                      width={width}
                      lazy={false}
                      // Face encore cachée : pas d'effets en boucle (invisibles, mais repeints).
                      effects={shown}
                      interactive={shown}
                      gyro={shown}
                      badge={
                        shown &&
                        (pulled.isNew ? (
                          <span className="rounded-full bg-like px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-void uppercase shadow-[0_0_12px_rgba(63,224,160,0.7)]">
                            {t.boosters.isNew}
                          </span>
                        ) : (
                          <span className="rounded-full bg-void/75 px-1.5 py-0.5 text-[9px] font-semibold text-cream tabular-nums">
                            {t.boosters.copies(pulled.count)}
                          </span>
                        ))
                      }
                    />
                    {/* Flash blanc et rayon de lumière, au moment où la face apparaît. */}
                    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[9%/6.5%]">
                      <div data-flash className="absolute inset-0 bg-white opacity-0" />
                      <div
                        data-beam
                        className="absolute -inset-y-[25%] left-1/3 w-1/3 rotate-[18deg] opacity-0"
                        style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)', willChange: 'transform' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/*
        Zone de hauteur FIXE sous les cartes : l'indication et « Tout révéler »,
        puis les boutons de fin, s'y remplacent sans jamais changer sa hauteur.
        Le contenu étant centré verticalement, la moindre variation ferait
        monter et descendre toute la rangée de cartes.
      */}
      <div className="flex h-32 w-full flex-col items-center justify-start gap-3">
        {remaining > 0 ? (
          <>
            <p className="max-w-xs px-4 text-center text-xs leading-relaxed tracking-[0.2em] text-cream/60 uppercase">
              {t.boosters.tapToReveal}
            </p>
            <button
              type="button"
              onClick={revealAll}
              // Masqué mais présent : sa place reste réservée.
              className={`rounded-full border border-[#ffe39a]/30 px-4 py-2 text-xs text-[#fff4c8] hover:bg-[#ffe39a]/10 ${remaining > 1 ? '' : 'invisible'}`}
            >
              {t.boosters.revealAll}
            </button>
          </>
        ) : (
          footer
        )}
      </div>
    </div>
  )
}
