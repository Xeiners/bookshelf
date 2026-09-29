import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { EASE, gsap, useGSAP } from '../../lib/gsap'

/** Marge minimale avec les bords de l'écran. */
const GUTTER = 12

interface FloatingPanelProps {
  /** Position du bouton qui ouvre la bulle (`getBoundingClientRect`). */
  anchor: DOMRect
  /** Élément déclencheur : un tap dessus ne compte pas comme « à côté » (il bascule lui-même). */
  trigger: HTMLElement | null
  /** Sous le bouton (par défaut) ou au-dessus (mini-lecteur en bas d'écran). */
  placement?: 'below' | 'above'
  width: number
  label: string
  role?: 'dialog' | 'menu'
  onClose: () => void
  children: ReactNode
}

/**
 * Bulle flottante, rendue à la racine du document : jamais rognée par une
 * liste qui défile, une feuille ou le lecteur. Alignée sur le bouton,
 * ramenée dans l'écran. Fermée par un tap à côté, Échap (elle seule, pas la
 * feuille dessous), ou un défilement (le bouton a bougé).
 */
export function FloatingPanel({ anchor, trigger, placement = 'below', width, label, role = 'dialog', onClose, children }: FloatingPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element
      // Une bulle ouverte depuis celle-ci (volume dans le mini-lecteur) compte comme dedans.
      if (ref.current?.contains(target) || trigger?.contains(target) || target.closest?.('[data-floating-panel]')) return
      closeRef.current()
    }
    // Phase de capture : Échap ferme la bulle sans atteindre la feuille ou le lecteur dessous.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closeRef.current()
    }
    const onScroll = (event: Event) => {
      if (ref.current?.contains(event.target as Node)) return
      closeRef.current()
    }
    const onResize = () => closeRef.current()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [trigger])

  useGSAP(() => {
    gsap.from(ref.current, {
      autoAlpha: 0,
      y: placement === 'below' ? -6 : 6,
      scale: 0.96,
      duration: 0.2,
      ease: EASE.swift,
      transformOrigin: placement === 'below' ? 'top right' : 'bottom right',
    })
  })

  const viewport = window.innerWidth
  const panelWidth = Math.min(width, viewport - GUTTER * 2)
  const left = Math.min(Math.max(GUTTER, anchor.right - panelWidth), viewport - GUTTER - panelWidth)
  const style: CSSProperties =
    placement === 'below'
      ? { position: 'fixed', top: anchor.bottom + 8, left, width: panelWidth }
      : { position: 'fixed', bottom: window.innerHeight - anchor.top + 8, left, width: panelWidth }

  return createPortal(
    <div
      ref={ref}
      data-floating-panel
      role={role}
      aria-label={label}
      style={style}
      className="glass-strong z-[120] rounded-3xl p-2 text-cream shadow-lift"
    >
      {children}
    </div>,
    document.body,
  )
}
