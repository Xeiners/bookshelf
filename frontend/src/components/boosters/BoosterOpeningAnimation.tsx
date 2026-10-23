import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useT } from '../../i18n'
import { RARITY_STYLE, type CardOrigin, type Rarity } from '../../lib/boosters'
import type { CardSeries } from '../../services/cardsApi'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playCutTick, playDeal } from '../../lib/sfx'
import { CardBack } from '../cards/CardBack'
import { CARD_RATIO } from '../cards/CollectibleCard'
import { BoosterPackArt } from './BoosterPackArt'

/** Éventail des cartes sorties du booster : celle du dessus droite, les autres penchées de part et d'autre. */
const fanOf = (index: number) => (index === 0 ? 0 : (index % 2 ? -1 : 1) * Math.ceil(index / 2) * 7)

/** Part de la largeur du paquet à parcourir du doigt pour découper toute la bande. */
const CUT_SPAN = 0.8
/** Relâché au-delà, la découpe se termine seule ; en deçà, la bande se recolle. */
const CUT_COMMIT = 0.75

interface BoosterOpeningAnimationProps {
  width: number
  /** Lueur-appât du booster (souvent sa meilleure carte, parfois un bluff) : colore le halo. */
  halo: Rarity | null
  /** Le contenu est connu : la déchirure est possible. */
  ready: boolean
  /** Le booster est déchiré : l'animation de sortie se joue. */
  torn: boolean
  onTear: () => void
  /** Étincelles à cette position (pixels de la fenêtre) : pendant la découpe, et à l'arrachement. */
  onSparks: (x: number, y: number, count: number) => void
  /**
   * Fin de l'animation de déchirure : les cartes peuvent jaillir. Deluxe : avec la place de
   * chaque carte sortie du booster (dans l'ordre du tirage), d'où partira le paquet.
   */
  onTorn: (origins?: CardOrigin[]) => void
  /** Série du paquet (son illustration) ; `null` tant que la roulette n'a pas parlé. */
  series?: CardSeries | null
  /** Ouverture deluxe (essai admin) : colonne de lumière à l'arrachement, puis les cartes sortent du booster. */
  deluxe?: boolean
  /** Nombre de cartes du booster (deluxe : autant de dos de carte sortent du paquet). */
  count?: number
}

/**
 * L'artefact en suspens : le booster s'avance vers l'écran, flotte au-dessus
 * de son ombre portée, et s’entoure d’un halo qui laisse deviner sa meilleure
 * carte. Glisser vers la droite découpe la bande EN TEMPS RÉEL, sous le
 * doigt : la partie coupée se soulève, une étincelle suit la coupe. Au bout
 * (ou relâchée aux trois quarts), la bande s'arrache, une gerbe d'étincelles
 * jaillit, le paquet s'enfonce hors champ ; relâchée trop tôt, elle se recolle.
 */
