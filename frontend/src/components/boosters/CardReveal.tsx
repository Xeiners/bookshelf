import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { useT } from '../../i18n'
import { RARITY_STYLE, deckOrder, rarityRank, type CardOrigin, type Rarity } from '../../lib/boosters'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playDeal, playFlip, playHeartbeat, playHlSlide, playReveal, playRiser } from '../../lib/sfx'
import type { PulledCard } from '../../services/cardsApi'
import { CardBack } from '../cards/CardBack'
import { IRIDESCENT } from '../cards/cardFrames'
import { CARD_RATIO, CollectibleCard } from '../cards/CollectibleCard'
import { FX_RINGS, RevealFx } from './RevealFx'

/** Couleurs des lettres de « Mythique », et de ses ondes de choc. */
const PRISM = ['#ff5ec4', '#ffc46b', '#3fe0a0', '#4cc9f0', '#b46cff']

/**
 * Temps minimal (ms) pendant lequel une face reste à l'écran avant qu'un geste la fasse partir,
 * par rang (Commune, Rare, Épique). Légendaire et Mythique : seulement une fois posées.
 */
const MIN_VIEW_MS = [350, 450, 600]

/** Cartes montées dans le paquet : celle du dessus et trois derrière (les autres attendent, non montées). */
const DECK_DEPTH = 4
/** Chaque carte de derrière dépasse d'autant vers le haut. */
const PEEK = 14

/** Place d'une carte dans le paquet : 0, le dessus ; derrière, un peu plus haute, plus petite et penchée. */
const deckPose = (position: number, index: number) => {
  const depth = Math.min(position, DECK_DEPTH - 1)
  return { x: depth * 3, y: -depth * PEEK, scale: 1 - depth * 0.045, rotation: depth === 0 ? 0 : (index % 2 ? 1 : -1) * (1.5 + depth * 1.2) }
}

/** Frémissement d'une carte qui se charge : des secousses de plus en plus amples. */
const jitter = (duration: number, from: number, to: number) => {
  const steps = Math.max(4, Math.round(duration / 0.045))
  return [
    ...Array.from({ length: steps }, (_, step) => ({ x: (step % 2 ? -1 : 1) * (from + ((to - from) * step) / steps), duration: duration / steps, ease: 'sine.inOut' })),
    { x: 0, duration: 0.05 },
  ]
}

/** Halo de la carte (derrière elle) : à la couleur de sa rareté, irisé pour la Mythique. */
const auraOf = (rarity: Rarity): CSSProperties =>
  rarity === 'MYTHIC'
    ? {
        background: IRIDESCENT,
        borderRadius: '50%',
        maskImage: 'radial-gradient(closest-side, #000 30%, transparent 72%)',
        WebkitMaskImage: 'radial-gradient(closest-side, #000 30%, transparent 72%)',
      }
    : { background: `radial-gradient(closest-side, ${RARITY_STYLE[rarity].color}, transparent 72%)` }

/** Laisse déborder (en haut de la zone) ou rend son défilement à la zone de contenu. */
function unclip(scroller: HTMLElement, on: boolean) {
  if (on) scroller.scrollTop = 0
  scroller.style.overflow = on ? 'visible' : ''
}

interface CardRevealProps {
  cards: PulledCard[]
  /** Grille du récapitulatif : colonnes, largeur d'une carte et écart (px), cf. `revealLayout`. */
  layout: { columns: number; width: number; gap: number }
  /** Largeur de la carte du paquet (cf. `deckCardWidth`) : la même pour 1 ou 6 boosters. */
  deckWidth: number
  onAllRevealed: () => void
  /** Carte du récapitulatif touchée : l'afficher en grand, avec le résumé de l'œuvre. */
  onInspect: (pulled: PulledCard) => void
  /** Contenu de la zone sous les cartes une fois tout révélé (boutons de fin). */
  footer?: ReactNode
  /** Mode « Informer » : toucher une carte la coche ou la décoche (index dans le tirage). */
  selection?: { picked: ReadonlySet<number>; toggle: (index: number) => void } | null
  /** Où chaque carte est sortie du booster ; le paquet se forme à partir de là. */
  origins?: CardOrigin[] | null
}

/**
 * Révélation des cartes d'un ou plusieurs boosters.
 *
 * **Paquet** : les cartes, sorties du booster en éventail (`origins`), se rangent face cachée
 * au centre, à une taille fixe (la même pour 1 ou 6 boosters). Elles passent de la plus commune à
 * la plus rare : le suspense monte jusqu'à la dernière. La carte du dessus se retourne d'elle-même ;
 * on la glisse (ou la touche) et elle s'envole, la suivante se retourne. Seules quatre cartes sont
 * montées à la fois, et seule celle du dessus a ses effets, son reflet et le gyroscope : 24 cartes
 * coûtent autant que 4.
 *
 * Le retournement (`turn`) : la carte se soulève en tournant (accélération puis décélération
 * douces), penche un peu dans le mouvement, s'assombrit de profil comme sous une vraie lumière,
 * puis se pose avec un léger rebond ; son ombre au sol s'éloigne et revient.
 *
 * Mise en scène, selon la rareté :
 * - Commune, Rare : un temps d'appel, le retournement, flash, quelques étincelles (et une onde pour la Rare) ;
 * - Épique : la carte se soulève et se charge de violet, onde de choc, gerbe, tremblement ;
 * - Légendaire : l'écran s'assombrit, la carte se charge d'or en tremblant, rayons ; puis éclair,
 *   trois ondes, rayons dorés, titre qui claque lettre à lettre ;
 * - Mythique : noir total et battements de cœur, lignes de vitesse qui convergent, la carte commence
 *   à se retourner puis retombe sur le dos (fausse alerte), l'écran s'irise ; puis éclair blanc, quatre ondes
 *   arc-en-ciel, deux secousses, rayons irisés.
 * Légendaire et Mythique n'ont pas de gerbe de particules : sur téléphone, le canevas plein écran
 * faisait ramer leur explosion.
 * Un geste ne vaut que pour la carte affichée, et seulement une fois sa face vue un instant
 * (`MIN_VIEW_MS`) ; plus tôt, il est ignoré, jamais reporté sur les suivantes. Légendaire et
 * Mythique ne partent qu'une fois posées : on ne les écourte jamais.
 *
 * **Récapitulatif** : toutes vues, chaque carte rejoint sa case de la grille.
 */
