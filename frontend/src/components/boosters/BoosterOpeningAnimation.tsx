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

/** Dos de carte qui sortent du paquet, au plus (plusieurs boosters ouverts d'un coup : les autres suivent, cachés). */
const MAX_EMERGED = 5

/** Espace gardé libre en haut de l'écran (barre des boosters, bouton fermer) quand les cartes sortent. */
const TOP_MARGIN = 72

/** Éventail des cartes sorties du booster : celle du dessus droite, les autres penchées de part et d'autre. */
const fanOf = (index: number) => (index === 0 ? 0 : (index % 2 ? -1 : 1) * Math.ceil(index / 2) * 7)

/** Part de la largeur du paquet à parcourir du doigt pour découper toute la bande. */
const CUT_SPAN = 0.8
/** Relâché au-delà, la découpe se termine seule ; en deçà, la bande se recolle. */
const CUT_COMMIT = 0.75

/** Ligne de déchirure, en % de la hauteur du paquet : juste sous la bande sertie, qui part entière. */
const TEAR_Y = 13.7
/** Haut des cartes rangées dans le paquet : sous le bord déchiré, invisibles avant de monter. */
const CARDS_TOP = (TEAR_Y + 3.5) / 100

/** Un bord de papier déchiré, irrégulier mais toujours le même : `[x, y]` en %. */
const tearLine = (base: number, phase: number, from = 0, to = 100) =>
  Array.from({ length: 37 }, (_, index) => {
    const x = from + ((to - from) * index) / 36
    const y = base + 0.6 * Math.sin(index * 2.3 + phase) + 0.3 * Math.sin(index * 5.1 + 1 + phase)
    return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const
  })

/** Bord avant du paquet (celui qu'on déchire), et bord du panneau de dos, un peu plus haut. */
const TEAR = tearLine(TEAR_Y, 0)
const BACK_TEAR = tearLine(TEAR_Y - 2.4, 1.7, 2, 98)

/** Abscisse du point de coupe, suivant le doigt (variable CSS `--cut`, 0 → 1). */
const CUT_X = 'calc(var(--cut, 0) * 100%)'
const at = ([x, y]: readonly [number, number]) => `${x}% ${y}%`

/** Le haut du paquet (au-dessus de la déchirure), lueurs comprises. */
const CAP_CLIP = `polygon(-60% -60%, 160% -60%, 160% ${TEAR.at(-1)![1]}%, ${[...TEAR].reverse().map(at).join(', ')}, -60% ${TEAR[0]![1]}%)`
/**
 * Le reste du paquet : tout, sauf le haut déjà découpé (à gauche du point de coupe). Les points
 * au-delà de la coupe se replient sur elle ; ce qui reste du haut appartient encore à la pièce du dessus.
 */
const LOWER_CLIP = `polygon(-60% 160%, -60% ${TEAR[0]![1]}%, ${TEAR.map(([x, y]) => `min(${x}%, ${CUT_X}) ${y}%`).join(', ')}, ${CUT_X} -60%, 160% -60%, 160% 160%)`
/** L'intérieur du paquet : le panneau de dos, déchiré un peu plus haut que la face. */
const MOUTH_CLIP = `polygon(${BACK_TEAR.map(at).join(', ')}, 98% 30%, 2% 30%)`

