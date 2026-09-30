import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { ZoomOut } from 'lucide-react'
import { usePinch } from '../../hooks/reader/usePinch'
import { useT } from '../../i18n'
import { EASE, gsap } from '../../lib/gsap'
import { buildSpreads, spreadIndexOf, swipeAction, tapAction } from '../../lib/reader/navigation'
import { pagedRatio } from '../../lib/reader/progress'
import type { ReaderPage, ReaderViewController, ReadingDirection, SpreadMode, ViewPosition } from '../../types/reader'
import { PageImage } from './PageImage'

/** Largeur minimale (en paysage) pour la double page automatique : tablette, ordinateur. */
const DOUBLE_MIN_WIDTH = 900
const MAX_ZOOM = 4
/** Référence stable (dépendance d'effet) quand le chapitre n'a aucune page. */
const NO_SPREAD: number[] = []
/** Planches montées de part et d'autre de la planche affichée : prêtes (décodées) avant d'arriver. */
const NEIGHBOURS = [-1, 0, 1] as const
/** Glissement d'une planche à la suivante, en secondes. */
const SLIDE_DURATION = 0.3
/** Au-delà de la première ou de la dernière planche, le doigt ne tire plus qu'un peu (élastique). */
const EDGE_RESISTANCE = 0.3

interface PagedViewProps {
  pages: ReaderPage[]
  direction: ReadingDirection
  spreadMode: SpreadMode
  startPage: number
  controllerRef: RefObject<ReaderViewController | null>
  onPosition: (position: ViewPosition) => void
  onEnd: () => void
  onMenu: () => void
  onInteract: () => void
  /** « Suivant » depuis la dernière planche : chapitre suivant. */
  onBeyondEnd: () => void
  /** « Précédent » depuis la première planche : chapitre précédent. */
  onBeforeStart: () => void
  /** Surimpression (pastille « Chapitre suivant → » en fin de chapitre). */
  overlay?: ReactNode
}

interface Zoom {
  scale: number
  x: number
  y: number
}

interface Gesture {
  id: number
  x0: number
  y0: number
  t0: number
  lastX: number
  lastY: number
  moved: boolean
}

/**
 * Mode paginé (manga, BD, comics) : une page, ou une double page sur grand
 * écran ; sens japonais ou occidental. On tourne la page par swipe, flèches
 * clavier ou tap sur les tiers latéraux ; le centre affiche les commandes.
 * Pincer zoome (un doigt déplace alors la page au lieu de la tourner).
 *
 * Carrousel : la planche précédente et la suivante sont montées à côté de
 * celle affichée (images déjà décodées). Tourner la page fait glisser la
 * piste — une transformation, jamais de passage par le noir — puis la planche
 * arrivée garde le même élément `<img>` (clé = numéro de planche) : rien à
 * recharger ni à redécoder, donc aucun clignotement.
 */