export function CardReveal({ cards, layout, deckWidth, onAllRevealed, onInspect, footer, selection, origins = null }: CardRevealProps) {
  const { columns, width, gap } = layout
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const deckHeight = Math.round(deckWidth * CARD_RATIO)
  const height = Math.round(width * CARD_RATIO)
  /** Plusieurs boosters ouverts d'un coup : récapitulatif allégé (effets des grandes seulement, pas de flottaison). */
  const many = cards.length > 8

  /** Ordre de passage (index dans le tirage), de la plus commune à la plus rare. */
  const sequence = useMemo(() => deckOrder(cards.map((pulled) => pulled.card.rarity)), [cards])
  const [phase, setPhase] = useState<'deck' | 'recap'>('deck')
  const phaseRef = useRef<'deck' | 'recap'>('deck')
  /** Cartes encore dans le paquet, le dessus d'abord. */
  const [order, setOrder] = useState(sequence)
  const orderRef = useRef(sequence)
  /** Cartes en train de s'envoler : gardées montées jusqu'à la fin de leur lancer. */
  const [leaving, setLeaving] = useState<number[]>([])
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(() => new Set())
  const revealedRef = useRef(new Set<number>())
  /** Dernière carte révélée : le nom de sa rareté sous le paquet. */
  const [spot, setSpot] = useState<number | null>(null)
  /** Dernière carte retournée et posée : elle seule réagit au doigt et au gyroscope. */
  const [settled, setSettled] = useState<number | null>(null)
  /** Retournement en cours (un seul à la fois). */
  const flipping = useRef<{ index: number; timeline: gsap.core.Timeline; tier: number } | null>(null)
  /** Une carte s'envole, le paquet avance : pas de nouveau lancer avant qu'il soit en place. */
  const moving = useRef(false)
  /** Gestes reçus pendant un retournement ou un lancer : autant de cartes passeront dès que possible. */
  /** Instant (horloge `performance.now()`) à partir duquel la carte du dessus peut partir. */
  const passableAt = useRef(Number.POSITIVE_INFINITY)
  /** Mise en scène d'une carte partie avant d'être posée : arrêtée quand la suivante commence. */
  const detached = useRef<gsap.core.Timeline | null>(null)
  const drag = useRef<{ id: number; x: number; dx: number; t: number; velocity: number; held: boolean } | null>(null)
  /** Cartes du paquet déjà posées : une nouvelle venue (au fond) entre en fondu. */
  const placed = useRef(new Set<number>())
  /** Boucles des effets (rayons qui tournent, lueurs qui se relaient), coupées quand la carte part. */
  const loops = useRef<gsap.core.Tween[]>([])
  const { contextSafe } = useGSAP({ scope: rootRef })

  // Les illustrations se chargent pendant la déchirure : aucune face blanche au retournement.
  useEffect(() => {
    for (const pulled of cards) {
      const image = new Image()
      image.decoding = 'async'
      image.src = pulled.card.imageUrl
    }
  }, [cards])

  const deckCard = (index: number) => stageRef.current?.querySelector<HTMLElement>(`[data-deck="${index}"]`) ?? null

  /* ---- Effets plein écran ------------------------------------------------------------------ */

  /** Centre les effets sur le paquet et leur donne la couleur de la carte. */
  const aimFx = (rarity: Rarity) => {
    const stage = stageRef.current?.getBoundingClientRect()
    const fx = rootRef.current?.querySelector('[data-fx]')
    if (!stage || !fx) return
    const box = fx.getBoundingClientRect()
    const x = stage.left + stage.width / 2 - box.left
    const y = stage.top + stage.height / 2 - box.top
    gsap.set(fx, { '--fx-color': RARITY_STYLE[rarity].color, '--fx-x': `${x}px`, '--fx-y': `${y}px` })
    gsap.set(rootRef.current?.querySelector('[data-fx-origin]') ?? null, { left: x, top: y })
    rootRef.current?.querySelectorAll<HTMLElement>('[data-fx-ring]').forEach((ring, index) => {
      ring.style.setProperty('--ring', rarity === 'MYTHIC' ? PRISM[index % PRISM.length]! : 'var(--fx-color)')
    })
  }

  /** Rayons qui tournent lentement (et lueurs pastel de la Mythique qui se relaient). */
  const startLoops = (mythic: boolean) =>
    contextSafe(() => {
      if (loops.current.length > 0) return
      loops.current.push(
        gsap.to('[data-fx-rays]', { rotation: '+=360', duration: 32, ease: 'none', repeat: -1 }),
        gsap.to('[data-fx-prism]', { rotation: '-=360', duration: 44, ease: 'none', repeat: -1 }),
      )
      if (mythic) {
        for (let hue = 0; hue < 3; hue += 1) {
          loops.current.push(gsap.fromTo(`[data-fx-hue="${hue}"]`, { autoAlpha: 0.15 }, { autoAlpha: 0.9, duration: 1.3, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: hue * 0.45 }))
        }
      }
    })()

  /** La carte part : tous les effets s'éteignent. */
  const fxOut = () =>
    contextSafe(() => {
      const stop = loops.current
      loops.current = []
      gsap.to(['[data-fx-dim]', '[data-fx-glow]', '[data-fx-rays]', '[data-fx-prism]', '[data-fx-zoom]', '[data-fx-hue]'], {
        autoAlpha: 0,
        duration: 0.3,
        ease: 'power1.out',
        overwrite: 'auto',
        onComplete: () => stop.forEach((tween) => tween.kill()),
      })
    })()

  /** Tremblement d'écran : quelques secousses décroissantes, en `transform` seulement. */
  const shake = (intensity: number) =>
    contextSafe(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const steps = 9
      gsap.to('[data-reveal-shake]', {
        keyframes: [
          ...Array.from({ length: steps }, (_, step) => {
            const amplitude = intensity * (1 - step / steps)
            return { x: gsap.utils.random(-amplitude, amplitude), y: gsap.utils.random(-amplitude, amplitude), duration: 0.035 }
          }),
          { x: 0, y: 0, duration: 0.06 },
        ],
        ease: 'none',
        overwrite: 'auto',
      })
    })()

  /* ---- Retournement ------------------------------------------------------------------------ */

  /**
   * Face visible : la carte compte comme vue (pastilles, titre), son de révélation. Elle reste
   * à l'écran un minimum avant de pouvoir partir (les grandes : jusqu'à ce qu'elles soient posées).
   */
  const showFace = (index: number) => {
    const pulled = cards[index]
    if (!pulled) return
    revealedRef.current.add(index)
    setRevealed(new Set(revealedRef.current))
    setSpot(index)
    playReveal(pulled.card.rarity)
    const view = MIN_VIEW_MS[rarityRank(pulled.card.rarity)]
    passableAt.current = view === undefined ? Number.POSITIVE_INFINITY : performance.now() + view
  }

  /**
   * Retournement terminé : la carte devient interactive (reflet sous le doigt, gyroscope) —
   * jamais pendant la rotation, où ce changement faisait sauter la carte.
   */
  const settle = (index: number) => {
    setSettled(index)
    flipping.current = null
    passableAt.current = Math.min(passableAt.current, performance.now())
  }

  const reveal = (index: number) =>
    contextSafe(() => {
      const pulled = cards[index]
      if (!pulled || flipping.current || revealedRef.current.has(index)) return
      detached.current?.kill()
      detached.current = null
      const { rarity } = pulled.card
      const tier = rarityRank(rarity)
      const card = `[data-deck="${index}"]`
      const lift = `${card} [data-lift]`
      const flip = `${card} [data-flip]`
      const aura = `${card} [data-aura]`
      const timeline = gsap.timeline({ onComplete: () => settle(index) })
      flipping.current = { index, timeline, tier }
      aimFx(rarity)
      // Perspective posée une fois, à plat (aucun effet visible) : jamais modifiée en cours de rotation.
      gsap.set(flip, { transformPerspective: 1100 })

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        timeline.set(flip, { rotationY: 180 }).add(() => showFace(index))
        return
      }

      /**
       * Lumière : de profil, la carte passe dans l'ombre (les deux faces s'assombrissent avec
       * l'angle), puis la face se rallume. Sans ça, la rotation se lit comme un « clac » à 90°.
       */
      const flipNode = deckCard(index)?.querySelector<HTMLElement>('[data-flip]') ?? null
      const shades = deckCard(index)?.querySelectorAll<HTMLElement>('[data-shade]') ?? []
      const shadeFlip = () => {
        if (!flipNode) return
        const angle = (Number(gsap.getProperty(flipNode, 'rotationY')) * Math.PI) / 180
        const dark = ((1 - Math.abs(Math.cos(angle))) * 0.7).toFixed(3)
        shades.forEach((shade) => (shade.style.opacity = dark))
      }

      /**
       * Le retournement : demi-tour en accélération puis décélération douces, la carte penche
       * un peu dans le mouvement, son ombre au sol s'éloigne puis revient. `lift` : elle se
       * soulève en tournant et se pose avec un léger rebond (les grandes cartes, déjà
       * soulevées par leur charge, gèrent leur hauteur elles-mêmes).
       */
      const turn = (at: number, duration: number, lift: boolean) => {
        timeline
          .to(flip, { rotationY: 180, duration, ease: 'power3.inOut', onUpdate: shadeFlip }, at)
          .to(flip, { keyframes: [{ rotation: -5, duration: duration / 2, ease: 'sine.out' }, { rotation: 0, duration: duration / 2, ease: 'sine.inOut' }] }, at)
          .to('[data-ground]', { keyframes: [{ scale: 0.82, autoAlpha: 0.35, duration: duration / 2, ease: 'sine.out' }, { scale: 1, autoAlpha: 1, duration: duration / 2 + 0.25, ease: 'sine.inOut' }] }, at)
        if (lift)
          timeline.to(
            `${card} [data-lift]`,
            { keyframes: [{ y: -26, scale: 1.08, duration: duration / 2, ease: 'power2.out' }, { y: 0, scale: 1, duration: duration / 2 + 0.3, ease: 'back.out(1.6)' }] },
            at,
          )
      }

      /** Flash blanc et reflet qui balaie la face, au moment où elle apparaît. */
      const cardFlash = (at: number, peak: number) =>
        timeline
          .fromTo(`${card} [data-flash]`, { autoAlpha: 0 }, { keyframes: [{ autoAlpha: peak, duration: 0.08, ease: 'sine.out' }, { autoAlpha: 0, duration: 0.5, ease: 'sine.inOut' }] }, at)
          .fromTo(`${card} [data-beam]`, { xPercent: -260, autoAlpha: tier >= 2 ? 1 : 0.45 }, { xPercent: 260, autoAlpha: 0.2, duration: 0.55, ease: 'sine.inOut' }, at + 0.05)
      /** Ondes de choc, l'une après l'autre. */
      const rings = (at: number, count: number, scale: number) => {
        for (let ring = 0; ring < count; ring += 1) {
          timeline.fromTo(`[data-fx-ring="${ring}"]`, { scale: 0.4, autoAlpha: 1 }, { scale: scale + ring * 0.35, autoAlpha: 0, duration: 0.9 + ring * 0.12, ease: 'power2.out' }, at + ring * 0.1)
        }
      }

      if (tier <= 2) {
        // Commune, Rare, Épique.
        const flipDuration = [0.78, 0.8, 0.85][tier]!
        let at: number
        if (tier === 2) {
          playRiser(0.45)
          vibrate([18, 30, 18])
          timeline
            .to(lift, { y: -12, scale: 1.06, duration: 0.45, ease: 'sine.out' }, 0)
            .fromTo(aura, { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 0.9, scale: 1.12, duration: 0.45, ease: 'sine.in' }, 0)
            .to(flip, { keyframes: jitter(0.4, 0.5, 1.8) }, 0)
          at = 0.45
          // Déjà soulevée par la charge : elle monte encore en tournant, puis se pose.
          turn(at, flipDuration, false)
          timeline
            .to(lift, { y: -24, scale: 1.1, duration: flipDuration / 2, ease: 'power2.out' }, at)
            .to(lift, { y: 0, scale: 1, duration: flipDuration / 2 + 0.3, ease: 'back.out(1.6)' }, at + flipDuration / 2)
        } else {
          playFlip()
          vibrate(10)
          // Temps d'appel : la carte se tasse un instant, puis s'élance.
          timeline.to(lift, { y: 3, scale: 0.97, duration: 0.12, ease: 'sine.out' }, 0)
          at = 0.12
          turn(at, flipDuration, true)
        }
        const faceAt = at + flipDuration / 2
        timeline.add(() => {
          showFace(index)
          if (tier === 2) {
            vibrate(30)
            shake(5)
          }
        }, faceAt)
        cardFlash(faceAt, [0.7, 0.85, 0.9][tier]!)
        if (tier >= 1) {
          rings(faceAt, 1, tier === 2 ? 2.6 : 2)
          timeline.fromTo('[data-fx-glow]', { autoAlpha: 0, scale: 0.6 }, { autoAlpha: tier === 2 ? 0.55 : 0.3, scale: 1, duration: 0.6, ease: 'power3.out' }, faceAt)
        }
        if (tier === 2) {
          startLoops(false)
          timeline
            .fromTo('[data-fx-rays]', { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 0.35, scale: 1, duration: 0.6, ease: 'power3.out' }, faceAt)
            .to(aura, { autoAlpha: 0.6, scale: 1, duration: 0.6, ease: 'sine.out' }, faceAt + 0.1)
        } else if (tier === 1) {
          timeline.fromTo(aura, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 0.4, scale: 1, duration: 0.5, ease: 'sine.out' }, faceAt)
        }
        return
      }

      if (tier === 3) {
        // Légendaire : l'écran s'assombrit, la carte se charge d'or en tremblant, puis tout explose.
        const charge = 1.35
        const flipDuration = 0.85
        const faceAt = charge + flipDuration / 2
        playRiser(charge)
        vibrate([20, 40, 20, 40, 30])
        startLoops(false)
        timeline
          .to('[data-fx-dim]', { autoAlpha: 0.74, duration: 0.5, ease: 'sine.out' }, 0)
          .fromTo(aura, { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1.28, duration: charge, ease: 'sine.in' }, 0)
          .fromTo('[data-fx-glow]', { autoAlpha: 0, scale: 0.5 }, { autoAlpha: 0.55, scale: 0.85, duration: charge, ease: 'sine.in' }, 0)
          .fromTo('[data-fx-rays]', { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 0.3, scale: 0.95, duration: charge - 0.2, ease: 'sine.in' }, 0.2)
          .to(lift, { y: -18, scale: 1.1, duration: charge, ease: 'sine.inOut' }, 0)
          .to(flip, { keyframes: jitter(charge, 0.6, 4.5) }, 0)
          // Elle s'arrache vers l'écran en se retournant.
          .to(lift, { y: -28, scale: 1.15, duration: flipDuration / 2, ease: 'power2.out' }, charge)
        turn(charge, flipDuration, false)
        timeline
          .add(() => {
            showFace(index)
            vibrate([60, 40, 140])
            shake(12)
            // Pas de gerbe de particules : sur téléphone, le canevas plein écran faisait ramer
            // l'explosion. Éclair, ondes, rayons et lueur portent l'effet.
          }, faceAt)
          .fromTo('[data-fx-flash]', { autoAlpha: 0 }, { keyframes: [{ autoAlpha: 0.95, duration: 0.1, ease: 'power2.out' }, { autoAlpha: 0, duration: 0.9, ease: 'sine.inOut' }] }, faceAt)
          .to('[data-fx-rays]', { autoAlpha: 0.95, scale: 1.12, duration: 0.6, ease: 'power3.out' }, faceAt)
          .to('[data-fx-glow]', { autoAlpha: 1, scale: 1.1, duration: 0.5, ease: 'power3.out' }, faceAt)
          .to('[data-fx-dim]', { autoAlpha: 0.5, duration: 1.2, ease: 'sine.inOut' }, faceAt + 0.3)
          .to(lift, { y: 0, scale: 1, duration: 1, ease: 'elastic.out(1, 0.6)' }, faceAt)
          .to(aura, { autoAlpha: 0.85, scale: 1.05, duration: 0.8, ease: 'sine.out' }, faceAt + 0.1)
        rings(faceAt, 3, 3)
        cardFlash(faceAt, 1)
        return
      }

      // Mythique : noir total, battements de cœur, fausse alerte, puis l'arc-en-ciel.
      const finalAt = 2.3
      const flipDuration = 0.9
      const faceAt = finalAt + flipDuration / 2
      startLoops(true)
      timeline
        .to('[data-fx-dim]', { autoAlpha: 0.94, duration: 0.4, ease: 'power2.out' }, 0)
        .add(() => {
          playHeartbeat()
          vibrate([30, 140, 20])
        }, 0.15)
        .add(() => {
          playHeartbeat()
          vibrate([30, 140, 20])
        }, 0.95)
        .add(() => playRiser(finalAt - 0.4), 0.4)
        // Les lignes de vitesse convergent, la carte se soulève et s'irise.
        .fromTo('[data-fx-zoom]', { autoAlpha: 0, scale: 1.8 }, { autoAlpha: 0.6, scale: 1, duration: finalAt - 0.4, ease: 'power2.in' }, 0.4)
        .fromTo(aura, { autoAlpha: 0, scale: 0.5 }, { autoAlpha: 1, scale: 1.35, duration: finalAt - 0.4, ease: 'sine.in' }, 0.4)
        .fromTo('[data-fx-glow]', { autoAlpha: 0, scale: 0.5 }, { autoAlpha: 0.45, scale: 0.9, duration: finalAt - 0.4, ease: 'sine.in' }, 0.4)
        .to(lift, { y: -22, scale: 1.14, duration: finalAt - 0.4, ease: 'sine.inOut' }, 0.4)
        // Fausse alerte : elle commence à se retourner… et retombe sur le dos. Elle s'arrête
        // avant 90° : la face ne se devine jamais (un tour complet la montrait à mi-course).
        .add(() => {
          playFlip()
          vibrate(20)
        }, 0.6)
        .to(flip, { rotationY: 68, duration: 0.45, ease: 'power2.out', onUpdate: shadeFlip }, 0.6)
        .to(flip, { rotationY: 0, duration: 0.6, ease: 'back.out(2.2)', onUpdate: shadeFlip }, 1.1)
        .fromTo('[data-fx-prism]', { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 0.3, scale: 0.95, duration: 1.2, ease: 'sine.in' }, 1.0)
        .to(flip, { keyframes: jitter(finalAt - 1.7, 0.8, 6) }, 1.7)
        .add(() => shake(4), 1.85)
        // Le vrai retournement : elle s'arrache vers l'écran en tournant.
        .to(lift, { y: -30, scale: 1.18, duration: flipDuration / 2, ease: 'power2.out' }, finalAt)
      turn(finalAt, flipDuration, false)
      timeline
        .add(() => {
          showFace(index)
          vibrate([80, 40, 80, 40, 220])
          shake(16)
          // Pas de gerbe de particules (cf. Légendaire) : éclair, ondes, rayons irisés.
        }, faceAt)
        .add(() => shake(9), faceAt + 0.45)
        .fromTo('[data-fx-flash]', { autoAlpha: 0 }, { keyframes: [{ autoAlpha: 1, duration: 0.1, ease: 'power2.out' }, { autoAlpha: 0, duration: 1.1, ease: 'sine.inOut' }] }, faceAt)
        .to('[data-fx-zoom]', { autoAlpha: 0, scale: 0.6, duration: 0.5, ease: 'power2.out' }, faceAt)
        .to('[data-fx-prism]', { autoAlpha: 1, scale: 1.15, duration: 0.7, ease: 'power3.out' }, faceAt)
        .to('[data-fx-glow]', { autoAlpha: 1, scale: 1.2, duration: 0.6, ease: 'power3.out' }, faceAt)
        .to('[data-fx-dim]', { autoAlpha: 0.6, duration: 1.4, ease: 'sine.inOut' }, faceAt + 0.4)
        .to(lift, { y: 0, scale: 1, duration: 1.1, ease: 'elastic.out(1, 0.55)' }, faceAt)
        .to(aura, { autoAlpha: 0.9, scale: 1.1, duration: 0.8, ease: 'sine.out' }, faceAt + 0.15)
      rings(faceAt, FX_RINGS, 3.2)
      cardFlash(faceAt, 1)
    })()

  const revealTop = () => {
    const top = orderRef.current[0]
    if (top !== undefined && !revealedRef.current.has(top)) reveal(top)
  }

  /* ---- Passage d'une carte ------------------------------------------------------------------- */

  /** La carte du dessus peut-elle partir ? (Face vue assez longtemps, aucun lancer en cours.) */
  const canPass = () => {
    const top = orderRef.current[0]
    return phaseRef.current === 'deck' && top !== undefined && !moving.current && revealedRef.current.has(top) && performance.now() >= passableAt.current
  }

  /**
   * Carte du dessus vue : elle s'envole. Un geste trop tôt (retournement, lancer en cours) est
   * IGNORÉ, jamais mis de côté : enchaîner les touchers ne fait plus défiler les cartes suivantes
   * sans qu'on les voie. `false` : la carte reste.
   */
  const next = (direction: 1 | -1): boolean => {
    const top = orderRef.current[0]
    if (top === undefined || !canPass()) return false
    pass(top, direction)
    return true
  }

  /**
   * La carte s'envole en arc ; le paquet avance (cf. l'effet sur `order`). `rest` : la suite du
   * paquet (par défaut, toutes les cartes qui suivent).
   */
  const pass = (top: number, direction: 1 | -1, rest = orderRef.current.slice(1)) =>
    contextSafe(() => {
      moving.current = true
      passableAt.current = Number.POSITIVE_INFINITY
      // Petite carte encore en train de se poser : elle part avec la fin de son geste, sans saut ;
      // sa mise en scène continue sur elle, mais ne bloque plus la suivante.
      if (flipping.current?.index === top) {
        flipping.current.timeline.eventCallback('onComplete', null)
        detached.current = flipping.current.timeline
        flipping.current = null
      }
      orderRef.current = rest
      setSpot(null)
      fxOut()
      playDeal(sequence.length - rest.length)
      vibrate(8)
      const card = deckCard(top)
      gsap.set(card, { zIndex: 60 })
      gsap.to(card, {
        x: `+=${direction * Math.min(520, window.innerWidth * 0.85)}`,
        y: '-=40',
        rotation: direction * 26,
        autoAlpha: 0,
        duration: 0.42,
        ease: 'power2.in',
        overwrite: 'auto',
        onComplete: () => setLeaving((current) => current.filter((index) => index !== top)),
      })
      setLeaving((current) => [...current, top])
      setOrder(rest)
    })()

  /** Légendaire ou Mythique : jamais sautée sans sa mise en scène. */
  const isBig = (index: number) => rarityRank(cards[index]!.card.rarity) >= 3

  /**
   * « Passer » : les petites cartes encore à voir comptent comme vues ; les grandes pas encore
   * révélées restent seules dans le paquet et jouent chacune leur mise en scène, puis le
   * récapitulatif arrive. Sans grande carte en attente : le récapitulatif tout de suite.
   */
  const skip = () => {
    if (phaseRef.current !== 'deck') return
    const pending = orderRef.current.filter((index) => isBig(index) && !revealedRef.current.has(index))
    if (pending.length === 0) {
      recap()
      return
    }
    const top = orderRef.current[0]!
    for (const index of orderRef.current) if (!isBig(index)) revealedRef.current.add(index)
    setRevealed(new Set(revealedRef.current))
    if (isBig(top)) {
      // La grande du dessus (en train de se révéler, ou posée) reste ; les autres grandes suivent.
      const rest = [top, ...pending.filter((index) => index !== top)]
      orderRef.current = rest
      setOrder(rest)
      return
    }
    // Petite carte à l'écran : elle s'envole (même en plein retournement), les grandes arrivent.
    if (flipping.current?.index === top) {
      flipping.current.timeline.kill()
      flipping.current = null
    }
    pass(top, 1, pending)
  }

  /** Toutes vues (ou « Passer ») : le récapitulatif. */
  const recap = () =>
    contextSafe(() => {
      if (phaseRef.current === 'recap') return
      phaseRef.current = 'recap'
      flipping.current?.timeline.kill()
      flipping.current = null
      moving.current = false
      fxOut()
      const all = new Set(cards.map((_, index) => index))
      revealedRef.current = all
      setRevealed(all)
      setSpot(null)
      setPhase('recap')
      playHlSlide()
      vibrate([10, 30, 10])
    })()

  // Le paquet se forme : les cartes sorties du booster (même dos, même taille, même inclinaison)
  // descendent se ranger ; la première se retourne aussitôt.
  useGSAP(
    () => {
      const stage = stageRef.current?.getBoundingClientRect()
      if (!stage) return
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const visible = sequence.slice(0, DECK_DEPTH)
      placed.current = new Set(visible)
      const centerX = stage.left + stage.width / 2
      const centerY = stage.top + stage.height / 2
      const timeline = gsap.timeline({ onComplete: revealTop })
      visible.forEach((index, position) => {
        const card = `[data-deck="${index}"]`
        const pose = deckPose(position, index)
        gsap.set(card, { zIndex: 40 - position })
        if (reduced) {
          timeline.set(card, pose, 0)
          return
        }
        const origin = origins && origins.length > 0 ? origins[Math.min(position, origins.length - 1)]! : null
        const at = (visible.length - 1 - position) * 0.08
        if (origin)
          timeline.fromTo(
            card,
            { x: origin.x - centerX, y: origin.y - centerY, scale: origin.width / deckWidth, rotation: origin.rotation, autoAlpha: 1 },
            { ...pose, duration: 0.9, ease: 'power3.inOut' },
            at,
          )
        else timeline.fromTo(card, { ...pose, y: pose.y + 220, autoAlpha: 0 }, { ...pose, autoAlpha: 1, duration: 0.6, ease: 'back.out(1.3)' }, at)
      })
      if (!reduced && !origins) timeline.add(() => playDeal(0), 0)
    },
    { scope: rootRef },
  )

  // Une carte est partie : le paquet avance d'un cran, une nouvelle venue entre au fond,
  // puis la suivante se retourne. Plus aucune : le récapitulatif.
  // On compare au dernier paquet traité, pas à un drapeau « premier passage » : en développement,
  // React (StrictMode) exécute deux fois l'effet au montage ; le second passage croyait alors à un
  // vrai changement, rangeait les cartes par-dessus leur entrée, et les cartes du dessus (pas encore
  // parties) rejouaient ensuite leur descente depuis le booster : l'animation semblait jouée deux fois.
  const handledOrder = useRef(order)
  useGSAP(
    () => {
      if (handledOrder.current === order) return
      handledOrder.current = order
      if (phaseRef.current !== 'deck') return
      if (order.length === 0) {
        gsap.delayedCall(0.3, recap)
        return
      }
      const visible = order.slice(0, DECK_DEPTH)
      visible.forEach((index, position) => {
        const card = `[data-deck="${index}"]`
        const pose = deckPose(position, index)
        gsap.set(card, { zIndex: 40 - position })
        if (placed.current.has(index)) gsap.to(card, { ...pose, duration: 0.38, ease: 'power2.out', delay: 0.06, overwrite: 'auto' })
        else gsap.fromTo(card, { ...deckPose(position + 1, index), autoAlpha: 0 }, { ...pose, autoAlpha: 1, duration: 0.38, ease: 'power2.out', delay: 0.06 })
      })
      placed.current = new Set(visible)
      gsap.delayedCall(0.4, () => {
        moving.current = false
        revealTop()
      })
    },
    { scope: rootRef, dependencies: [order] },
  )

  // Récapitulatif : chaque carte rejoint sa case, puis flotte (sauf quand il y en a beaucoup).
  useGSAP(
    () => {
      if (phase !== 'recap') return
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const slots = gsap.utils.toArray<HTMLElement>('[data-recap]', rootRef.current)
      const perRow = Math.min(columns, cards.length)
      const tilt = (index: number) => (many ? 0 : ((index % perRow) - (perRow - 1) / 2) * (perRow <= 2 ? 5 : 4))
      if (reduced) {
        gsap.set(slots, { rotation: tilt })
        onAllRevealed()
        return
      }
      gsap
        .timeline({
          onComplete: () => {
            onAllRevealed()
            if (!many) slots.forEach((slot, index) => gsap.to(slot.querySelector('[data-bob]'), { y: -7, duration: 1.5 + (index % 6) * 0.2, ease: 'sine.inOut', repeat: -1, yoyo: true }))
          },
        })
        .fromTo(slots, { y: 40, scale: 0.7, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, rotation: tilt, duration: 0.55, ease: 'back.out(1.4)', stagger: Math.min(0.06, 0.9 / cards.length) })
    },
    { scope: rootRef, dependencies: [phase] },
  )

  // Paquet : la zone de contenu (qui défile pour le récapitulatif) ne doit rien rogner — halos,
  // rayons et cartes lancées débordent largement, jusque sous la barre du haut.
  useEffect(() => {
    const scroller = rootRef.current?.parentElement
    if (!scroller || phase !== 'deck') return
    unclip(scroller, true)
    return () => unclip(scroller, false)
  }, [phase])

  // Clavier : les flèches font passer la carte du dessus.
  useEffect(() => {
    if (phase !== 'deck') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Démontage : les boucles des effets s'arrêtent.
  useEffect(
    () => () => {
      loops.current.forEach((tween) => tween.kill())
      loops.current = []
    },
    [],
  )

  /* ---- Gestes sur le paquet ----------------------------------------------------------------- */

  // Glisser la carte du dessus : elle suit le doigt ; assez loin (ou un simple toucher), elle passe.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const top = orderRef.current[0]
    if (phaseRef.current !== 'deck' || top === undefined) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const held = canPass()
    if (held) gsap.killTweensOf(deckCard(top), 'x,rotation')
    drag.current = { id: event.pointerId, x: event.clientX, dx: 0, t: event.timeStamp, velocity: 0, held }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const dx = event.clientX - current.x
    // Vitesse du geste (px/ms), lissée : un lancer vif suffit, même court.
    current.velocity = current.velocity * 0.6 + ((dx - current.dx) / Math.max(1, event.timeStamp - current.t)) * 0.4
    current.dx = dx
    current.t = event.timeStamp
    const top = orderRef.current[0]
    if (current.held && top !== undefined) gsap.set(deckCard(top), { x: dx, rotation: dx * 0.06 })
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    drag.current = null
    const flick = Math.abs(current.velocity) > 0.45 && Math.abs(current.dx) > 18
    const passes = (Math.abs(current.dx) > 60 || Math.abs(current.dx) < 6 || flick) && next(current.dx < 0 ? -1 : 1)
    const top = orderRef.current[0]
    if (!passes && current.held && top !== undefined) gsap.to(deckCard(top), { x: 0, rotation: 0, duration: 0.4, ease: 'back.out(2)' })
  }

  /* ---- Rendu -------------------------------------------------------------------------------- */

  const badgeOf = (pulled: PulledCard) =>
    pulled.isNew ? (
      <span className="rounded-full bg-like px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-void uppercase shadow-[0_0_12px_rgba(63,224,160,0.7)]">{t.boosters.isNew}</span>
    ) : (
      <span className="rounded-full bg-void/75 px-1.5 py-0.5 text-[9px] font-semibold text-cream tabular-nums">{t.boosters.copies(pulled.count)}</span>
    )

  if (phase === 'recap') {
    return (
      <div ref={rootRef} className="flex flex-col items-center">
        <div className="relative mb-7 grid items-end justify-center" style={{ gridTemplateColumns: `repeat(${columns}, ${width}px)`, gap }}>
          {cards.map((pulled, index) => {
            const style = RARITY_STYLE[pulled.card.rarity]
            const picked = selection?.picked.has(index) ?? false
            // Beaucoup de cartes : seules les grandes gardent leurs effets en boucle.
            const effects = !many || rarityRank(pulled.card.rarity) >= 3
            return (
              <button
                key={`${pulled.card.id}-${index}`}
                type="button"
                data-recap={index}
                onClick={() => (selection ? selection.toggle(index) : onInspect(pulled))}
                aria-label={selection ? pulled.card.title : t.boosters.inspect(pulled.card.title)}
                aria-pressed={selection ? picked : undefined}
                className="relative rounded-xl opacity-0 outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
                style={{ width, height }}
              >
                {selection && (
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute -inset-1 z-[3] rounded-[11%/8%] transition-opacity duration-200 ${picked ? 'opacity-100' : 'opacity-0'}`}
                    style={{ boxShadow: `0 0 0 3px #fff4c8, 0 0 0 6px ${style.color}` }}
                  >
                    <span className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full bg-[#fff4c8] text-void">
                      <Check size={16} strokeWidth={3} />
                    </span>
                  </span>
                )}
                <div data-bob className="relative h-full w-full transition-opacity duration-200" style={selection && !picked ? { opacity: 0.5 } : undefined}>
                  <CollectibleCard card={pulled.card} width={width} lazy={false} effects={effects} interactive={!many} badge={badgeOf(pulled)} />
                </div>
              </button>
            )
          })}
        </div>
        {/* Zone de hauteur FIXE sous les cartes : les boutons de fin y arrivent sans rien décaler. */}
        <div className={`flex h-32 w-full flex-col items-center justify-start gap-3 ${many ? 'sticky bottom-0 z-[120] bg-gradient-to-t from-[#050507] via-[#050507]/90 to-transparent pt-2' : ''}`}>
          {footer}
        </div>
      </div>
    )
  }

  /** Cartes montées : celles qui s'envolent, puis les quatre du dessus du paquet. */
  const visible = order.slice(0, DECK_DEPTH)
  const mounted = [...leaving.filter((index) => !visible.includes(index)), ...visible]
  const passedCount = sequence.length - order.length

  return (
    <div ref={rootRef} className="flex flex-col items-center">
      <RevealFx ring={Math.round(deckWidth * 1.1)} />
      <div data-reveal-shake className="relative z-[1] flex flex-col items-center gap-6">
        <div
          ref={stageRef}
          className="relative touch-none"
          style={{ width: deckWidth, height: deckHeight, marginTop: PEEK * (DECK_DEPTH - 1) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* Ombre au sol : elle s'éloigne quand la carte se soulève pour se retourner. */}
          <div
            data-ground
            aria-hidden
            className="pointer-events-none absolute inset-x-[8%] -bottom-6 h-10 rounded-[50%]"
            style={{ background: 'radial-gradient(closest-side, rgba(0,0,0,0.7), transparent)', willChange: 'transform, opacity' }}
          />
          {mounted.map((index) => {
            const pulled = cards[index]!
            const position = order.indexOf(index)
            const top = position === 0
            const faceUp = revealed.has(index)
            /**
             * Effets en boucle de la carte du dessus (et de celle qui s'envole) : actifs dès avant le
             * retournement, côté face encore caché, pour que rien n'apparaisse d'un coup en pleine rotation.
             */
            const effects = position <= 0
            /** Reflet sous le doigt et gyroscope : une fois la carte posée seulement. */
            const live = faceUp && effects && settled === index
            return (
              // Pivot au centre : la carte part de la place (centre, taille, inclinaison) de son dos dans le
              // booster ouvert ; un pivot décentré décalait son centre à la première image (petit saut).
              <div key={index} data-deck={index} className="absolute inset-0" style={{ willChange: 'transform' }}>
                <button
                  type="button"
                  tabIndex={top ? 0 : -1}
                  aria-hidden={!top || undefined}
                  // Seul le clavier passe la carte ici (le doigt glisse sur le paquet).
                  onClick={(event) => event.detail === 0 && next(1)}
                  aria-label={faceUp ? pulled.card.title : t.boosters.cardBack(passedCount + 1)}
                  className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
                >
                  <div data-lift className="relative h-full w-full" style={{ willChange: 'transform' }}>
                    <span data-aura aria-hidden className="pointer-events-none absolute -inset-[30%] opacity-0" style={{ ...auraOf(pulled.card.rarity), willChange: 'transform, opacity' }} />
                    <div data-flip className="relative h-full w-full [transform-style:preserve-3d]" style={{ willChange: 'transform' }}>
                      <div className="absolute inset-0 [backface-visibility:hidden]">
                        <CardBack width={deckWidth} animated={top && !faceUp} />
                        <div data-shade aria-hidden className="pointer-events-none absolute inset-0 rounded-[9%/6.5%] bg-black opacity-0" />
                      </div>
                      {/* La face n'est montée que pour le dessus et la suivante (son image est prête au retournement). */}
                      {position <= 1 && (
                        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                          <CollectibleCard card={pulled.card} width={deckWidth} lazy={false} effects={effects} interactive={live} gyro={live} badge={badgeOf(pulled)} />
                          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[9%/6.5%]">
                            <div data-shade className="absolute inset-0 bg-black opacity-0" />
                            <div data-flash className="absolute inset-0 bg-white opacity-0" />
                            <div
                              data-beam
                              className="absolute -inset-y-[25%] left-1/3 w-1/3 rotate-[18deg] opacity-0"
                              style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)', willChange: 'transform' }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              </div>
            )
          })}
        </div>

        {/* Zone de hauteur FIXE : titre de la rareté, pastilles, « Passer ». */}
        <div className="flex h-32 w-full flex-col items-center justify-start gap-3">
          <RarityTitle pulled={spot === null ? null : (cards[spot] ?? null)} index={spot} />
          <div className={`flex max-w-[min(90vw,26rem)] flex-wrap items-center justify-center ${many ? 'gap-1' : 'gap-1.5'}`} aria-label={t.boosters.deck.counter(Math.min(passedCount + 1, cards.length), cards.length)} role="img">
            {sequence.map((cardIndex, step) => {
              const pulled = cards[cardIndex]!
              const color = RARITY_STYLE[pulled.card.rarity].color
              return (
                <span
                  key={cardIndex}
                  aria-hidden
                  className="h-1.5 rounded-full transition-[width,background-color] duration-300"
                  style={{
                    width: step === Math.min(passedCount, cards.length - 1) ? (many ? 14 : 22) : many ? 5 : 8,
                    background: revealed.has(cardIndex) ? color : 'rgba(255,255,255,0.18)',
                  }}
                />
              )
            })}
          </div>
          <button type="button" onClick={skip} className="rounded-full border border-[#ffe39a]/25 px-4 py-1.5 text-[11px] tracking-[0.12em] text-[#fff4c8]/80 uppercase hover:bg-[#ffe39a]/10">
            {t.boosters.deck.skip}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Nom de la rareté de la carte qui vient d'apparaître, avec « Nouvelle » s'il y a lieu ; avant la
 * première, l'indication du geste. Légendaire et Mythique claquent lettre à lettre.
 */
function RarityTitle({ pulled, index }: { pulled: PulledCard | null; index: number | null }) {
  const t = useT()
  const ref = useRef<HTMLParagraphElement>(null)
  useGSAP(
    () => {
      if (!pulled || !ref.current) return
      if (rarityRank(pulled.card.rarity) >= 3) {
        gsap.fromTo(
          ref.current.querySelectorAll('[data-letter]'),
          { autoAlpha: 0, yPercent: 90, scale: 2.2, rotation: (letter: number) => (letter % 2 ? 14 : -14) },
          { autoAlpha: 1, yPercent: 0, scale: 1, rotation: 0, duration: 0.55, ease: 'back.out(2.4)', stagger: 0.045 },
        )
      } else gsap.fromTo(ref.current, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power3.out' })
    },
    { dependencies: [index] },
  )
  if (!pulled) return <p className="flex h-10 items-center text-xs tracking-[0.2em] text-cream/60 uppercase">{t.boosters.deck.swipe}</p>
  const { rarity } = pulled.card
  const tier = rarityRank(rarity)
  const label = t.cards.rarity[rarity]
  return (
    <p ref={ref} className="flex h-10 items-center gap-2.5 font-display uppercase" aria-live="polite" aria-label={label}>
      {tier >= 3 ? (
        <span aria-hidden className="text-[1.75rem] leading-none tracking-[0.12em]">
          {Array.from(label).map((letter, position) => (
            <span
              key={position}
              data-letter
              className="inline-block will-change-transform"
              // Ombre nette (sans flou) : le relief d'un titre de manga.
              style={{ color: tier === 4 ? PRISM[position % PRISM.length] : '#ffd36b', textShadow: tier === 4 ? '0 2px 0 rgba(20,10,40,0.85)' : '0 2px 0 #7a4a00' }}
            >
              {letter === ' ' ? ' ' : letter}
            </span>
          ))}
        </span>
      ) : (
        <span aria-hidden className="text-xl tracking-[0.28em]" style={{ color: RARITY_STYLE[rarity].color }}>
          {label}
        </span>
      )}
      {pulled.isNew && (
        <span className="rounded-full bg-like px-2 py-0.5 font-sans text-[10px] font-bold tracking-wide text-void normal-case shadow-[0_0_12px_rgba(63,224,160,0.7)]">{t.boosters.isNew}</span>
      )}
    </p>
  )
}
