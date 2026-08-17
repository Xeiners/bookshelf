import { useCallback, useEffect, useRef } from 'react'
import { setAmbientPaused } from '../../lib/ambient'
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

interface Slot {
  y: number
  scale: number
  rotate: number
  opacity: number
}

/** Position de repos de chaque niveau ; les `rotate` alternés « battent » la pile. */
const SLOTS: Slot[] = [
  { y: 0, scale: 1, rotate: 0, opacity: 1 },
  { y: -16, scale: 0.945, rotate: 3, opacity: 1 },
  { y: -28, scale: 0.89, rotate: -3.2, opacity: 1 },
  { y: -36, scale: 0.85, rotate: 1.5, opacity: 0 },
]

const slotAt = (depth: number): Slot => SLOTS[Math.min(depth, SLOTS.length - 1)]

type QuickTo = ReturnType<typeof gsap.quickTo>

/** Écrivain groupé : un seul recalcul de `transform` par frame. */
type CssSetter = (values: Record<string, number>) => void

type CommitFn = (direction: SwipeDirection, intent: SwipeIntent) => void

interface SwipeDeckProps {
  queue: Book[]
  cursor: number
  onDecision: (book: Book, intent: SwipeIntent) => void
  onOpen: (book: Book) => void
}

/**
 * Deck « Swipe & Match ».
 *
 * `Draggable` n'est pas attaché aux cartes mais à un proxy invisible couvrant la
 * scène, instancié une seule fois pour toute la vie du composant. Les transforms
 * des cartes restent ainsi la propriété exclusive de nos timelines : le geste ne
 * peut plus entrer en conflit avec l'animation de la pile. Le geste est ensuite
 * rendu à la main dans `render()`.
 */
