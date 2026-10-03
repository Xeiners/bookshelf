import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useT } from '../../i18n'
import type { Rarity } from '../../lib/boosters'
import type { CardSeries } from '../../services/cardsApi'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playCutTick } from '../../lib/sfx'
import { BoosterPackArt } from './BoosterPackArt'

/** Part de la largeur du paquet à parcourir du doigt pour découper toute la bande. */
const CUT_SPAN = 0.8
/** Relâché au-delà, la découpe se termine seule ; en deçà, la bande se recolle. */
const CUT_COMMIT = 0.75

interface BoosterOpeningAnimationProps {
  width: number
  /** Meilleure carte du booster, dès que le serveur l'a tiré : colore le halo. */
  halo: Rarity | null
  /** Le contenu est connu : la déchirure est possible. */
  ready: boolean
  /** Le booster est déchiré : l'animation de sortie se joue. */
  torn: boolean
  onTear: () => void
  /** Étincelles à cette position (pixels de la fenêtre) : pendant la découpe, et à l'arrachement. */
  onSparks: (x: number, y: number, count: number) => void
  /** Fin de l'animation de déchirure : les cartes peuvent jaillir. */
  onTorn: () => void
  /** Série du paquet (son illustration) ; `null` tant que la roulette n'a pas parlé. */
  series?: CardSeries | null
}

/**
 * L'artefact en suspens : le booster s'avance vers l'écran, flotte au-dessus
 * de son ombre portée, et s'entoure d'un halo à la couleur de sa meilleure
 * carte. Glisser vers la droite découpe la bande EN TEMPS RÉEL, sous le
 * doigt : la partie coupée se soulève, une étincelle suit la coupe. Au bout
 * (ou relâchée aux trois quarts), la bande s'arrache, une gerbe d'étincelles
 * jaillit, le paquet s'enfonce hors champ ; relâchée trop tôt, elle se recolle.
 */
export function BoosterOpeningAnimation({ width, halo, ready, torn, onTear, onSparks, onTorn, series = null }: BoosterOpeningAnimationProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  /** Découpe en cours : point de départ, avancement (0 → 1), dernières étincelles et vibrations. */
  const cut = useRef({ active: false, startX: 0, progress: 0, moved: false, lastSpark: 0, lastBuzz: 0, done: false })
  const height = Math.round(width * 1.55)

  // Arrivée vers l'écran, puis flottaison ; l'ombre au sol suit la hauteur du paquet.
  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      gsap.fromTo(
        '[data-pack-body]',
        { scale: 0.42, y: 90, rotationX: 28, transformPerspective: 1100, autoAlpha: 0 },
        { scale: 1, y: 0, rotationX: 0, autoAlpha: 1, duration: 1.15, ease: 'power3.out' },
      )
      gsap.fromTo('[data-pack-shadow]', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 0.7, duration: 1.15, ease: 'power3.out' })
      if (reduced) return
      gsap.to('[data-pack-float]', { y: -16, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 1.1 })
      gsap.to('[data-pack-shadow]', { scale: 0.78, autoAlpha: 0.38, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 1.1 })
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