/** Le bord déchiré : fibres claires du papier, le long de la ligne de déchirure. */
function TornEdge({ points }: { points: readonly (readonly [number, number])[] }) {
  const line = points.map(([x, y]) => `${x},${y}`).join(' ')
  return (
    <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <polyline points={line} fill="none" stroke="#fff6dc" strokeOpacity={0.35} strokeWidth={4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <polyline points={line} fill="none" stroke="#fffaf0" strokeWidth={1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

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
   * Fin de l'animation de déchirure, avec la place de chaque carte sortie du booster (dans
   * l'ordre du tirage) : le paquet de révélation part de là.
   */
  onTorn: (origins: CardOrigin[]) => void
  /** Série du paquet (son illustration) ; `null` tant que la roulette n'a pas parlé. */
  series?: CardSeries | null
  /** Nombre de cartes du booster : autant de dos de carte sortent du paquet (`MAX_EMERGED` au plus). */
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
export function BoosterOpeningAnimation({ width, halo, ready, torn, onTear, onSparks, onTorn, series = null, count = 0 }: BoosterOpeningAnimationProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  /** Découpe en cours : point de départ, avancement (0 → 1), dernières étincelles et vibrations. */
  const cut = useRef({ active: false, startX: 0, progress: 0, moved: false, lastSpark: 0, lastBuzz: 0, done: false })
  const height = Math.round(width * 1.55)
  /** Dos des cartes qui sortent du booster, un peu plus étroits que lui. */
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
      // Le paquet se redresse et frissonne, son haut s'arrache le long de la déchirure dans une
      // colonne de lumière, puis les cartes montent une à une de l'intérieur, en éventail. Elles
      // restent DERRIÈRE la face du paquet : il descend et s'efface sous elles, les découvrant
      // sans jamais passer devant — le paquet de révélation repart de là (`onTorn(origins)`).
      const emerged = gsap.utils.toArray<HTMLElement>('[data-emerge-card]', rootRef.current)
      // Hauteur de sortie : la carte presque entière, sans que l'éventail ne passe sous la barre du
      // haut (petits écrans) ; puis un dernier élan quand le paquet s'efface.
      const packTop = rootRef.current?.getBoundingClientRect().top ?? 0
      const room = Math.max(cardHeight * 0.4, packTop + height * CARDS_TOP - TOP_MARGIN)
      const rise = Math.min(cardHeight * 0.9, room)
      const lift = Math.max(0, Math.min(cardHeight * 0.14, room - rise))
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
          const box = rootRef.current?.querySelector('[data-pack-float]')?.getBoundingClientRect()
          if (box) onSparks(box.left + box.width / 2, box.top + (box.height * TEAR_Y) / 100, 80)
        })
        // Le haut arraché s'envole en tournoyant, pivotant depuis le bout de la déchirure.
        .to(
          '[data-pack-cap]',
          { transformOrigin: `100% ${TEAR_Y}%`, x: width * 0.5, y: -height * 0.42, rotation: 42, autoAlpha: 0, duration: 0.7, ease: 'power2.in' },
          '<',
        )
        .fromTo('[data-pack-beam]', { scaleY: 0, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.4, ease: 'power3.out' }, '<0.1')
        .fromTo('[data-pack-flash]', { scale: 0.2, autoAlpha: 0 }, { scale: 1.7, autoAlpha: 1, duration: 0.26, ease: 'power2.out' }, '<')
        .to('[data-pack-flash]', { autoAlpha: 0, duration: 0.5, ease: 'power1.in' })
        .to('[data-pack-beam]', { autoAlpha: 0, duration: 0.6, ease: 'sine.inOut' }, '<')
        // Les cartes sortent par l'ouverture, de celle du fond à celle du dessus.
        .addLabel('rise', '-=0.35')
        .add(() => playDeal(0), 'rise')
        .fromTo(
          [...emerged].reverse(),
          { y: 0, rotation: 0 },
          { y: -rise, rotation: (index: number) => fanOf(emerged.length - 1 - index), duration: 0.9, ease: 'power2.out', stagger: 0.18 },
          'rise',
        )
        // Le paquet descend et s'efface sous les cartes, qui achèvent de sortir.
        .addLabel('drop', '+=0.2')
        .to(emerged, { y: -rise - lift, duration: 0.8, ease: 'sine.out' }, 'drop')
        .to('[data-pack-drop]', { y: height * 1.15, duration: 0.85, ease: 'power2.in' }, 'drop')
        .to('[data-pack-drop]', { autoAlpha: 0, duration: 0.3, ease: 'power1.in' }, 'drop+=0.55')
        .to('[data-pack-shadow]', { scale: 0.2, autoAlpha: 0, duration: 0.5 }, 'drop')
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
    const pack = rootRef.current?.querySelector('[data-pack-float]')?.getBoundingClientRect()
    // Étincelles au point de coupe, tant que le doigt avance.
    if (pack && progress > 0.02 && now - state.lastSpark > 70) {
      state.lastSpark = now
      onSparks(pack.left + pack.width * progress, pack.top + (pack.height * TEAR_Y) / 100, 10)
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
    // Au-dessus de la légende qui suit : le paquet qui s'efface vers le bas passe devant elle.
    <div ref={rootRef} className="relative z-[1] flex flex-col items-center">
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
          <div data-pack-float className="relative h-full w-full" style={{ willChange: 'transform' }}>
            {/*
              De l'arrière vers l'avant : l'aura, l'intérieur du paquet, les cartes rangées dedans, la
              face du paquet, puis son haut — la pièce qu'on déchire. Le haut et la face sont le même
              dessin, coupé le long d'un bord de papier irrégulier : à mesure que le doigt avance
              (\`--cut\`), le haut se décolle et se soulève depuis le point de coupe.
            */}
            <div data-pack-drop className="absolute inset-0">
              <BoosterPackArt width={width} halo={halo} lit={ready} series={series} layer="aura" />
            </div>
            <div
              data-pack-drop
              aria-hidden
              className="absolute inset-0"
              style={{ clipPath: MOUTH_CLIP, background: 'linear-gradient(180deg, #3a2240 0%, #120a1c 10%, #05030a 22%)' }}
            >
              <TornEdge points={BACK_TEAR} />
            </div>
            {torn &&
              Array.from({ length: Math.min(count, MAX_EMERGED) }, (_, index) => (
                <div
                  key={index}
                  data-emerge-card
                  aria-hidden
                  className="pointer-events-none absolute left-1/2"
                  style={{ top: height * CARDS_TOP, width: cardWidth, height: cardHeight, marginLeft: -cardWidth / 2, transformOrigin: '50% 100%', willChange: 'transform' }}
                >
                  <CardBack width={cardWidth} animated={false} />
                </div>
              ))}
            <div data-pack-drop className="absolute inset-0" style={{ clipPath: LOWER_CLIP }}>
              <BoosterPackArt width={width} lit={ready} series={series} layer="pack" />
            </div>
            <div data-pack-drop className="absolute inset-0" style={{ clipPath: `inset(-10% calc(100% - ${CUT_X}) -10% -10%)` }}>
              <TornEdge points={TEAR} />
            </div>
            <div data-pack-cap className="pointer-events-none absolute inset-0">
              <div
                className="absolute inset-0"
                style={{
                  clipPath: `inset(-60% calc(100% - ${CUT_X}) -60% -60%)`,
                  transformOrigin: `${CUT_X} ${TEAR_Y}%`,
                  transform: 'rotate(calc(var(--cut, 0) * 16deg)) translateY(calc(var(--cut, 0) * -5px))',
                }}
              >
                <div className="absolute inset-0" style={{ clipPath: CAP_CLIP }}>
                  <BoosterPackArt width={width} lit={ready} series={series} layer="pack" />
                </div>
                <TornEdge points={TEAR} />
              </div>
            </div>
            {/* Point de coupe : une étincelle suit le doigt le long de la déchirure. */}
            <div
              aria-hidden
              className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                top: `${TEAR_Y}%`,
                left: CUT_X,
                opacity: 'var(--cutting, 0)',
                background: 'radial-gradient(circle, #ffffff 0%, #fff4c8 30%, rgba(255,196,107,0.6) 55%, transparent 72%)',
              }}
            />
          </div>
        </div>
      </button>
      {/* Colonne de lumière qui jaillit du haut du paquet à l'arrachement (couleur du halo). */}
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
