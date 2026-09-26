import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DUR, Draggable, EASE, InertiaPlugin, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { useUiStore } from '../../store/useUiStore'
import type { Book, SwipeDirection, SwipeIntent } from '../../types/book'
import { DeckActions } from './DeckActions'
import { SwipeCard } from './SwipeCard'

/** Nombre de cartes montées simultanément (la 4e est le tampon invisible). */
const VISIBLE = 4

/** Vitesse (px/s) à partir de laquelle un flick vaut décision, même court. */
const FLICK_VELOCITY = 620

/** En dessous de cette vitesse au relâchement, l'éjection part de l'arrêt. */
const THROW_VELOCITY = 400

/** z-index des cartes éjectées : au-dessus de la pile, sous le proxy (z-50). */
const EXIT_Z = 10

interface Slot {
  y: number
  scale: number
  rotation: number
  /** `autoAlpha` et non `opacity` : sinon un `visibility: hidden` peut rester collé. */
  autoAlpha: number
}

/** Position de repos de chaque niveau ; les rotations alternées « battent » la pile. */
const SLOTS: Slot[] = [
  { y: 0, scale: 1, rotation: 0, autoAlpha: 1 },
  { y: -16, scale: 0.945, rotation: 3, autoAlpha: 1 },
  { y: -28, scale: 0.89, rotation: -3.2, autoAlpha: 1 },
  { y: -36, scale: 0.85, rotation: 1.5, autoAlpha: 0 },
]

const slotAt = (depth: number): Slot => SLOTS[Math.min(depth, SLOTS.length - 1)]

/** Propriétés pilotées par le doigt sur la carte du dessus. */
const GESTURE_PROPS = 'x,y,rotation,rotationX,rotationY'

type QuickTo = ReturnType<typeof gsap.quickTo>

/** Écrivain groupé : un seul recalcul de `transform` par frame. */
type CssSetter = (values: Record<string, number>) => void

interface Velocity {
  x: number
  y: number
}

type CommitFn = (direction: SwipeDirection, intent: SwipeIntent, velocity?: Velocity) => void

interface SwipeDeckProps {
  queue: Book[]
  cursor: number
  onDecision: (book: Book, intent: SwipeIntent) => void
  onOpen: (book: Book) => void
  /** Le dernier choix (la carte juste avant `cursor`) peut être annulé. */
  canUndo: boolean
  /** Annule le choix sur `book` : le parent restaure la bibliothèque et recule le curseur. */
  onUndo: (book: Book) => void
}

/** Pose d'une carte hors de la pile : d'où elle revient quand on annule. */
interface Pose {
  x: number
  y: number
  rotation: number
  rotationX: number
  autoAlpha: number
}

/** Où chaque carte est partie, et avec quel choix (pour rejouer son tampon au retour). */
interface ExitRecord {
  pose: Pose
  intent: SwipeIntent
}

const STAMP_OF: Record<SwipeIntent, string> = { wishlist: 'like', skip: 'skip', read: 'read' }

/**
 * Deck « Swipe & Match ».
 *
 * `Draggable` n'est pas attaché aux cartes mais à un proxy invisible couvrant la
 * scène, instancié une seule fois pour toute la vie du composant. Le geste est
 * rendu à la main dans `render()`.
 *
 * Une carte décidée est notifiée au parent immédiatement puis conservée dans
 * `exiting` le temps de son animation de sortie : la carte suivante devient
 * aussitôt la carte du dessus et peut être saisie sans aucun verrou.
 *
 * Annuler ramène la carte précédente sur le dessus de la pile, depuis là où elle
 * est partie (ou depuis sa position en plein vol si sa sortie n'est pas finie).
 */
