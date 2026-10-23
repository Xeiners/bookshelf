import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { useT } from '../../i18n'
import { RARITY_STYLE, rarityRank, type CardOrigin, type Rarity } from '../../lib/boosters'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playDeal, playFlip, playHlSlide, playReveal, playRiser } from '../../lib/sfx'
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

/** Intensité des rayons derrière la carte révélée, par rang. */
const RAYS = [0.18, 0.4, 0.7, 0.9, 1]

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
  /** Où chaque carte est sortie du booster ; le paquet se forme à partir de là. */
  origins?: CardOrigin[] | null
}

/**
 * Les cartes, sorties du booster en éventail (`origins`), descendent se ranger en paquet,
 * face cachée, au centre et agrandies. La carte du dessus se retourne d'elle-même ; on la
 * glisse à gauche ou à droite (ou on la touche) et elle repart derrière le paquet, la
 * suivante se retourne… Un geste pendant un retournement ou un lancer n'est jamais perdu.
 * Sous le paquet : le nom de la rareté et des pastilles de progression ; derrière la carte,
 * des rayons à sa couleur. Toutes vues, le paquet s'étale en récapitulatif, chaque carte
 * dans sa case. Mise en scène d'un retournement :
 * - Commune / Rare : retournement net, flash blanc (et quelques étincelles bleues) ;
 * - Épique, Légendaire, Mythique : 300 ms de suspense (la carte se soulève et
 *   se charge), retournement, tremblement d'écran, rayon de lumière qui
 *   traverse la carte, onde de choc et explosion de particules — plus ample
 *   à chaque rang.
 */
