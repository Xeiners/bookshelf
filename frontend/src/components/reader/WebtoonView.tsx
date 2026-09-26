import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { gsap } from '../../lib/gsap'
import { tapAction } from '../../lib/reader/navigation'
import { pageAtScroll, scrollRatio } from '../../lib/reader/progress'
import type { ReaderPage, ReaderViewController, ViewPosition } from '../../types/reader'
import { PageImage } from './PageImage'

/** Ratio largeur / hauteur réservé avant le chargement d'une page (page de manga classique). */
const DEFAULT_RATIO = 0.7
/** Pages chargées d'emblée autour du point de reprise ; le reste attend l'approche de l'écran. */
const EAGER_AROUND = 3

interface WebtoonViewProps {
  pages: ReaderPage[]
  /** Point de reprise : page en haut de l'écran et part déjà défilée de cette page. */
  start: { page: number; offset: number }
  controllerRef: RefObject<ReaderViewController | null>
  onPosition: (position: ViewPosition) => void
  /** La fin du chapitre est à l'écran. */
  onEnd: () => void
  onMenu: () => void
  /** L'utilisateur lit (défile) : les commandes peuvent s'effacer. */
  onInteract: () => void
  /** Bloc de fin de chapitre, sous la dernière page. */
  end: ReactNode
}

/**
 * Mode webtoon / manhwa : défilement vertical continu, pages bord à bord, sans
 * aucun espace entre elles. La reprise est faite au pixel près (page + part
 * défilée) et tient malgré le chargement des images au-dessus : tant que
 * l'utilisateur n'a pas touché l'écran, la position est réappliquée à chaque
 * image qui prend sa vraie hauteur.
 */
export function WebtoonView({ pages, start, controllerRef, onPosition, onEnd, onMenu, onInteract, end }: WebtoonViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const [ratios, setRatios] = useState<Record<number, number>>({})
  const restoreRef = useRef<{ page: number; offset: number } | null>(start)
  /** Dernière position posée par la reprise : tout écart vient d'ailleurs (utilisateur, navigateur). */
  const appliedTop = useRef<number | null>(null)

  const latest = useRef({ onPosition, onEnd, onInteract })
  useEffect(() => {
    latest.current = { onPosition, onEnd, onInteract }
  })

  const applyRestore = () => {
    const target = restoreRef.current
    const container = scrollRef.current
    const node = target ? pageRefs.current[target.page] : null
    if (!target || !container || !node) return
    container.scrollTop = node.offsetTop + target.offset * node.offsetHeight
    appliedTop.current = container.scrollTop
  }

  // Au montage, puis à chaque page qui prend sa hauteur réelle (tant que la reprise tient).
  useLayoutEffect(() => {
    applyRestore()
  })

  // La moindre interaction de l'utilisateur libère la reprise automatique.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const release = () => {
      restoreRef.current = null
    }
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const name of events) container.addEventListener(name, release, { passive: true })
    window.addEventListener('keydown', release)
    return () => {
      for (const name of events) container.removeEventListener(name, release)
      window.removeEventListener('keydown', release)
    }
  }, [])

  // Position courante, calculée au plus une fois par image affichée.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    let frame = 0
    const startTop = container.scrollTop
    let interacted = false
    const measure = () => {
      frame = 0
      // Défilement qui ne vient pas de la reprise (clavier, recherche dans la page,
      // ancrage du navigateur…) : la reprise automatique s'arrête là.
      if (restoreRef.current && appliedTop.current !== null && Math.abs(container.scrollTop - appliedTop.current) > 4) {
        restoreRef.current = null
      }
      const nodes = pageRefs.current
      const tops = nodes.map((node) => node?.offsetTop ?? 0)
      const heights = nodes.map((node) => node?.offsetHeight ?? 0)
      const { page, offset } = pageAtScroll(container.scrollTop, tops, heights)
      const endTop = endRef.current?.offsetTop ?? container.scrollHeight
      latest.current.onPosition({ page, offset, ratio: scrollRatio(container.scrollTop, endTop, container.clientHeight) })
      if (!interacted && Math.abs(container.scrollTop - startTop) > 48 && restoreRef.current === null) {
        interacted = true
        latest.current.onInteract()
      }
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])

  // Fin du chapitre visible.
  useEffect(() => {
    const container = scrollRef.current
    const marker = endRef.current
    if (!container || !marker) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) latest.current.onEnd()
      },
      { root: container, threshold: 0 },
    )
    observer.observe(marker)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    controllerRef.current = {
      goTo: (page) => {
        const container = scrollRef.current
        const node = pageRefs.current[page]
        if (!container || !node) return
        restoreRef.current = null
        gsap.killTweensOf(container)
        container.scrollTop = node.offsetTop
      },
      step: (direction) => {
        const container = scrollRef.current
        if (!container) return
        restoreRef.current = null
        gsap.to(container, {
          scrollTop: container.scrollTop + direction * container.clientHeight * 0.85,
          duration: 0.35,
          ease: 'power2.out',
          overwrite: 'auto',
        })
      },
    }
    return () => {
      controllerRef.current = null
    }
  }, [controllerRef])

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input')) return
    const box = event.currentTarget.getBoundingClientRect()
    const action = tapAction(event.clientX - box.left, box.width, 'ltr')
    if (action === 'menu') {
      onMenu()
      return
    }
    controllerRef.current?.step(action === 'next' ? 1 : -1)
    onInteract()
  }

  return (
    <div
      ref={scrollRef}
      onClick={onClick}
      className="no-scrollbar h-full overflow-y-auto overscroll-contain"
      // Défilement natif et pincement bloqué (le zoom agrandirait les commandes).
      style={{ touchAction: 'pan-y' }}
    >
      <div className="relative mx-auto w-full max-w-[860px]">
        {pages.map((page, index) => (
          <div
            key={page.url}
            ref={(node) => {
              pageRefs.current[index] = node
            }}
            className="w-full"
            style={{ aspectRatio: String(ratios[index] ?? DEFAULT_RATIO) }}
          >
            <PageImage
              page={page}
              lazy={Math.abs(index - start.page) > EAGER_AROUND}
              className="block h-full w-full"
              onSize={(width, height) => {
                if (width > 0 && height > 0 && ratios[index] !== width / height) {
                  setRatios((current) => ({ ...current, [index]: width / height }))
                }
              }}
            />
          </div>
        ))}
        <div ref={endRef}>{end}</div>
      </div>
    </div>
  )
}