export function SwipeDeck({ queue, cursor, onDecision, onOpen, canUndo, onUndo }: SwipeDeckProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const proxyRef = useRef<HTMLDivElement>(null)

  const [exiting, setExiting] = useState<Book[]>([])
  const exitingIds = useRef(new Set<string>())
  const exits = useRef(new Map<string, ExitRecord>())
  /** Carte en train de revenir : consommée par la mise en place de la pile. */
  const returning = useRef<{ id: string; from: Pose; intent: SwipeIntent | null } | null>(null)

  const visible = queue
    .slice(cursor, cursor + VISIBLE)
    .filter((book) => !exiting.some((gone) => gone.id === book.id))
  const stackKey = visible.map((book) => book.id).join('|')
  const isEmpty = visible.length === 0

  // Miroirs lus par les callbacks GSAP, qui ne sont créés qu'une seule fois.
  // Synchronisés en layout effect : prêts avant le prochain événement pointeur.
  const live = useRef({ cards: visible })
  const handlers = useRef({ onDecision, onOpen })
  useLayoutEffect(() => {
    live.current.cards = visible
    handlers.current = { onDecision, onOpen }
  })

  const placedDepth = useRef(new Map<string, number>())
  const firstPaint = useRef(true)
  const commitRef = useRef<CommitFn | null>(null)

  // Idempotence sous <StrictMode> (mount → unmount → mount en dev) : sans cette
  // remise à zéro, l'entrée en éventail serait sautée au second montage.
  useEffect(
    () => () => {
      placedDepth.current.clear()
      firstPaint.current = true
    },
    [],
  )

  const nodeOf = useCallback(
    (id: string) => stageRef.current?.querySelector<HTMLDivElement>(`[data-card="${id}"]`) ?? null,
    [],
  )

  useGSAP(
    () => {
      const intro = firstPaint.current && visible.length > 0

      visible.forEach((book, depth) => {
        const node = nodeOf(book.id)
        if (!node) return

        const slot = slotAt(depth)
        const previousDepth = placedDepth.current.get(book.id)
        gsap.set(node, { zIndex: VISIBLE - depth })

        // Un simple append au bout de la file peut modifier `stackKey`. Si cette
        // carte n'a pas changé de profondeur, ne surtout pas toucher à son
        // transform : elle peut être en train de suivre le doigt.
        if (previousDepth === depth) return

        if (previousDepth !== undefined) {
          gsap.to(node, {
            ...slot,
            x: 0,
            rotationX: 0,
            rotationY: 0,
            duration: DUR.base,
            delay: depth * 0.03,
            ease: EASE.swift,
            overwrite: 'auto',
          })
          return
        }

        gsap.set(node, {
          ...slot,
          x: 0,
          rotationX: 0,
          rotationY: 0,
          transformPerspective: 1100,
          transformOrigin: '50% 65%',
        })

        const back = returning.current
        if (back && back.id === book.id) {
          returning.current = null
          // Retour arrière : la carte revient d'où elle est partie.
          gsap.fromTo(node, back.from, {
            ...slot,
            x: 0,
            rotationX: 0,
            duration: 0.55,
            ease: EASE.snap,
            overwrite: 'auto',
          })
          // Son tampon s'efface pendant le retour : on voit ce qui est annulé.
          const stamp = back.intent ? node.querySelector(`[data-stamp="${STAMP_OF[back.intent]}"]`) : null
          if (stamp) gsap.fromTo(stamp, { opacity: 1 }, { opacity: 0, duration: 0.4, delay: 0.15 })
          return
        }

        if (intro) {
          gsap.from(node, {
            y: slot.y + 120,
            scale: slot.scale * 0.88,
            rotation: slot.rotation * 4,
            autoAlpha: 0,
            duration: DUR.slow,
            delay: (VISIBLE - 1 - depth) * 0.08,
            ease: EASE.snap,
          })
        } else if (slot.autoAlpha > 0) {
          // Carte arrivée par un renfort alors que la pile était courte.
          gsap.from(node, { autoAlpha: 0, y: slot.y - 12, duration: DUR.fast, ease: EASE.swift })
        }
      })

      if (intro) firstPaint.current = false

      placedDepth.current = new Map(visible.map((book, depth) => [book.id, depth]))
    },
    { dependencies: [stackKey], scope: stageRef },
  )

  useGSAP(
    () => {
      const stageNode = stageRef.current
      const proxyNode = proxyRef.current
      if (!stageNode || !proxyNode) return

      // TypeScript ne propage pas le narrowing d'un `const` dans le corps des
      // `function` déclarées (hoisting) : on fige donc les types ici.
      const stage: HTMLDivElement = stageNode
      const proxy: HTMLDivElement = proxyNode

      // Sans `track`, pas de vélocité lisible au relâchement.
      InertiaPlugin.track(proxy, 'x,y')

      let card: Book | undefined
      let top: HTMLDivElement | null = null
      let cover: HTMLElement | null = null
      let sheen: HTMLElement | null = null
      let likeStamp: HTMLElement | null = null
      let skipStamp: HTMLElement | null = null
      let readStamp: HTMLElement | null = null
      let setCard: CssSetter | null = null
      let setCover: CssSetter | null = null
      let setSheen: CssSetter | null = null
      let setLike: ((value: number) => void) | null = null
      let setSkip: ((value: number) => void) | null = null
      let setRead: ((value: number) => void) | null = null
      let nextY: QuickTo | null = null
      let nextScale: QuickTo | null = null
      let nextRotate: QuickTo | null = null
      /*
       * Lueurs de la scène, côté écran : nœuds fixes (pas liés à une carte),
       * résolus une fois. Le côté vers lequel on glisse s'illumine.
       */
      const glowNodes = gsap.utils.toArray<HTMLElement>('[data-glow]', stage)
      const glowOf = (name: string) => glowNodes.find((node) => node.dataset.glow === name)
      const opacitySetter = (node: HTMLElement | undefined) =>
        node ? (gsap.quickSetter(node, 'opacity') as (value: number) => void) : () => {}
      const glowLike = opacitySetter(glowOf('like'))
      const glowSkip = opacitySetter(glowOf('skip'))
      const glowRead = opacitySetter(glowOf('read'))
      const fadeGlows = (duration: number) => {
        if (glowNodes.length > 0) gsap.to(glowNodes, { opacity: 0, duration, ease: 'power2.out', overwrite: true })
      }

      let threshold = 140
      /** Distance à parcourir vers le haut pour marquer « Lu ». */
      let thresholdUp = 150
      let exitCount = 0

      /*
       * Position de la carte au moment de l'appui, relative au repos. Si on
       * l'attrape en pleine promotion ou en plein retour élastique, on coupe
       * cette animation et l'écart est résorbé en douceur : ni saut, ni deux
       * écrivains concurrents sur le même transform.
       */
      const base = { x: 0, y: 0, r: 0, rx: 0, ry: 0 }
      let baseTween: gsap.core.Tween | null = null
      let lastX = 0
      let lastY = 0

      /** Résout les nœuds de la carte du dessus. */
      function resolve() {
        card = live.current.cards[0]
        if (card && exitingIds.current.has(card.id)) card = undefined
        top = card ? nodeOf(card.id) : null
        cover = top?.querySelector<HTMLElement>('[data-cover]') ?? null
        sheen = top?.querySelector<HTMLElement>('[data-sheen]') ?? null
        likeStamp = top?.querySelector<HTMLElement>('[data-stamp="like"]') ?? null
        skipStamp = top?.querySelector<HTMLElement>('[data-stamp="skip"]') ?? null
        readStamp = top?.querySelector<HTMLElement>('[data-stamp="read"]') ?? null

        // La variante « css » écrit les 5 propriétés de transform en un seul
        // recalcul, là où `gsap.set` en ferait un par appel et allouerait.
        setCard = top ? (gsap.quickSetter(top, 'css') as CssSetter) : null
        setCover = cover ? (gsap.quickSetter(cover, 'css') as CssSetter) : null
        setSheen = sheen ? (gsap.quickSetter(sheen, 'css') as CssSetter) : null
        setLike = likeStamp ? (gsap.quickSetter(likeStamp, 'opacity') as (v: number) => void) : null
        setSkip = skipStamp ? (gsap.quickSetter(skipStamp, 'opacity') as (v: number) => void) : null
        setRead = readStamp ? (gsap.quickSetter(readStamp, 'opacity') as (v: number) => void) : null
      }

      function restNext() {
        const rest = slotAt(1)
        nextY?.(rest.y)
        nextScale?.(rest.scale)
        nextRotate?.(rest.rotation)
      }

      /** Prépare un geste : le doigt devient l'unique propriétaire de la carte. */
      function bind() {
        resolve()
        lastX = 0
        lastY = 0
        baseTween?.kill()
        baseTween = null

        if (top) {
          base.x = Number(gsap.getProperty(top, 'x')) || 0
          base.y = Number(gsap.getProperty(top, 'y')) || 0
          base.r = Number(gsap.getProperty(top, 'rotation')) || 0
          base.rx = Number(gsap.getProperty(top, 'rotationX')) || 0
          base.ry = Number(gsap.getProperty(top, 'rotationY')) || 0
          // Seules les propriétés du geste sont reprises : une promotion en
          // cours termine normalement son `scale` et son `autoAlpha`.
          gsap.killTweensOf(top, GESTURE_PROPS)
          baseTween = gsap.to(base, {
            x: 0,
            y: 0,
            r: 0,
            rx: 0,
            ry: 0,
            duration: 0.3,
            ease: 'power2.out',
            onUpdate: () => render(lastX, lastY),
          })
        }

        const decor = [cover, sheen, likeStamp, skipStamp, readStamp].filter(
          (node): node is HTMLElement => node !== null,
        )
        if (decor.length > 0) gsap.killTweensOf(decor)
        // Le doigt reprend la main sur les lueurs (fondu du choix précédent coupé).
        if (glowNodes.length > 0) gsap.killTweensOf(glowNodes)

        const nextCard = live.current.cards[1]
        const next = nextCard ? nodeOf(nextCard.id) : null
        if (next) {
          gsap.killTweensOf(next, 'y,scale,rotation')
          // `quickTo` lisse le suivi : la carte du dessous « respire ».
          nextY = gsap.quickTo(next, 'y', { duration: 0.35, ease: 'power2.out' })
          nextScale = gsap.quickTo(next, 'scale', { duration: 0.35, ease: 'power2.out' })
          nextRotate = gsap.quickTo(next, 'rotation', { duration: 0.35, ease: 'power2.out' })
          // Termine la promotion interrompue jusqu'au repos.
          restNext()
        } else {
          nextY = null
          nextScale = null
          nextRotate = null
        }

        threshold = Math.min(150, stage.offsetWidth * 0.3)
        thresholdUp = Math.min(170, stage.offsetHeight * 0.24)
      }

      /**
       * Part « vers le haut » du geste, de 0 à 1 : nulle tant que l'horizontale
       * domine, pour qu'un swipe gauche/droite légèrement montant ne vire pas au « Lu ».
       */
      function upwardness(x: number, y: number) {
        const lift = -y - Math.abs(x)
        if (lift <= 0) return 0
        return gsap.utils.clamp(0, 1, -y / thresholdUp) * gsap.utils.clamp(0, 1, lift / 40)
      }

      /** Une frame de geste : le doigt pilote tout, sans interpolation. */
      function render(x: number, y: number) {
        if (!top || !setCard) return
        lastX = x
        lastY = y

        const progress = gsap.utils.clamp(-1, 1, x / threshold)
        const up = upwardness(x, y)
        // La carte suivante monte aussi bien vers « Lu » que vers les côtés.
        const magnitude = Math.max(Math.abs(progress), up)

        setCard({
          x: base.x + x,
          y: base.y + y,
          rotation: base.r + progress * 11,
          rotationY: base.ry + progress * 9,
          rotationX: base.rx + gsap.utils.clamp(-7, 7, -y / 26),
        })

        // Un seul tampon lisible à la fois : « Lu » efface les deux autres.
        const like = Math.max(0, progress) * (1 - up)
        const nope = Math.max(0, -progress) * (1 - up)
        setLike?.(like)
        setSkip?.(nope)
        setRead?.(up)
        glowLike(like)
        glowSkip(nope)
        glowRead(up)

        // Parallaxe : la couverture résiste au mouvement.
        setCover?.({ x: -x * 0.05, y: -y * 0.035 })
        setSheen?.({ xPercent: progress * 42, opacity: Math.abs(progress) * 0.55 })

        const from = slotAt(1)
        const to = slotAt(0)
        nextY?.(gsap.utils.interpolate(from.y, to.y, magnitude))
        nextScale?.(gsap.utils.interpolate(from.scale, to.scale, magnitude))
        nextRotate?.(gsap.utils.interpolate(from.rotation, to.rotation, magnitude))
      }

      function resetProxy() {
        gsap.set(proxy, { x: 0, y: 0 })
        // Draggable cache la position du proxy : il faut la resynchroniser.
        drag.update()
      }

      /** Geste insuffisant : retour élastique à la position de repos. */
      function settle() {
        baseTween?.kill()
        baseTween = null
        base.x = base.y = base.r = base.rx = base.ry = 0

        if (top) {
          gsap.to(top, {
            x: 0,
            y: 0,
            rotation: 0,
            rotationX: 0,
            rotationY: 0,
            duration: DUR.slow,
            ease: EASE.spring,
            overwrite: 'auto',
          })
        }
        if (cover) gsap.to(cover, { x: 0, y: 0, duration: DUR.base, ease: EASE.swift })
        if (sheen) gsap.to(sheen, { xPercent: 0, opacity: 0, duration: DUR.fast })

        const stamps = [likeStamp, skipStamp, readStamp].filter((node): node is HTMLElement => node !== null)
        if (stamps.length > 0) gsap.to(stamps, { opacity: 0, duration: DUR.micro })

        fadeGlows(DUR.fast)
        restNext()
        resetProxy()
      }

      /**
       * Éjecte la carte du dessus et notifie le parent sur-le-champ. `velocity`
       * n'est fourni que par un geste : l'éjection prolonge alors l'élan du doigt
       * au lieu de repartir de l'arrêt.
       */
      function commit(direction: SwipeDirection, intent: SwipeIntent, velocity?: Velocity) {
        if (!velocity) resolve()
        if (!card || !top) return

        const decided = card
        const node = top
        exitingIds.current.add(decided.id)
        placedDepth.current.delete(decided.id)
        // Repère pour les tests : la carte du dessus est le premier
        // `[data-card]:not([data-exiting])` dans l'ordre du DOM.
        node.dataset.exiting = ''

        baseTween?.kill()
        baseTween = null
        gsap.killTweensOf(node)

        // Le tampon de la décision, quel que soit le déclencheur (geste, bouton, clavier).
        setLike?.(intent === 'wishlist' ? 1 : 0)
        setSkip?.(intent === 'skip' ? 1 : 0)
        setRead?.(intent === 'read' ? 1 : 0)
        if (sheen) gsap.to(sheen, { opacity: 0, duration: DUR.fast })
        // Le côté choisi flashe puis s'éteint (geste, bouton ou clavier).
        if (glowNodes.length > 0) gsap.killTweensOf(glowNodes)
        glowLike(intent === 'wishlist' ? 1 : 0)
        glowSkip(intent === 'skip' ? 1 : 0)
        glowRead(intent === 'read' ? 1 : 0)
        fadeGlows(0.55)
        vibrate(intent === 'skip' ? 12 : [10, 30, 14])

        // Chaque nouvelle carte éjectée passe devant les précédentes.
        exitCount += 1
        gsap.set(node, { zIndex: EXIT_Z + exitCount })

        const currentX = Number(gsap.getProperty(node, 'x')) || 0
        const currentY = Number(gsap.getProperty(node, 'y')) || 0
        const currentRotation = Number(gsap.getProperty(node, 'rotation')) || 0

        let exit: gsap.TweenVars
        let thrown: boolean
        let duration: number

        if (intent === 'read') {
          // « Lu » : la carte s'envole par le haut, en gardant sa dérive latérale.
          const targetY = -(stage.offsetHeight * 1.2 + 160)
          const speed = velocity ? -velocity.y : 0
          thrown = speed > THROW_VELOCITY
          duration = thrown ? gsap.utils.clamp(0.16, 0.45, Math.abs(targetY - currentY) / speed) : 0.5
          const driftX = thrown && velocity ? gsap.utils.clamp(-160, 160, velocity.x * duration) : 0
          exit = { x: currentX + driftX, y: targetY, rotation: currentRotation * 0.5, rotationX: 18 }
        } else {
          const targetX = direction * (stage.offsetWidth * 1.25 + 140)
          const speed = velocity ? velocity.x * direction : 0
          thrown = speed > THROW_VELOCITY
          // Lancée : mouvement linéaire à la vitesse du doigt, donc aucune
          // rupture au relâchement. Sinon : départ de l'arrêt, en accélération.
          duration = thrown ? gsap.utils.clamp(0.16, 0.45, Math.abs(targetX - currentX) / speed) : 0.48
          const driftY = thrown && velocity ? gsap.utils.clamp(-220, 220, velocity.y * duration) : 48
          exit = { x: targetX, y: currentY + driftY, rotation: direction * 26 }
        }

        // Mémorisé pour un éventuel retour arrière.
        exits.current.set(decided.id, {
          pose: {
            x: Number(exit.x),
            y: Number(exit.y),
            rotation: Number(exit.rotation),
            rotationX: Number(exit.rotationX ?? 0),
            autoAlpha: 0,
          },
          intent,
        })

        gsap.to(node, {
          ...exit,
          duration,
          ease: thrown ? 'none' : EASE.exit,
          onComplete: () => {
            exitingIds.current.delete(decided.id)
            setExiting((previous) => previous.filter((book) => book.id !== decided.id))
          },
        })
        // Fondu séparé : sa courbe reste la même quelle que soit la vitesse.
        gsap.to(node, { autoAlpha: 0, duration, ease: 'power1.in' })

        // La carte n'appartient plus au geste.
        card = undefined
        top = null
        setCard = null
        resetProxy()

        setExiting((previous) => [...previous, decided])
        handlers.current.onDecision(decided, intent)
      }

      /** Arbitrage au relâchement : distance OU vélocité. */
      function decide() {
        if (!card || !top) {
          resetProxy()
          return
        }

        const velocity = {
          x: InertiaPlugin.getVelocity(proxy, 'x'),
          y: InertiaPlugin.getVelocity(proxy, 'y'),
        }
        // Vers le haut d'abord : distance verticale dominante, ou flick vertical.
        const liftedUp = -drag.y > thresholdUp && -drag.y > Math.abs(drag.x)
        const flickedUp =
          -velocity.y > FLICK_VELOCITY && -velocity.y > Math.abs(velocity.x) && Math.abs(drag.x) < threshold
        if (liftedUp || flickedUp) {
          commit(1, 'read', velocity)
          return
        }

        const distance = drag.x
        const flicked = Math.abs(velocity.x) > FLICK_VELOCITY
        const pulled = Math.abs(distance) > threshold

        if (!pulled && !flicked) {
          settle()
          return
        }

        const reference = flicked ? velocity.x : distance
        const direction: SwipeDirection = reference >= 0 ? 1 : -1
        commit(direction, direction === 1 ? 'wishlist' : 'skip', velocity)
      }

      let drag!: Draggable
      const instances = Draggable.create(proxy, {
        type: 'x,y',
        allowContextMenu: true,
        dragResistance: 0.06,
        onPress() {
          bind()
        },
        onDrag() {
          render(drag.x, drag.y)
        },
        onDragEnd() {
          decide()
        },
        onClick() {
          if (!card || !top) return
          // Un simple appui a pu interrompre une promotion : on la termine.
          settle()
          handlers.current.onOpen(card)
        },
      })
      drag = instances[0]

      commitRef.current = commit

      // Retournée au contexte GSAP, qui l'exécute au démontage.
      return () => {
        commitRef.current = null
        baseTween?.kill()
        drag.kill()
        InertiaPlugin.untrack(proxy, 'x,y')
      }
    },
    { dependencies: [] },
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Une feuille modale est au-dessus : elle capte les touches.
      const ui = useUiStore.getState()
      if (ui.detail !== null || ui.authOpen || ui.reader !== null || ui.filesOpen) return
      // Les flèches déplacent le curseur d'un champ, elles ne jugent pas une carte.
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return
      if (event.repeat) return
      if (event.key === 'ArrowLeft') commitRef.current?.(-1, 'skip')
      else if (event.key === 'ArrowRight') commitRef.current?.(1, 'wishlist')
      else if (event.key === 'ArrowUp') commitRef.current?.(1, 'read')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const undo = () => {
    const book = queue[cursor - 1]
    if (!canUndo || !book) return
    const record = exits.current.get(book.id)
    exits.current.delete(book.id)

    // Deck remonté depuis (changement d'étagère) : retour par le haut, en fondu.
    let from: Pose = record?.pose ?? { x: 0, y: -160, rotation: 0, rotationX: 0, autoAlpha: 0 }

    // Sortie pas encore finie : on la coupe, et la carte repart de là où elle est.
    const flying = exitingIds.current.has(book.id) ? nodeOf(book.id) : null
    if (flying) {
      gsap.killTweensOf(flying)
      from = {
        x: Number(gsap.getProperty(flying, 'x')) || 0,
        y: Number(gsap.getProperty(flying, 'y')) || 0,
        rotation: Number(gsap.getProperty(flying, 'rotation')) || 0,
        rotationX: Number(gsap.getProperty(flying, 'rotationX')) || 0,
        autoAlpha: Number(gsap.getProperty(flying, 'autoAlpha')) || 0,
      }
      exitingIds.current.delete(book.id)
      setExiting((previous) => previous.filter((gone) => gone.id !== book.id))
    }

    returning.current = { id: book.id, from, intent: record?.intent ?? null }
    vibrate(8)
    onUndo(book)
  }

  // Ctrl/⌘ + Z : annuler le dernier choix. Relu à chaque rendu (`undo` suit la file).
  const undoRef = useRef(undo)
  useLayoutEffect(() => {
    undoRef.current = undo
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return
      const ui = useUiStore.getState()
      if (ui.detail !== null || ui.authOpen || ui.reader !== null || ui.filesOpen) return
      // Dans un champ de saisie, Ctrl+Z annule la frappe, pas un swipe.
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return
      event.preventDefault()
      undoRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const openTop = () => {
    const card = live.current.cards[0]
    if (card) handlers.current.onOpen(card)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sur grand écran la carte ne s'étire pas : elle garde sa proportion. */}
      <div
        ref={stageRef}
        className="relative mx-auto min-h-0 w-full max-w-[26rem] flex-1 [perspective:1100px]"
      >
        {/* Lueurs de bord d'écran, sous les cartes : débordent dans la marge de la page. */}
        <div
          data-glow="skip"
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-5 w-2/5 opacity-0"
          style={{ background: 'radial-gradient(ellipse 100% 60% at 0% 50%, color-mix(in oklab, var(--color-nope) 55%, transparent), transparent)' }}
        />
        <div
          data-glow="like"
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -right-5 w-2/5 opacity-0"
          style={{ background: 'radial-gradient(ellipse 100% 60% at 100% 50%, color-mix(in oklab, var(--color-like) 55%, transparent), transparent)' }}
        />
        <div
          data-glow="read"
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-8 h-2/5 opacity-0"
          style={{ background: 'radial-gradient(ellipse 60% 100% at 50% 0%, color-mix(in oklab, var(--color-gold) 55%, transparent), transparent)' }}
        />

        {/* Rendues en premier : l'ordre DOM ne bouge pas quand une carte quitte la pile. */}
        {exiting.map((book) => (
          <SwipeCard key={book.id} book={book} depth={0} />
        ))}
        {visible.map((book, depth) => (
          <SwipeCard key={book.id} book={book} depth={depth} />
        ))}

        {/* Proxy de drag — invisible, couvre la scène, cible unique de Draggable */}
        <div
          ref={proxyRef}
          aria-hidden
          className={`absolute inset-0 z-50 touch-none ${
            isEmpty ? 'pointer-events-none' : 'cursor-grab active:cursor-grabbing'
          }`}
        />
      </div>

      <DeckActions
        disabled={isEmpty}
        canUndo={canUndo}
        onUndo={undo}
        onRead={() => commitRef.current?.(1, 'read')}
        onSkip={() => commitRef.current?.(-1, 'skip')}
        onLike={() => commitRef.current?.(1, 'wishlist')}
        onInfo={openTop}
      />
    </div>
  )
}