export function SwipeDeck({ queue, cursor, onDecision, onOpen }: SwipeDeckProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const proxyRef = useRef<HTMLDivElement>(null)

  const visible = queue.slice(cursor, cursor + VISIBLE)
  const stackKey = visible.map((book) => book.id).join('|')
  const isEmpty = visible.length === 0

  // Miroirs lus par les callbacks GSAP, qui ne sont créés qu'une seule fois.
  const live = useRef({ cards: visible, animating: false, pendingId: null as string | null })
  const handlers = useRef({ onDecision, onOpen })

  useEffect(() => {
    live.current.cards = visible
    handlers.current = { onDecision, onOpen }

    /*
     * Ne PAS ré-armer le geste à la fin de l'animation d'éjection : React n'a
     * pas encore re-rendu, donc `live.cards[0]` désigne encore la carte partie
     * (invisible mais montée). Un appui dans cette fenêtre pilotait cette carte
     * fantôme pendant que la carte visible recevait l'animation « suivante ».
     */
    if (live.current.pendingId !== null && visible[0]?.id !== live.current.pendingId) {
      live.current.pendingId = null
      live.current.animating = false
    }
  })

  const placed = useRef(new Set<string>())
  const firstPaint = useRef(true)
  const commitRef = useRef<CommitFn | null>(null)

  // Idempotence sous <StrictMode> (mount → unmount → mount en dev) : sans cette
  // remise à zéro, l'entrée en éventail serait sautée au second montage.
  useEffect(
    () => () => {
      placed.current.clear()
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
        gsap.set(node, { zIndex: VISIBLE - depth })

        if (placed.current.has(book.id)) {
          gsap.to(node, {
            ...slot,
            x: 0,
            rotationX: 0,
            rotationY: 0,
            duration: DUR.base,
            ease: EASE.swift,
            overwrite: 'auto',
          })
          return
        }

        placed.current.add(book.id)
        gsap.set(node, {
          ...slot,
          x: 0,
          rotationX: 0,
          rotationY: 0,
          transformPerspective: 1100,
          transformOrigin: '50% 65%',
        })

        if (intro) {
          gsap.from(node, {
            y: slot.y + 120,
            scale: slot.scale * 0.88,
            rotate: slot.rotate * 4,
            autoAlpha: 0,
            duration: DUR.slow,
            delay: (VISIBLE - 1 - depth) * 0.08,
            ease: EASE.snap,
          })
        }
      })

      if (intro) firstPaint.current = false

      const ids = new Set(visible.map((book) => book.id))
      for (const id of placed.current) {
        if (!ids.has(id)) placed.current.delete(id)
      }
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
      let setCard: CssSetter | null = null
      let setLike: ((value: number) => void) | null = null
      let setSkip: ((value: number) => void) | null = null
      let nextY: QuickTo | null = null
      let nextScale: QuickTo | null = null
      let nextRotate: QuickTo | null = null
      let threshold = 140
      let ignore = false

      /** Résout les nœuds de la carte courante (appelé à chaque appui). */
      function bind() {
        card = live.current.cards[0]
        top = card ? nodeOf(card.id) : null
        cover = top?.querySelector<HTMLElement>('[data-cover]') ?? null
        sheen = top?.querySelector<HTMLElement>('[data-sheen]') ?? null
        likeStamp = top?.querySelector<HTMLElement>('[data-stamp="like"]') ?? null
        skipStamp = top?.querySelector<HTMLElement>('[data-stamp="skip"]') ?? null

        // La variante « css » écrit les 5 propriétés de transform en un seul
        // recalcul, là où `gsap.set` en ferait un par appel et allouerait.
        setCard = top ? (gsap.quickSetter(top, 'css') as CssSetter) : null
        setLike = likeStamp ? (gsap.quickSetter(likeStamp, 'opacity') as (v: number) => void) : null
        setSkip = skipStamp ? (gsap.quickSetter(skipStamp, 'opacity') as (v: number) => void) : null

        const nextCard = live.current.cards[1]
        const next = nextCard ? nodeOf(nextCard.id) : null
        if (next) {
          // `quickTo` lisse le suivi : la carte du dessous « respire ».
          nextY = gsap.quickTo(next, 'y', { duration: 0.35, ease: 'power2.out' })
          nextScale = gsap.quickTo(next, 'scale', { duration: 0.35, ease: 'power2.out' })
          nextRotate = gsap.quickTo(next, 'rotate', { duration: 0.35, ease: 'power2.out' })
        } else {
          nextY = null
          nextScale = null
          nextRotate = null
        }

        threshold = Math.min(150, stage.offsetWidth * 0.3)
      }

      /** Une frame de geste : le doigt pilote tout, sans interpolation. */
      function render(x: number, y: number) {
        if (!top || !setCard) return

        const progress = gsap.utils.clamp(-1, 1, x / threshold)
        const magnitude = Math.abs(progress)

        setCard({
          x,
          y,
          rotation: progress * 11,
          rotationY: progress * 9,
          rotationX: gsap.utils.clamp(-7, 7, -y / 26),
        })

        setLike?.(Math.max(0, progress))
        setSkip?.(Math.max(0, -progress))

        // Parallaxe : la couverture résiste au mouvement.
        if (cover) gsap.set(cover, { x: -x * 0.05, y: -y * 0.035 })
        if (sheen) gsap.set(sheen, { xPercent: progress * 42, opacity: magnitude * 0.55 })

        const from = slotAt(1)
        const to = slotAt(0)
        nextY?.(gsap.utils.interpolate(from.y, to.y, magnitude))
        nextScale?.(gsap.utils.interpolate(from.scale, to.scale, magnitude))
        nextRotate?.(gsap.utils.interpolate(from.rotate, to.rotate, magnitude))
      }

      function resetProxy() {
        gsap.set(proxy, { x: 0, y: 0 })
        // Draggable cache la position du proxy : il faut la resynchroniser.
        drag.update()
      }

      /** Geste insuffisant : retour élastique à la position de repos. */
      function settle() {
        if (top) {
          gsap.to(top, {
            x: 0,
            y: 0,
            rotate: 0,
            rotationX: 0,
            rotationY: 0,
            duration: DUR.slow,
            ease: EASE.spring,
            overwrite: 'auto',
          })
        }
        if (cover) gsap.to(cover, { x: 0, y: 0, duration: DUR.base, ease: EASE.swift })
        if (sheen) gsap.to(sheen, { xPercent: 0, opacity: 0, duration: DUR.fast })

        const stamps = [likeStamp, skipStamp].filter((node): node is HTMLElement => node !== null)
        if (stamps.length > 0) gsap.to(stamps, { opacity: 0, duration: DUR.micro })

        const rest = slotAt(1)
        nextY?.(rest.y)
        nextScale?.(rest.scale)
        nextRotate?.(rest.rotate)

        setAmbientPaused(false)
        resetProxy()
      }

      /** Fait monter toute la pile d'un cran, sans attendre l'état React. */
      function promote() {
        const cards = live.current.cards
        for (let index = 1; index < cards.length; index += 1) {
          const node = nodeOf(cards[index].id)
          if (!node) continue
          const slot = slotAt(index - 1)
          gsap.set(node, { zIndex: VISIBLE - (index - 1) })
          gsap.to(node, {
            ...slot,
            x: 0,
            rotationX: 0,
            rotationY: 0,
            duration: DUR.base,
            delay: (index - 1) * 0.03,
            ease: EASE.swift,
            overwrite: 'auto',
          })
        }
      }

      /** Éjecte la carte du dessus puis notifie le parent. */
      function commit(direction: SwipeDirection, intent: SwipeIntent) {
        if (live.current.animating) return
        bind()
        if (!card || !top) return

        const decided = card
        const currentY = (gsap.getProperty(top, 'y') as number) || 0
        live.current.animating = true
        // Levé par l'effet, une fois la pile React à jour (cf. plus haut).
        live.current.pendingId = decided.id
        setAmbientPaused(true)

        // Un « Lu » déclenché au bouton n'affiche aucun tampon de swipe.
        setLike?.(intent === 'wishlist' ? 1 : 0)
        setSkip?.(intent === 'skip' ? 1 : 0)
        vibrate(direction === 1 ? [10, 30, 14] : 12)

        gsap.to(top, {
          x: direction * (stage.offsetWidth * 1.25 + 140),
          y: currentY + 48,
          rotate: direction * 26,
          autoAlpha: 0,
          duration: 0.52,
          ease: EASE.exit,
          overwrite: 'auto',
          onComplete: () => {
            setAmbientPaused(false)
            resetProxy()
            handlers.current.onDecision(decided, intent)
          },
        })

        if (sheen) gsap.to(sheen, { opacity: 0, duration: DUR.fast })
        promote()
      }

      /** Arbitrage au relâchement : distance OU vélocité. */
      function decide() {
        const velocity = InertiaPlugin.getVelocity(proxy, 'x')
        const distance = drag.x
        const flicked = Math.abs(velocity) > FLICK_VELOCITY
        const pulled = Math.abs(distance) > threshold

        if (!pulled && !flicked) {
          settle()
          return
        }

        const reference = flicked ? velocity : distance
        const direction: SwipeDirection = reference >= 0 ? 1 : -1
        commit(direction, direction === 1 ? 'wishlist' : 'skip')
      }

      let drag!: Draggable
      const instances = Draggable.create(proxy, {
        type: 'x,y',
        allowContextMenu: true,
        dragResistance: 0.06,
        onPress() {
          // Un swipe est en cours d'éjection : on ignore ce geste-ci.
          ignore = live.current.animating
          if (ignore) return
          // Rien ne doit bouger derrière les éléments en `backdrop-filter`.
          setAmbientPaused(true)
          bind()
        },
        onDrag() {
          if (!ignore) render(drag.x, drag.y)
        },
        onDragEnd() {
          if (ignore) {
            resetProxy()
            return
          }
          decide()
        },
        onClick() {
          if (!ignore && card) handlers.current.onOpen(card)
        },
      })
      drag = instances[0]

      commitRef.current = commit

      // Retournée au contexte GSAP, qui l'exécute au démontage.
      return () => {
        commitRef.current = null
        setAmbientPaused(false)
        drag.kill()
        InertiaPlugin.untrack(proxy, 'x,y')
      }
    },
    { dependencies: [] },
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // La fiche détaillée est au-dessus : elle capte les touches.
      if (useUiStore.getState().detail !== null) return
      if (event.key === 'ArrowLeft') commitRef.current?.(-1, 'skip')
      else if (event.key === 'ArrowRight') commitRef.current?.(1, 'wishlist')
      else if (event.key === 'ArrowUp') commitRef.current?.(1, 'read')
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
        onRead={() => commitRef.current?.(1, 'read')}
        onSkip={() => commitRef.current?.(-1, 'skip')}
        onLike={() => commitRef.current?.(1, 'wishlist')}
        onInfo={openTop}
      />
    </div>
  )
}