export function BoosterOpeningAnimation({ width, halo, ready, torn, onTear, onSparks, onTorn, series = null, deluxe = false, count = 0 }: BoosterOpeningAnimationProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  /** Découpe en cours : point de départ, avancement (0 → 1), dernières étincelles et vibrations. */
  const cut = useRef({ active: false, startX: 0, progress: 0, moved: false, lastSpark: 0, lastBuzz: 0, done: false })
  const height = Math.round(width * 1.55)
  /** Deluxe : dos des cartes qui sortent du booster, un peu plus étroits que lui. */
  const cardWidth = Math.round(width * 0.78)
  const cardHeight = Math.round(cardWidth * CARD_RATIO)

  // Arrivée vers l'écran, puis flottaison ; l'ombre au sol suit la hauteur du paquet.
  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const arrival = 1.15
      gsap.fromTo(
        '[data-pack-body]',
        { scale: 0.42, y: 90, rotationX: 28, transformPerspective: 1100, autoAlpha: 0 },
        { scale: 1, y: 0, rotationX: 0, autoAlpha: 1, duration: arrival, ease: 'power3.out' },
      )
      gsap.fromTo('[data-pack-shadow]', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 0.7, duration: arrival, ease: 'power3.out' })
      if (reduced) return
      gsap.to('[data-pack-float]', { y: -16, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: arrival - 0.05 })
      gsap.to('[data-pack-shadow]', { scale: 0.78, autoAlpha: 0.38, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: arrival - 0.05 })
      gsap.to('[data-pack-float]', { rotationY: 11, rotationX: 4, transformPerspective: 1100, duration: 3.2, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.fromTo('[data-pack-shine]', { xPercent: -170 }, { xPercent: 260, duration: 2.2, ease: 'power1.inOut', repeat: -1, repeatDelay: 1.3 })
    },
    { scope: rootRef },
  )

  // Le halo s'allume quand le contenu est connu.
  useGSAP(
    () => {
      if (!ready) return
      gsap.fromTo('[data-pack-halo]', { scale: 0.5, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.9, ease: EASE.glide })
    },
    { scope: rootRef, dependencies: [ready, halo] },
  )

  // Déchirure.
  useGSAP(
    () => {
      if (!torn) return
      gsap.killTweensOf(['[data-pack-float]', '[data-pack-shadow]'])
      const strip = rootRef.current?.querySelector('[data-pack-strip]')
      if (deluxe) {
        // Deluxe : le paquet se redresse et frissonne, la bande s'arrache dans une colonne de
        // lumière, puis les cartes montent une à une hors du booster ouvert, en éventail ; le
        // paquet s'efface vers le bas en les laissant suspendues — le paquet de révélation
        // repart exactement de là (`onTorn(origins)`).
        const emerged = gsap.utils.toArray<HTMLElement>('[data-emerge-card]', rootRef.current)
        const rise = cardHeight * 0.82
        gsap
          .timeline({
            onComplete: () =>
              onTorn(
                emerged.map((element, index) => {
                  const box = element.getBoundingClientRect()
                  return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: cardWidth, rotation: fanOf(index) }
                }),
              ),
          })
          .to('[data-pack-float]', { y: 0, rotationX: 0, rotationY: 0, duration: 0.25, ease: 'sine.out' })
          .to('[data-pack-float]', { x: 3, rotation: 0.6, duration: 0.045, repeat: 5, yoyo: true, ease: 'none' }, '<')
          .add(() => {
            const box = strip?.getBoundingClientRect()
            if (box) onSparks(box.left + box.width / 2, box.bottom, 80)
          })
          .to('[data-pack-strip]', { transformOrigin: '100% 100%', x: 170, y: -210, rotation: 50, autoAlpha: 0, duration: 0.6, ease: 'power2.in' }, '<')
          .fromTo('[data-pack-beam]', { scaleY: 0, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.4, ease: 'power3.out' }, '<0.1')
          .fromTo('[data-pack-flash]', { scale: 0.2, autoAlpha: 0 }, { scale: 1.7, autoAlpha: 1, duration: 0.26, ease: 'power2.out' }, '<')
          .to('[data-pack-flash]', { autoAlpha: 0, duration: 0.5, ease: 'power1.in' })
          .to('[data-pack-beam]', { autoAlpha: 0.35, duration: 0.5, ease: 'sine.inOut' }, '<')
          // Les cartes sortent, de celle du fond à celle du dessus.
          .addLabel('rise', '-=0.35')
          .add(() => playDeal(0), 'rise')
          .fromTo(
            [...emerged].reverse(),
            { y: 0, rotation: 0 },
            { y: -rise, rotation: (index: number) => fanOf(emerged.length - 1 - index), duration: 0.9, ease: 'power2.out', stagger: 0.18 },
            'rise',
          )
          // Le paquet s'efface ; les cartes, libres, achèvent de sortir.
          .addLabel('drop', '+=0.25')
          .set('[data-emerge-clip]', { overflow: 'visible' }, 'drop')
          .to(emerged, { y: -rise - cardHeight * 0.12, duration: 0.7, ease: 'sine.out' }, 'drop')
          .to('[data-pack-beam]', { autoAlpha: 0, duration: 0.4 }, 'drop')
          .to('[data-pack-float]', { y: 260, autoAlpha: 0, duration: 0.7, ease: 'power2.in' }, 'drop')
          .to('[data-pack-shadow]', { scale: 0.2, autoAlpha: 0, duration: 0.5 }, 'drop')
        return
      }
      gsap
        .timeline({ onComplete: onTorn })
        .to('[data-pack-float]', { x: 4, rotation: 0.8, duration: 0.045, repeat: 7, yoyo: true, ease: 'none' })
        .add(() => {
          const box = strip?.getBoundingClientRect()
          if (box) onSparks(box.right - box.width * 0.1, box.bottom, 70)
        })
        // La bande, découpée de bout en bout, s'arrache vers la droite.
        .to('[data-pack-strip]', { transformOrigin: '100% 100%', x: 170, y: -210, rotation: 50, autoAlpha: 0, duration: 0.6, ease: 'power2.in' }, '<')
        .fromTo('[data-pack-flash]', { scale: 0.2, autoAlpha: 0 }, { scale: 1.7, autoAlpha: 1, duration: 0.26, ease: 'power2.out' }, '<-0.4')
        .to('[data-pack-flash]', { autoAlpha: 0, duration: 0.5, ease: 'power1.in' })
        .to('[data-pack-float]', { y: 360, rotationX: 35, transformPerspective: 1100, scale: 0.88, autoAlpha: 0, duration: 0.6, ease: 'power3.in' }, '<-0.25')
        .to('[data-pack-shadow]', { scale: 0.2, autoAlpha: 0, duration: 0.5 }, '<')
    },
    { scope: rootRef, dependencies: [torn] },
  )

  /** Avancement de la découpe, écrit directement sur l'élément : aucun rendu React pendant le geste. */
  const setCut = (value: number) => rootRef.current?.style.setProperty('--cut', value.toFixed(3))
  const setCutting = (on: boolean) => rootRef.current?.style.setProperty('--cutting', on ? '1' : '0')

  /** Fin de la découpe : la bande se détache jusqu'au bout, puis s'arrache (animation de déchirure). */
  const finish = () => {
    const state = cut.current
    if (!ready || torn || state.done) return
    state.done = true
    state.active = false
    const root = rootRef.current
    if (!root) return
    gsap.to(root, {
      '--cut': 1,
      duration: 0.14,
      ease: 'power1.out',
      onComplete: () => {
        setCutting(false)
        onTear()
      },
    })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!ready || torn || cut.current.done) return
    event.currentTarget.setPointerCapture(event.pointerId)
    if (rootRef.current) gsap.killTweensOf(rootRef.current)
    Object.assign(cut.current, { active: true, startX: event.clientX, progress: 0, moved: false })
    setCut(0)
    setCutting(true)
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    const state = cut.current
    if (!state.active) return
    const distance = event.clientX - state.startX
    if (distance > 6) state.moved = true
    const progress = Math.min(1, Math.max(0, distance / (width * CUT_SPAN)))
    state.progress = progress
    setCut(progress)

    const now = performance.now()
    const strip = rootRef.current?.querySelector('[data-pack-strip]')?.getBoundingClientRect()
    // Étincelles au point de coupe, tant que le doigt avance.
    if (strip && progress > 0.02 && now - state.lastSpark > 70) {
      state.lastSpark = now
      onSparks(strip.left + strip.width * (0.03 + progress * 0.94), strip.bottom - strip.height * 0.26, 10)
      playCutTick(progress)
    }
    if (now - state.lastBuzz > 90 && progress > 0.02) {
      state.lastBuzz = now
      vibrate(4)
    }
    if (progress >= 1) finish()
  }

  const onPointerUp = () => {
    const state = cut.current
    if (!state.active) return
    state.active = false
    if (state.progress >= CUT_COMMIT) {
      finish()
      return
    }
    const root = rootRef.current
    if (!root) return
    if (!state.moved) {
      // Simple toucher : la bande s'entrouvre puis se referme — le geste, montré.
      gsap.fromTo(root, { '--cut': 0 }, { '--cut': 0.14, duration: 0.22, ease: 'power2.out', yoyo: true, repeat: 1, onComplete: () => setCutting(false) })
      return
    }
    // Découpe abandonnée : la bande se recolle.
    gsap.to(root, { '--cut': 0, duration: 0.45, ease: 'back.out(2)', onComplete: () => setCutting(false) })
  }

  /** Clavier (Entrée, Espace) : pas de geste possible, la découpe se fait d'un coup. */
  const onClick = (event: ReactMouseEvent) => {
    if (event.detail === 0) finish()
  }

  return (
    <div ref={rootRef} className="relative flex flex-col items-center">
      <button
        type="button"
        aria-label={t.boosters.tear}
        aria-disabled={!ready || torn}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        className="relative touch-none rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
        style={{ width, height }}
      >
        {/* Sous-arbre aplati (pas de `preserve-3d`) : un calque par élément animé, rien de plus. */}
        <div data-pack-body className="h-full w-full" style={{ willChange: 'transform' }}>
          <div data-pack-float className="h-full w-full" style={{ willChange: 'transform' }}>
            <BoosterPackArt width={width} halo={halo} lit={ready} series={series} />
          </div>
        </div>
      </button>
      {deluxe && (
        // Colonne de lumière qui jaillit du haut du paquet à l'arrachement (couleur du halo).
        <div
          data-pack-beam
          aria-hidden
          className="pointer-events-none absolute bottom-[88%] left-1/2 h-[140%] origin-bottom -translate-x-1/2 opacity-0 blur-[2px]"
          style={{
            width: width * 0.62,
            background: `linear-gradient(to top, #ffffff, ${halo ? RARITY_STYLE[halo].color : '#ffc46b'} 30%, transparent)`,
            maskImage: 'linear-gradient(to right, transparent, #000 30%, #000 70%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, #000 30%, #000 70%, transparent)',
            mixBlendMode: 'screen',
          }}
        />
      )}
      {deluxe && count > 0 && (
        // Fente du booster : tout ce qui dépasse sous la ligne d'ouverture (13 % du haut) est
        // caché ; les cartes, placées juste dessous, en sortent en montant.
        <div
          data-emerge-clip
          aria-hidden
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 overflow-hidden"
          style={{ width: width * 2.4, top: -cardHeight * 1.2, height: cardHeight * 1.2 + height * 0.13 }}
        >
          {Array.from({ length: count }, (_, index) => (
            <div
              key={index}
              data-emerge-card
              className="absolute top-full left-1/2"
              style={{ width: cardWidth, height: cardHeight, marginLeft: -cardWidth / 2, zIndex: count - index, transformOrigin: '50% 100%', willChange: 'transform' }}
            >
              <CardBack width={cardWidth} animated={false} />
            </div>
          ))}
        </div>
      )}
      {/* Ombre portée au sol. */}
      <div
        data-pack-shadow
        aria-hidden
        className="pointer-events-none -mt-3 h-6 rounded-[50%]"
        style={{ width: width * 0.85, background: 'radial-gradient(closest-side, rgba(0,0,0,0.85), transparent)', willChange: 'transform' }}
      />
    </div>
  )
}
