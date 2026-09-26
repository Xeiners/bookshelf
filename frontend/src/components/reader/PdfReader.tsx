import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Minus, Plus } from 'lucide-react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useLocalPosition } from '../../hooks/reader/useLocalPosition'
import { usePinch } from '../../hooks/reader/usePinch'
import { useReaderChrome } from '../../hooks/reader/useReaderUi'
import { useT } from '../../i18n'
import { gsap } from '../../lib/gsap'
import { tapAction } from '../../lib/reader/navigation'
import { pageAtScroll, scrollRatio } from '../../lib/reader/progress'
import { getFileBlob, type LocalFile } from '../../lib/reader/localFiles'
import { useReaderStore } from '../../store/useReaderStore'
import { ChapterDrawer, type DrawerItem } from './ChapterDrawer'
import { ReaderControls, ReaderStatus } from './ReaderControls'
import { ReaderMessage } from './ReaderMessage'
import { ReaderSettings } from './ReaderSettings'

GlobalWorkerOptions.workerSrc = pdfWorker

const MIN_ZOOM = 1
const MAX_ZOOM = 4
/** Largeur de lecture maximale à 100 % : au-delà, une page A4 devient illisible à parcourir. */
const MAX_BASE_WIDTH = 1100
/** Plafond de pixels par canevas : la mémoire d'un téléphone n'est pas extensible. */
const MAX_CANVAS_PIXELS = 8_000_000

interface OutlineEntry {
  title: string
  dest: unknown
  depth: number
}

type Phase = 'loading' | 'ready' | 'error'

/**
 * Mode document : PDF (BD numérisées, livres, imports personnels) rendus par
 * pdf.js sur canevas, en défilement vertical. Seules les pages proches de
 * l'écran sont dessinées ; le zoom se fait au pincement (ou Ctrl + molette),
 * puis les pages sont redessinées nettes à la nouvelle échelle.
 */