export function PagedView({
  pages,
  direction,
  spreadMode,
  startPage,
  controllerRef,
  onPosition,
  onEnd,
  onMenu,
  onInteract,
  onBeyondEnd,
  onBeforeStart,
  overlay,
}: PagedViewProps) {
  const t = useT()
  const stageRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)

  /** Première page de la planche affichée : survit au passage simple ⇄ double page. */
  const [page, setPage] = useState(() => Math.min(Math.max(0, startPage), Math.max(0, pages.length - 1)))
  const [double, setDouble] = useState(false)
  const [zoomed, setZoomed] = useState(false)

  const spreads = useMemo(() => buildSpreads(pages.length, double), [pages.length, double])
  const index = spreadIndexOf(spreads, page)
  const spread = spreads[index] ?? NO_SPREAD
  const atEnd = index === spreads.length - 1
  /** Sens visuel : en sens japonais, la planche suivante est à gauche. */
  const sign = direction === 'rtl' ? -1 : 1

  const zoom = useRef<Zoom>({ scale: 1, x: 0, y: 0 })
  const pinchBase = useRef<Zoom | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Set<number>())
  /** Glissement en cours vers la planche `target`. */
  const sliding = useRef<{ tween: gsap.core.Tween; target: number } | null>(null)
  /** Tap reçu pendant un glissement : joué dès que la planche est arrivée. */
  const queued = useRef<1 | -1 | null>(null)

  const latest = useRef({ onPosition, onEnd, onBeyondEnd, onBeforeStart, onInteract })
  useEffect(() => {
    latest.current = { onPosition, onEnd, onBeyondEnd, onBeforeStart, onInteract }
  })

  // Double page : choisie, ou automatique sur un écran large en paysage.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry?.contentRect ?? { width: 0, height: 0 }
      setDouble(spreadMode === 'double' || (spreadMode === 'auto' && width >= DOUBLE_MIN_WIDTH && width > height))
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [spreadMode])

  // Position rapportée à chaque planche ; la dernière termine le chapitre.
  useEffect(() => {
    if (spread.length === 0) return
    latest.current.onPosition({ page: spread[0] ?? 0, offset: 0, ratio: pagedRatio(Math.max(...spread), pages.length) })
    if (atEnd) latest.current.onEnd()
  }, [spread, atEnd, pages.length])

  /* ---- Zoom -------------------------------------------------------------- */

  const clampZoom = (next: Zoom): Zoom => {
    const stage = stageRef.current
    const scale = Math.min(MAX_ZOOM, Math.max(1, next.scale))
    const maxX = ((scale - 1) * (stage?.clientWidth ?? 0)) / 2
    const maxY = ((scale - 1) * (stage?.clientHeight ?? 0)) / 2
    return { scale, x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) }
  }

  const applyZoom = (next: Zoom, animate = false) => {
    zoom.current = clampZoom(next)
    if (animate) gsap.to(zoomRef.current, { ...zoom.current, duration: 0.3, ease: EASE.swift, overwrite: 'auto' })
    else gsap.set(zoomRef.current, zoom.current)
    setZoomed(zoom.current.scale > 1.01)
  }

  const resetZoom = (animate = true) => applyZoom({ scale: 1, x: 0, y: 0 }, animate)

  usePinch(stageRef, {
    onPinch: (factor, center) => {
      const stage = stageRef.current
      if (!stage) return
      pinchBase.current ??= { ...zoom.current }
      const base = pinchBase.current
      const box = stage.getBoundingClientRect()
      // Zoom centré sur les doigts : le point pincé reste sous les doigts.
      const px = center.x - (box.left + box.width / 2)
      const py = center.y - (box.top + box.height / 2)
      const scale = Math.min(MAX_ZOOM, Math.max(1, base.scale * factor))
      const ratio = scale / base.scale
      applyZoom({ scale, x: px - (px - base.x) * ratio, y: py - (py - base.y) * ratio })
    },
    onPinchEnd: () => {
      pinchBase.current = null
      if (zoom.current.scale < 1.05) resetZoom()
    },
  })

  /* ---- Changement de planche ---------------------------------------------- */

  /** Planche arrivée : l'état suit, la piste revient à zéro dans la même image (cf. l'effet ci-dessous). */
  const arrive = (target: number) => {
    sliding.current = null
    setPage(spreads[target]?.[0] ?? 0)
  }

  const navigate = (step: 1 | -1) => {
    // Tap pendant un glissement : la planche en route arrive d'un coup, puis la suivante part.
    if (sliding.current) {
      const { tween, target } = sliding.current
      tween.kill()
      queued.current = step
      arrive(target)
      return
    }
    const target = index + step
    if (target >= spreads.length || target < 0) {
      gsap.to(trackRef.current, { x: 0, duration: 0.3, ease: EASE.swift, overwrite: 'auto' })
      if (target >= spreads.length) latest.current.onBeyondEnd()
      else latest.current.onBeforeStart()
      return
    }
    if (zoom.current.scale > 1) resetZoom(false)
    // La piste glisse d'une planche (depuis là où le doigt l'a laissée) : la suivante est déjà là, décodée.
    const tween = gsap.to(trackRef.current, {
      x: 0,
      xPercent: -sign * step * 100,
      duration: SLIDE_DURATION,
      ease: 'power3.out',
      overwrite: 'auto',
      onComplete: () => arrive(target),
    })
    sliding.current = { tween, target }
    latest.current.onInteract()
  }

  const navigateRef = useRef(navigate)
  const resetRef = useRef(resetZoom)
  // Avant l'effet de mise en place ci-dessous : un tap en attente doit partir de la planche arrivée.
  useLayoutEffect(() => {
    navigateRef.current = navigate
    resetRef.current = resetZoom
  })

  // Nouvelle planche affichée : React vient de la placer au centre, la piste revient à zéro AVANT
  // l'affichage (aucune image intermédiaire), puis le tap reçu pendant le glissement part.
  useLayoutEffect(() => {
    gsap.set(trackRef.current, { x: 0, xPercent: 0 })
    const step = queued.current
    queued.current = null
    if (step) navigateRef.current(step)
  }, [index])

  useEffect(() => {
    controllerRef.current = {
      goTo: (target) => {
        sliding.current?.tween.kill()
        sliding.current = null
        queued.current = null
        resetRef.current(false)
        gsap.set(trackRef.current, { x: 0, xPercent: 0 })
        setPage(target)
      },
      step: (step) => navigateRef.current(step),
    }
    return () => {
      controllerRef.current = null
    }
  }, [controllerRef])

  /* ---- Gestes ------------------------------------------------------------- */

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input')) return
    pointers.current.add(event.pointerId)
    if (pointers.current.size > 1) {
      // Deuxième doigt : c'est un pincement, pas un swipe.
      gesture.current = null
      gsap.to(trackRef.current, { x: 0, duration: 0.2, overwrite: 'auto' })
      return
    }
    gesture.current = {
      id: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      t0: performance.now(),
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    if (!current || current.id !== event.pointerId) return
    const dx = event.clientX - current.x0
    const dy = event.clientY - current.y0
    if (!current.moved && Math.hypot(dx, dy) > 8) {
      current.moved = true
      // Le doigt reprend la main : une planche encore en route arrive d'un coup.
      if (sliding.current) {
        sliding.current.tween.kill()
        arrive(sliding.current.target)
      }
    }
    if (zoom.current.scale > 1) {
      applyZoom({
        scale: zoom.current.scale,
        x: zoom.current.x + event.clientX - current.lastX,
        y: zoom.current.y + event.clientY - current.lastY,
      })
    } else if (current.moved && !sliding.current && Math.abs(dx) > Math.abs(dy)) {
      // La planche voisine suit le doigt ; sans voisine (bout du chapitre), un léger élastique.
      const toward = dx > 0 ? -sign : sign
      const neighbour = index + toward >= 0 && index + toward < spreads.length
      gsap.set(trackRef.current, { x: neighbour ? dx : dx * EDGE_RESISTANCE })
    }
    current.lastX = event.clientX
    current.lastY = event.clientY
  }

  const endGesture = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    pointers.current.delete(event.pointerId)
    const current = gesture.current
    if (!current || current.id !== event.pointerId) return
    gesture.current = null
    const springBack = () => gsap.to(trackRef.current, { x: 0, duration: 0.4, ease: EASE.swift, overwrite: 'auto' })
    if (cancelled) {
      springBack()
      return
    }

    if (!current.moved) {
      const box = event.currentTarget.getBoundingClientRect()
      const action = tapAction(event.clientX - box.left, box.width, direction)
      if (action === 'menu') onMenu()
      else navigate(action === 'next' ? 1 : -1)
      return
    }
    if (zoom.current.scale > 1) return

    const dx = event.clientX - current.x0
    const elapsed = Math.max(1, performance.now() - current.t0)
    const action = swipeAction(dx, direction, (dx / elapsed) * 1000)
    if (action) navigate(action === 'next' ? 1 : -1)
    else springBack()
  }

  return (
    <div
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endGesture(event, false)}
      onPointerCancel={(event) => endGesture(event, true)}
      className="relative h-full w-full touch-none overflow-hidden select-none"
    >
      <div ref={trackRef} className="absolute inset-0 will-change-transform">
        {NEIGHBOURS.map((offset) => {
          const at = index + offset
          const planche = spreads[at]
          if (!planche) return null
          return (
            <div
              // Clé = numéro de planche : la suivante devient l'actuelle sans être recréée.
              key={at}
              aria-hidden={offset !== 0}
              className="absolute inset-0"
              style={{ transform: `translateX(${offset * sign * 100}%)` }}
            >
              <div
                ref={offset === 0 ? zoomRef : undefined}
                className={`flex h-full w-full items-center justify-center ${direction === 'rtl' ? 'flex-row-reverse' : ''}`}
              >
                {planche.map((pageIndex) => {
                  const item = pages[pageIndex]
                  if (!item) return null
                  return (
                    <PageImage
                      key={item.url}
                      page={item}
                      className={`h-auto max-h-full w-auto object-contain ${planche.length > 1 ? 'max-w-[50%]' : 'max-w-full'}`}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {zoomed && (
        <button
          type="button"
          onClick={() => resetZoom()}
          aria-label={t.reader.zoomReset}
          className="absolute top-[max(2.25rem,env(safe-area-inset-top))] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/80 px-3 py-1.5 text-[11px] text-cream"
        >
          <ZoomOut size={13} />
          {t.reader.zoomReset}
        </button>
      )}

      {atEnd && overlay}
    </div>
  )
}
