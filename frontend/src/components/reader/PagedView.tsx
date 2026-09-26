import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { ZoomOut } from 'lucide-react'
import { usePinch } from '../../hooks/reader/usePinch'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { buildSpreads, spreadIndexOf, swipeAction, tapAction } from '../../lib/reader/navigation'
import { pagedRatio } from '../../lib/reader/progress'
import type { ReaderPage, ReaderViewController, ReadingDirection, SpreadMode, ViewPosition } from '../../types/reader'
import { PageImage } from './PageImage'

/** Largeur minimale (en paysage) pour la double page automatique : tablette, ordinateur. */
const DOUBLE_MIN_WIDTH = 900
const MAX_ZOOM = 4
/** Référence stable (dépendance d'effet) quand le chapitre n'a aucune page. */
const NO_SPREAD: number[] = []

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

  const zoom = useRef<Zoom>({ scale: 1, x: 0, y: 0 })
  const pinchBase = useRef<Zoom | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Set<number>())
  /** Sens visuel du dernier changement de planche (-1 : le contenu part à gauche). */
  const lastMove = useRef(0)

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

  const navigate = (step: 1 | -1) => {
    const target = index + step
    if (target >= spreads.length) {
      latest.current.onBeyondEnd()
      return
    }
    if (target < 0) {
      latest.current.onBeforeStart()
      return
    }
    if (zoom.current.scale > 1) resetZoom(false)
    const forwardIsLeft = direction === 'ltr'
    const out = (step === 1) === forwardIsLeft ? -1 : 1
    lastMove.current = out
    const width = stageRef.current?.clientWidth ?? 400
    gsap.to(trackRef.current, {
      x: out * width * 0.25,
      autoAlpha: 0,
      duration: 0.14,
      ease: EASE.exit,
      overwrite: 'auto',
      onComplete: () => setPage(spreads[target]?.[0] ?? 0),
    })
    latest.current.onInteract()
  }

  // Entrée de la nouvelle planche, depuis le côté opposé à la sortie.
  useGSAP(
    () => {
      if (lastMove.current === 0) return
      const width = stageRef.current?.clientWidth ?? 400
      gsap.fromTo(
        trackRef.current,
        { x: -lastMove.current * width * 0.2, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, duration: 0.32, ease: EASE.swift, overwrite: 'auto' },
      )
    },
    { dependencies: [index] },
  )

  const navigateRef = useRef(navigate)
  const resetRef = useRef(resetZoom)
  useEffect(() => {
    navigateRef.current = navigate
    resetRef.current = resetZoom
  })

  useEffect(() => {
    controllerRef.current = {
      goTo: (target) => {
        resetRef.current(false)
        lastMove.current = 0
        gsap.set(trackRef.current, { x: 0, autoAlpha: 1 })
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
    if (!current.moved && Math.hypot(dx, dy) > 8) current.moved = true
    if (zoom.current.scale > 1) {
      applyZoom({
        scale: zoom.current.scale,
        x: zoom.current.x + event.clientX - current.lastX,
        y: zoom.current.y + event.clientY - current.lastY,
      })
    } else if (current.moved && Math.abs(dx) > Math.abs(dy)) {
      gsap.set(trackRef.current, { x: dx })
    }
    current.lastX = event.clientX
    current.lastY = event.clientY
  }

  const endGesture = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    pointers.current.delete(event.pointerId)
    const current = gesture.current
    if (!current || current.id !== event.pointerId) return
    gesture.current = null
    const springBack = () => gsap.to(trackRef.current, { x: 0, duration: 0.45, ease: EASE.snap, overwrite: 'auto' })
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
      <div ref={trackRef} className="absolute inset-0">
        <div
          ref={zoomRef}
          className={`flex h-full w-full items-center justify-center ${direction === 'rtl' ? 'flex-row-reverse' : ''}`}
        >
          {spread.map((pageIndex) => {
            const item = pages[pageIndex]
            if (!item) return null
            return (
              <PageImage
                key={item.url}
                page={item}
                className={`h-auto max-h-full w-auto object-contain ${spread.length > 1 ? 'max-w-[50%]' : 'max-w-full'}`}
              />
            )
          })}
        </div>
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