export function PdfReader({ file }: { file: LocalFile }) {
  const t = useT()
  const ui = useReaderChrome()
  const showStatus = useReaderStore((state) => state.showStatus)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [tick, setTick] = useState(0)
  const [ratio, setRatio] = useState(0.707)
  /** Ratio propre à chaque page dessinée (une planche paysage au milieu d'un album). */
  const [ratios, setRatios] = useState<Record<number, number>>({})
  const [zoom, setZoom] = useState(1)
  const [containerWidth, setContainerWidth] = useState(0)
  const [near, setNear] = useState<ReadonlySet<number>>(new Set())
  const [page, setPage] = useState(0)
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  const [opening] = useState(file.position)
  const save = useLocalPosition(file.id)

  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const restored = useRef(false)
  /** Point à garder sous les doigts après un zoom (coordonnées du contenu, avant zoom). */
  const zoomAnchor = useRef<{ x: number; y: number; screenX: number; screenY: number; factor: number } | null>(null)

  /* ---- Chargement -------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    const open = async () => {
      const blob = await getFileBlob(file.id)
      if (!blob) throw new Error('missing')
      if (cancelled) return
      task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
      const loaded = await task.promise
      if (cancelled) return
      const first = await loaded.getPage(1)
      const viewport = first.getViewport({ scale: 1 })
      if (cancelled) return
      setRatio(viewport.width / viewport.height)
      setDoc(loaded)
      setPhase('ready')
      const items = await loaded.getOutline().catch(() => null)
      if (!cancelled && items) setOutline(flattenOutline(items))
    }
    open().catch(() => {
      if (!cancelled) setPhase('error')
    })
    return () => {
      cancelled = true
      // Détruit le document ET son worker pdf.js.
      void task?.destroy()
    }
  }, [file.id, tick])

  const numPages = doc?.numPages ?? 0

  /* ---- Mise en page ------------------------------------------------------- */

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry?.contentRect.width ?? 0))
    observer.observe(container)
    return () => observer.disconnect()
  }, [phase])

  const baseWidth = Math.min(containerWidth, MAX_BASE_WIDTH)
  const width = Math.round(baseWidth * zoom)

  // Pages proches de l'écran : les seules à dessiner.
  useEffect(() => {
    const container = scrollRef.current
    if (!container || numPages === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        setNear((previous) => {
          const next = new Set(previous)
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.page)
            if (entry.isIntersecting) next.add(index)
            else next.delete(index)
          }
          return next
        })
      },
      { root: container, rootMargin: '100% 0px' },
    )
    for (const node of pageRefs.current) if (node) observer.observe(node)
    return () => observer.disconnect()
  }, [numPages, width])

  // Reprise, une fois les pages en place.
  useLayoutEffect(() => {
    if (restored.current || numPages === 0 || width === 0) return
    restored.current = true
    const container = scrollRef.current
    const node = pageRefs.current[opening?.page ?? 0]
    if (container && node) container.scrollTop = node.offsetTop + (opening?.offset ?? 0) * node.offsetHeight
  }, [numPages, width, opening])

  // Après un zoom : le point pincé reste sous les doigts.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    const container = scrollRef.current
    if (!anchor || !container) return
    zoomAnchor.current = null
    const box = container.getBoundingClientRect()
    container.scrollLeft = anchor.x * anchor.factor - (anchor.screenX - box.left)
    container.scrollTop = anchor.y * anchor.factor - (anchor.screenY - box.top)
  }, [zoom])

  // Page courante et sauvegarde de la position.
  useEffect(() => {
    const container = scrollRef.current
    if (!container || numPages === 0) return
    let frame = 0
    const measure = () => {
      frame = 0
      const nodes = pageRefs.current.slice(0, numPages)
      const tops = nodes.map((node) => node?.offsetTop ?? 0)
      const heights = nodes.map((node) => node?.offsetHeight ?? 0)
      const position = pageAtScroll(container.scrollTop, tops, heights)
      // Affichage : la page au milieu de l'écran (en bas du document, la dernière
      // ne peut pas remonter en haut). Sauvegarde : page du haut + décalage, au pixel.
      setPage(pageAtScroll(container.scrollTop + container.clientHeight / 2, tops, heights).page)
      save({ page: position.page, offset: position.offset, ratio: scrollRatio(container.scrollTop, container.scrollHeight, container.clientHeight) })
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [numPages, save])

  /* ---- Zoom -------------------------------------------------------------- */

  const commitZoom = (target: number, screen: { x: number; y: number }) => {
    const container = scrollRef.current
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, target))
    gsap.set(innerRef.current, { clearProps: 'transform' })
    if (!container || next === zoom) return
    const box = container.getBoundingClientRect()
    zoomAnchor.current = {
      x: container.scrollLeft + screen.x - box.left,
      y: container.scrollTop + screen.y - box.top,
      screenX: screen.x,
      screenY: screen.y,
      factor: next / zoom,
    }
    setZoom(next)
  }

  usePinch(
    scrollRef,
    {
      onPinch: (factor, center) => {
        const inner = innerRef.current
        if (!inner) return
        const box = inner.getBoundingClientRect()
        const bounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor)) / zoom
        gsap.set(inner, { scale: bounded, transformOrigin: `${center.x - box.left}px ${center.y - box.top}px` })
      },
      onPinchEnd: (factor, center) => commitZoom(zoom * factor, center),
    },
    phase === 'ready',
  )

  const zoomBy = (step: number) => {
    const box = scrollRef.current?.getBoundingClientRect()
    commitZoom(Math.round((zoom + step) * 4) / 4, { x: (box?.left ?? 0) + (box?.width ?? 0) / 2, y: (box?.top ?? 0) + (box?.height ?? 0) / 2 })
  }

  /* ---- Navigation --------------------------------------------------------- */

  /** Page en haut de l'écran, lue dans le DOM : juste même entre deux images (touches répétées). */
  const pageNow = () => {
    const container = scrollRef.current
    if (!container) return page
    const nodes = pageRefs.current.slice(0, numPages)
    return pageAtScroll(container.scrollTop + 1, nodes.map((node) => node?.offsetTop ?? 0), nodes.map((node) => node?.offsetHeight ?? 0)).page
  }

  const goTo = (index: number) => {
    const container = scrollRef.current
    const node = pageRefs.current[index]
    if (container && node) container.scrollTop = node.offsetTop
  }

  const step = (direction: 1 | -1) => {
    const container = scrollRef.current
    if (!container) return
    gsap.to(container, { scrollTop: container.scrollTop + direction * container.clientHeight * 0.85, duration: 0.35, ease: 'power2.out', overwrite: 'auto' })
  }

  const keyRef = useRef({ panel: ui.panel, step, goTo, pageNow })
  useEffect(() => {
    keyRef.current = { panel: ui.panel, step, goTo, pageNow }
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = keyRef.current
      if (state.panel || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) state.step(1)
      else if (event.key === 'ArrowUp' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) state.step(-1)
      else if (event.key === 'ArrowRight') state.goTo(state.pageNow() + 1)
      else if (event.key === 'ArrowLeft') state.goTo(Math.max(0, state.pageNow() - 1))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const action = tapAction(event.clientX - box.left, box.width, 'ltr')
    if (action === 'menu') ui.toggleControls()
    else {
      step(action === 'next' ? 1 : -1)
      ui.hideControls()
    }
  }

  const openOutline = async (entry: OutlineEntry) => {
    if (!doc) return
    try {
      const dest = typeof entry.dest === 'string' ? await doc.getDestination(entry.dest) : entry.dest
      const ref = Array.isArray(dest) ? dest[0] : null
      if (ref && typeof ref === 'object') goTo(await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]))
      else if (typeof ref === 'number') goTo(ref)
    } catch {
      // Destination absente ou corrompue : on reste où on est.
    }
  }

  const items: DrawerItem[] = useMemo(
    () => outline.map((entry, index) => ({ id: String(index), label: entry.title, depth: entry.depth })),
    [outline],
  )

  const pages = useMemo(() => Array.from({ length: numPages }, (_, index) => index), [numPages])

  if (phase !== 'ready' || !doc) {
    return (
      <div className="fixed inset-0 z-[100] bg-black text-cream">
        <ReaderMessage
          message={phase === 'error' ? t.reader.errorFile : t.reader.opening}
          busy={phase === 'loading'}
          onRetry={phase === 'error' ? () => {
            setPhase('loading')
            setTick((value) => value + 1)
          } : undefined}
          onClose={ui.close}
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black text-cream">
      <div
        ref={scrollRef}
        onClick={onClick}
        className="no-scrollbar absolute inset-0 overflow-auto overscroll-contain"
        style={{ touchAction: 'pan-x pan-y' }}
      >
        <div ref={innerRef} className="mx-auto flex flex-col gap-2 py-2" style={{ width: width || '100%' }}>
          {pages.map((index) => (
            <div
              key={index}
              data-page={index}
              ref={(node) => {
                pageRefs.current[index] = node
              }}
              className="relative w-full bg-white/[0.04]"
              style={{ aspectRatio: String(ratios[index] ?? ratio) }}
            >
              {near.has(index) && width > 0 && (
                <PdfPage
                  doc={doc}
                  index={index}
                  width={width}
                  onRatio={(value) => {
                    if (ratios[index] !== value) setRatios((current) => ({ ...current, [index]: value }))
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <ReaderStatus visible={showStatus && !ui.controls} />

      <ReaderControls
        visible={ui.controls}
        title={file.title}
        subtitle={t.reader.pageOf(page + 1, numPages)}
        onClose={ui.close}
        onOpenContents={items.length > 0 ? () => ui.setPanel('contents') : undefined}
        contentsLabel={t.reader.contents}
        onOpenSettings={() => ui.setPanel('settings')}
        slider={numPages > 1 ? { value: page, max: numPages - 1, valueText: t.reader.pageOf(page + 1, numPages), onChange: goTo } : null}
        tools={
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => zoomBy(-0.25)}
              disabled={zoom <= MIN_ZOOM}
              aria-label={t.reader.zoomOut}
              className="grid size-10 place-items-center rounded-full text-cream/80 hover:bg-white/10 disabled:opacity-30"
            >
              <Minus size={16} />
            </button>
            <span className="w-11 text-center text-[11px] text-mist tabular-nums">{t.reader.percent(Math.round(zoom * 100))}</span>
            <button
              type="button"
              onClick={() => zoomBy(0.25)}
              disabled={zoom >= MAX_ZOOM}
              aria-label={t.reader.zoomIn}
              className="grid size-10 place-items-center rounded-full text-cream/80 hover:bg-white/10 disabled:opacity-30"
            >
              <Plus size={16} />
            </button>
          </div>
        }
      />

      <ChapterDrawer
        open={ui.panel === 'contents'}
        title={t.reader.contents}
        items={items}
        onSelect={(id) => {
          ui.setPanel(null)
          const entry = outline[Number(id)]
          if (entry) void openOutline(entry)
        }}
        onClose={() => ui.setPanel(null)}
      />

      <ReaderSettings open={ui.panel === 'settings'} onClose={() => ui.setPanel(null)} />
    </div>
  )
}

interface PdfPageProps {
  doc: PDFDocumentProxy
  index: number
  /** Largeur d'affichage, en pixels CSS. */
  width: number
  onRatio: (ratio: number) => void
}

/** Une page dessinée sur canevas, à la résolution de l'écran (plafonnée). */
function PdfPage({ doc, index, width, onRatio }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ratioRef = useRef(onRatio)
  useEffect(() => {
    ratioRef.current = onRatio
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let task: RenderTask | null = null
    let cancelled = false
    doc
      .getPage(index + 1)
      .then((page) => {
        if (cancelled) return
        const natural = page.getViewport({ scale: 1 })
        ratioRef.current(natural.width / natural.height)
        const density = Math.min(window.devicePixelRatio || 1, 3)
        let scale = (width * density) / natural.width
        const pixels = natural.width * natural.height * scale * scale
        if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels)
        const viewport = page.getViewport({ scale })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        task = page.render({ canvas, viewport })
        return task.promise
      })
      .catch(() => {
        // Rendu annulé (page sortie de l'écran, zoom changé) : rien à signaler.
      })
    return () => {
      cancelled = true
      task?.cancel()
      // Libère la mémoire du canevas dès que la page s'éloigne.
      canvas.width = 0
      canvas.height = 0
    }
  }, [doc, index, width])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
}

/** Signets du PDF, aplatis avec leur profondeur. */
function flattenOutline(items: { title: string; dest: unknown; items?: unknown[] }[], depth = 0): OutlineEntry[] {
  return items.flatMap((item) => [
    { title: item.title, dest: item.dest, depth },
    ...flattenOutline((item.items ?? []) as { title: string; dest: unknown; items?: unknown[] }[], depth + 1),
  ])
}