export function CardReveal({ cards, layout, onAllRevealed, onBurst, onShake, onInspect, footer, selection, origins = null }: CardRevealProps) {
  const { columns, width, gap } = layout
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState<boolean[]>(() => cards.map(() => false))
  /** Paquet (une carte à la fois, glissée derrière) puis récapitulatif étalé. */
  const [phase, setPhase] = useState<'deck' | 'recap'>('deck')
  const phaseRef = useRef<'deck' | 'recap'>('deck')
  /** Ordre de la pile, dessus d'abord : une carte vue repart tout au fond. */
  const order = useRef<number[]>(cards.map((_, index) => index))
  /** Cartes déjà glissées derrière le paquet. */
  const passed = useRef(0)
  const [seen, setSeen] = useState(0)
  /** Une carte part derrière : pas de nouveau geste avant qu'elle soit posée. */
  const moving = useRef(false)
  /** Geste en cours ; `held` : il tient la carte du dessus (sinon : un toucher pendant un lancer). */
  const drag = useRef<{ id: number; x: number; dx: number; t: number; velocity: number; held: boolean } | null>(null)
  /** Retournements en cours (un geste les presse un peu). */
  const flips = useRef<Map<number, gsap.core.Timeline>>(new Map())
  /** Gestes reçus pendant un retournement ou un lancer : autant de cartes passeront dès que possible. */
  const queued = useRef<{ direction: 1 | -1; count: number }>({ direction: 1, count: 0 })
  /** Dernière carte révélée : son nom de rareté et la couleur des rayons. */
  const [spot, setSpot] = useState<number | null>(null)
  const busy = useRef<Set<number>>(new Set())
  /** Cartes retournées, lues par les minuteurs de « Tout révéler » (l'état React y serait périmé). */
  const done = useRef<Set<number>>(new Set())
  const height = Math.round(width * CARD_RATIO)
  const { contextSafe } = useGSAP({ scope: rootRef })

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
        flips.current.delete(index)
        done.current.add(index)
        setRevealed((current) => current.map((value, position) => value || position === index))
        // Touchée (ou glissée) pendant qu'elle se retournait : elle passe aussitôt.
        if (queued.current.count > 0 && order.current[0] === index) {
          queued.current.count -= 1
          next(queued.current.direction)
        }
      }

      gsap.killTweensOf(`${card} [data-bob]`)
      // La carte compte comme vue dès qu'elle est retournée, sans attendre la fin des reflets.
      const timeline = gsap.timeline({ onComplete: reduced ? finish : undefined })
      flips.current.set(index, timeline)
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
          setSpot(index)
          // Centrés sur le paquet (la carte, elle, peut encore être en train d'y monter).
          const box = rowRef.current?.getBoundingClientRect()
          if (box) gsap.set('[data-rays]', { left: box.left + box.width / 2, top: box.top + box.height / 2 })
          // Rayons de lumière derrière la carte, à la couleur (et à la mesure) de sa rareté.
          gsap.fromTo('[data-rays]', { autoAlpha: 0, scale: 0.55 }, { autoAlpha: RAYS[tier] ?? 0.2, scale: 1, duration: 0.55, ease: 'power3.out', overwrite: 'auto' })
        }, revealAt)
        // Le flash monte puis s'efface : jamais d'apparition brutale.
        .fromTo(
          `${card} [data-flash]`,
          { autoAlpha: 0 },
          {
            keyframes: [
              { autoAlpha: stage.flash, duration: 0.08, ease: 'sine.out' },
              { autoAlpha: 0, duration: 0.5, ease: 'sine.inOut' },
            ],
          },
          revealAt,
        )
      if (tier >= 1) {
        timeline.fromTo(`${card} [data-shock]`, { scale: 0.3, autoAlpha: 1 }, { scale: tier >= 3 ? 2.8 : 2.1, autoAlpha: 0, duration: 0.8, ease: 'power2.out' }, revealAt)
      }
      // Un reflet balaie chaque carte (discret pour les petites).
      timeline.fromTo(
        `${card} [data-beam]`,
        { xPercent: -260, autoAlpha: tier >= 2 ? 1 : 0.45 },
        { xPercent: 260, autoAlpha: 0.2, duration: 0.55, ease: 'sine.inOut' },
        revealAt + 0.05,
      )
      if (tier >= 1 && stage.suspense === 0) {
        // Liseré de lumière autour des Rares.
        timeline.fromTo(`${card} [data-halo]`, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 0.45, scale: 1, duration: 0.5, ease: 'sine.out' }, revealAt)
      }
      if (stage.suspense > 0) {
        timeline
          .to(card, { y: 0, scale: 1, duration: 0.7, ease: 'power3.out' }, revealAt + 0.1)
          .to(`${card} [data-halo]`, { scale: 1, autoAlpha: 0.7, duration: 0.7, ease: 'sine.out' }, revealAt + 0.1)
      }
      timeline.add(finish, flipAt + stage.flip)
    })()

  const slotOf = (index: number) => rootRef.current?.querySelector<HTMLElement>(`[data-slot="${index}"]`) ?? null

  /**
   * Place d'une carte dans le paquet, au centre de la grille, agrandie. `position` 0 :
   * le dessus ; derrière, chaque carte dépasse un peu vers le haut, plus petite et penchée.
   * Les décalages partent de la case de la carte (offsets : sans les transformations).
   */
  const place = (position: number, index: number) => {
    const row = rowRef.current
    const slot = slotOf(index)
    if (!row || !slot) return { x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }
    const scale = Math.max(1, Math.min(1.75, (Math.min(window.innerWidth, 480) - 72) / width, (row.offsetHeight * 1.15) / height))
    return {
      x: row.offsetWidth / 2 - (slot.offsetLeft + width / 2) + position * 3,
      y: row.offsetHeight / 2 - (slot.offsetTop + height / 2) - position * 18,
      scale: scale * (1 - position * 0.05),
      rotation: position === 0 ? 0 : (index % 2 ? 1 : -1) * (2 + position * 1.5),
      zIndex: 50 - position,
    }
  }

  /** Inclinaison de chaque carte dans le récapitulatif (éventail par rangée). */
  const tiltOf = (index: number) => {
    const perRow = Math.min(columns, cards.length)
    return ((index % perRow) - (perRow - 1) / 2) * (perRow <= 2 ? 5 : 4)
  }

  const revealTop = () => {
    const top = order.current[0]
    if (top !== undefined && !done.current.has(top)) reveal(top)
  }

  /** Toutes vues : le paquet s'étale et chaque carte rejoint sa case, puis flotte. */
  const recap = () =>
    contextSafe(() => {
      if (phaseRef.current === 'recap') return
      phaseRef.current = 'recap'
      setPhase('recap')
      const slots = cards.map((_, index) => slotOf(index)).filter((slot): slot is HTMLElement => slot !== null)
      playHlSlide()
      vibrate([10, 30, 10])
      gsap
        .timeline({
          onComplete: () => {
            onAllRevealed()
            slots.forEach((slot, index) => gsap.to(slot.querySelector('[data-bob]'), { y: -7, duration: 1.5 + index * 0.2, ease: 'sine.inOut', repeat: -1, yoyo: true }))
          },
        })
        .to(slots, { x: 0, y: 0, scale: 1, rotation: (index: number) => tiltOf(index), duration: 0.75, ease: 'back.out(1.3)', stagger: 0.09 })
        .set(slots, { zIndex: 1 })
    })()

  /** Un geste de plus en attente (jamais plus que de cartes restant à passer). */
  const enqueue = (direction: 1 | -1) => {
    queued.current.direction = direction
    queued.current.count = Math.min(queued.current.count + 1, cards.length - passed.current)
  }

  /** Carte du dessus vue : elle file sur le côté puis repart derrière le paquet. `false` : pas encore. */
  const next = (direction: 1 | -1): boolean => {
    const top = order.current[0]
    if (phaseRef.current !== 'deck' || top === undefined) return false
    if (moving.current) {
      // Un geste pendant le lancer est gardé pour la carte suivante.
      enqueue(direction)
      return true
    }
    if (!done.current.has(top)) {
      // Pas besoin d'attendre la fin du retournement : la carte passera juste après.
      if (!busy.current.has(top)) return false
      enqueue(direction)
      // Le geste presse un peu le retournement, sans le brusquer.
      flips.current.get(top)?.timeScale(1.3)
      return true
    }
    pass(top, direction)
    return true
  }

  /**
   * La carte est lancée sur le côté (en arc) et revient au fond du paquet, le paquet
   * avance d'un même mouvement continu, et la suivante se retourne dès qu'il est en place.
   */
  const pass = (top: number, direction: 1 | -1) =>
    contextSafe(() => {
      moving.current = true
      const slot = slotOf(top)
      const rest = order.current.slice(1)
      order.current = [...rest, top]
      passed.current += 1
      setSeen(passed.current)
      const last = passed.current >= cards.length
      playDeal(passed.current)
      vibrate(8)
      const back = place(cards.length - 1, top)
      setSpot(null)
      gsap.to('[data-rays]', { autoAlpha: 0, scale: 0.8, duration: 0.18, ease: 'power1.in', overwrite: 'auto' })
      gsap.to(slot?.querySelector('[data-halo]') ?? null, { autoAlpha: 0, duration: 0.2 })
      const timeline = gsap.timeline({
        onComplete: () => {
          if (!last) return
          moving.current = false
          recap()
        },
      })
      timeline
        .to(slot, {
          x: `+=${direction * Math.min(380, window.innerWidth * 0.72)}`,
          y: '-=30',
          rotation: direction * 24,
          duration: 0.4,
          ease: 'sine.in',
          overwrite: 'auto',
        })
        .set(slot, { zIndex: back.zIndex })
        .to(slot, { ...back, duration: 0.6, ease: 'power3.out' })
      rest.forEach((index, position) => timeline.to(slotOf(index), { ...place(position, index), duration: 0.6, ease: 'power2.inOut', overwrite: 'auto' }, 0.2))
      if (!last)
        timeline.add(() => {
          moving.current = false
          revealTop()
          // Geste déjà reçu pour celle-ci : son retournement file.
          const upcoming = order.current[0]
          if (queued.current.count > 0 && upcoming !== undefined) flips.current.get(upcoming)?.timeScale(1.3)
        }, 0.8)
    })()

  /** « Passer » : tout se retourne d'un coup et le récapitulatif s'affiche. */
  const skip = () => {
    if (phaseRef.current !== 'deck' || moving.current) return
    queued.current.count = 0
    flips.current.forEach((timeline) => timeline.progress(1))
    gsap.to('[data-rays]', { autoAlpha: 0, duration: 0.25 })
    cards.forEach((_, index) => {
      if (done.current.has(index) || busy.current.has(index)) return
      done.current.add(index)
      gsap.set(slotOf(index)?.querySelector('[data-flip]') ?? null, { rotationY: 180, transformPerspective: 1000 })
    })
    playFlip()
    setRevealed(cards.map(() => true))
    recap()
  }

  // Le paquet sort du booster, de la carte du dessous à celle du dessus ; la première se retourne aussitôt.
  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const timeline = gsap.timeline({ onComplete: revealTop })
      cards.forEach((_, index) => {
        const target = place(index, index)
        const slot = slotOf(index)
        if (reduced) timeline.set(slot, target, 0)
        else if (origins?.[index] && slot) {
          // Chaque carte part de là où elle est sortie du booster (même dos, même
          // taille, même inclinaison) et descend se ranger dans le paquet.
          const origin = origins[index]
          const box = slot.getBoundingClientRect()
          timeline.fromTo(
            slot,
            {
              x: origin.x - (box.left + box.width / 2),
              y: origin.y - (box.top + box.height / 2),
              scale: origin.width / width,
              rotation: origin.rotation,
              zIndex: target.zIndex,
              autoAlpha: 1,
            },
            { ...target, duration: 1, ease: 'power3.inOut' },
            (cards.length - 1 - index) * 0.1,
          )
        }
        else
          timeline.fromTo(
            slot,
            { ...target, y: target.y + 260, autoAlpha: 0 },
            { ...target, autoAlpha: 1, duration: 0.65, ease: 'back.out(1.3)' },
            (cards.length - 1 - index) * 0.08,
          )
      })
      if (!reduced && !origins) timeline.add(() => playDeal(0), 0)
    },
    { scope: rootRef },
  )

  // Clavier : les flèches font passer la carte du dessus.
  useEffect(() => {
    if (phase !== 'deck') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Glisser la carte du dessus : elle suit le doigt ; assez loin (ou un simple toucher), elle passe.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (phaseRef.current !== 'deck') return
    const held = !moving.current && order.current[0] === index
    // Un geste sur une carte en plein lancer compte quand même (pour la suivante).
    event.currentTarget.setPointerCapture(event.pointerId)
    // La carte peut encore être en train de monter ; le doigt la reprend.
    if (held) gsap.killTweensOf(event.currentTarget, 'x,rotation')
    drag.current = { id: event.pointerId, x: event.clientX, dx: 0, t: event.timeStamp, velocity: 0, held }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const dx = event.clientX - current.x
    const now = event.timeStamp
    // Vitesse du geste (px/ms), lissée : un lancer vif suffit, même court.
    current.velocity = current.velocity * 0.6 + ((dx - current.dx) / Math.max(1, now - current.t)) * 0.4
    current.dx = dx
    current.t = now
    if (current.held) gsap.set(event.currentTarget, { x: place(0, index).x + current.dx, rotation: current.dx * 0.06 })
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    drag.current = null
    const flick = Math.abs(current.velocity) > 0.45 && Math.abs(current.dx) > 18
    const passes = (Math.abs(current.dx) > 60 || Math.abs(current.dx) < 6 || flick) && next(current.dx < 0 ? -1 : 1)
    if (!passes && current.held) gsap.to(event.currentTarget, { ...place(0, index), duration: 0.4, ease: 'back.out(2)' })
  }

  return (
    <div ref={rootRef} className="flex flex-col items-center gap-7">
      {phase === 'deck' && <Rays color={spot === null ? null : (cards[spot]?.card.rarity ?? null)} />}
      <div ref={rowRef} className="relative grid items-end justify-center" style={{ gridTemplateColumns: `repeat(${columns}, ${width}px)`, gap }}>
        {cards.map((pulled, index) => {
          const style = RARITY_STYLE[pulled.card.rarity]
          const shown = revealed[index]
          const picked = selection?.picked.has(index) ?? false
          return (
            <div
              key={`${pulled.card.id}-${index}`}
              data-slot={index}
              className="relative"
              style={{ width, height, touchAction: phase === 'deck' ? 'none' : undefined, willChange: 'transform' }}
              onPointerDown={(event) => onPointerDown(event, index)}
              onPointerMove={(event) => onPointerMove(event, index)}
              onPointerUp={(event) => onPointerUp(event, index)}
              onPointerCancel={(event) => onPointerUp(event, index)}
            >
              <button
                type="button"
                data-reveal-card={index}
                // Paquet : seul le clavier passe la carte (le doigt glisse) ; récapitulatif : le résumé
                // (ou, pour « Informer », la cocher). Une carte encore cachée se retourne.
                onClick={(event) =>
                  phase === 'deck' ? (event.detail === 0 ? next(1) : undefined) : !shown ? reveal(index) : selection ? selection.toggle(index) : onInspect(pulled)
                }
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
                            <span className="rounded-full bg-void/75 px-1.5 py-0.5 text-[9px] font-semibold text-cream tabular-nums">{t.boosters.copies(pulled.count)}</span>
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
            </div>
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
        {phase === 'deck' ? (
          <>
            <RarityTitle pulled={spot === null ? null : (cards[spot] ?? null)} index={spot} />
            <div className="flex items-center gap-1.5" aria-label={t.boosters.deck.counter(Math.min(seen + 1, cards.length), cards.length)} role="img">
              {cards.map((pulled, index) => (
                <span
                  key={index}
                  aria-hidden
                  className="h-1.5 rounded-full transition-[width,background-color,box-shadow] duration-300"
                  style={{
                    width: index === Math.min(seen, cards.length - 1) ? 22 : 8,
                    background: revealed[index] ? RARITY_STYLE[pulled.card.rarity].color : 'rgba(255,255,255,0.18)',
                    boxShadow: revealed[index] && rarityRank(pulled.card.rarity) >= 2 ? `0 0 10px ${RARITY_STYLE[pulled.card.rarity].color}` : undefined,
                  }}
                />
              ))}
            </div>
            <button type="button" onClick={skip} className="rounded-full border border-[#ffe39a]/25 px-4 py-1.5 text-[11px] tracking-[0.12em] text-[#fff4c8]/80 uppercase hover:bg-[#ffe39a]/10">
              {t.boosters.deck.skip}
            </button>
          </>
        ) : (
          footer
        )}
      </div>
    </div>
  )
}

/**
 * Rayons de lumière derrière la carte révélée : un éventail qui tourne lentement, à la
 * couleur de sa rareté (irisé pour la Mythique). L'opacité est animée par la révélation.
 */
function Rays({ color }: { color: Rarity | null }) {
  const tint = color ? RARITY_STYLE[color].color : '#ffffff'
  const mythic = color === 'MYTHIC'
  const mask = 'radial-gradient(closest-side, #000 8%, rgba(0,0,0,0.5) 40%, transparent 72%)'
  return (
    // Calque fixe, rogné : les rayons débordent largement sans jamais faire défiler la page.
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        data-rays
        className="absolute top-[45%] left-1/2 aspect-square w-[min(150vw,980px)] -translate-x-1/2 -translate-y-1/2 opacity-0"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        <div
          className="absolute inset-0 rounded-full motion-safe:animate-[spin_26s_linear_infinite]"
          style={{
            background: mythic
              ? 'repeating-conic-gradient(from 0deg, rgba(255,255,255,0.9) 0deg 5deg, transparent 5deg 15deg), conic-gradient(from 0deg, #ff5ec4, #ffc46b, #3fe0a0, #4cc9f0, #b46cff, #ff5ec4)'
              : `repeating-conic-gradient(from 0deg, ${tint} 0deg 5deg, transparent 5deg 15deg)`,
            backgroundBlendMode: mythic ? 'multiply' : undefined,
          }}
        />
        <div className="absolute inset-[30%] rounded-full blur-2xl" style={{ background: `radial-gradient(closest-side, ${tint}, transparent)` }} />
      </div>
    </div>
  )
}

/**
 * Nom de la rareté de la carte qui vient d'apparaître, avec « Nouvelle » s'il y a lieu ; avant la
 * première, l'indication du geste.
 */
function RarityTitle({ pulled, index }: { pulled: PulledCard | null; index: number | null }) {
  const t = useT()
  const ref = useRef<HTMLParagraphElement>(null)
  useGSAP(
    () => {
      if (!pulled || !ref.current) return
      gsap.fromTo(ref.current, { autoAlpha: 0, y: 10, letterSpacing: '0.6em' }, { autoAlpha: 1, y: 0, letterSpacing: '0.28em', duration: 0.45, ease: 'power3.out' })
    },
    { dependencies: [index] },
  )
  if (!pulled) return <p className="flex h-8 items-center text-xs tracking-[0.2em] text-cream/60 uppercase">{t.boosters.deck.swipe}</p>
  const { rarity } = pulled.card
  const color = RARITY_STYLE[rarity].color
  return (
    <p ref={ref} className="flex h-8 items-center gap-2.5 font-display text-xl uppercase" aria-live="polite">
      <span
        style={
          rarity === 'MYTHIC'
            ? { background: IRIDESCENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
            : { color, textShadow: rarityRank(rarity) >= 2 ? `0 0 18px ${color}` : undefined }
        }
      >
        {t.cards.rarity[rarity]}
      </span>
      {pulled.isNew && (
        <span className="rounded-full bg-like px-2 py-0.5 font-sans text-[10px] font-bold tracking-wide text-void normal-case shadow-[0_0_12px_rgba(63,224,160,0.7)]">
          {t.boosters.isNew}
        </span>
      )}
    </p>
  )
}
