import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
 * gardée dans l'écran (au-dessus du bouton s'il n'y a pas la place dessous).
 * Fermée par un tap à côté, Échap (elle seule, pas la feuille dessous), un
 * défilement (le bouton a bougé) ou un changement de largeur. Le clavier du
 * téléphone, lui, ne la ferme pas : il ne fait que réduire la hauteur, et le
 * défilement qu'il provoque vient de la saisie — la bulle se replace.
 */
export function FloatingPanel({ anchor, trigger, placement = 'below', width, label, role = 'dialog', onClose, children }: FloatingPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  /** Position du bouton, relue quand le clavier change la hauteur de l'écran. */
  const [rect, setRect] = useState(anchor)
  /** Hauteur de la bulle, pour la garder dans l'écran. */
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

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
    const reposition = () => {
      if (trigger?.isConnected) setRect(trigger.getBoundingClientRect())
    }
    // Saisie en cours dans la bulle : défilements et hauteur qui change viennent du clavier.
    const typing = () => {
      const active = document.activeElement
      return !!active && !!ref.current?.contains(active) && active.matches('input, textarea')
    }
    const onScroll = (event: Event) => {
      if (ref.current?.contains(event.target as Node)) return
      if (typing()) reposition()
      else closeRef.current()
    }
    let width = window.innerWidth
    const onResize = () => {
      if (window.innerWidth !== width) {
        width = window.innerWidth
        closeRef.current()
      } else reposition()
    }
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
  const screen = window.innerHeight
  const panelWidth = Math.min(width, viewport - GUTTER * 2)
  const left = Math.min(Math.max(GUTTER, rect.right - panelWidth), viewport - GUTTER - panelWidth)
  // Côté demandé, sauf si la bulle n'y tient pas et qu'il y a plus de place de l'autre.
  const roomBelow = screen - rect.bottom - 8 - GUTTER
  const roomAbove = rect.top - 8 - GUTTER
  const side =
    height === null
      ? placement
      : placement === 'below'
        ? height > roomBelow && roomAbove > roomBelow ? 'above' : 'below'
        : height > roomAbove && roomBelow > roomAbove ? 'below' : 'above'
  // Puis ramenée dans l'écran, quitte à chevaucher le bouton ; jamais plus haute que lui.
  const highest = Math.max(GUTTER, screen - GUTTER - (height ?? 0))
  const style: CSSProperties = {
    position: 'fixed',
    left,
    width: panelWidth,
    maxHeight: screen - GUTTER * 2,
    overflowY: 'auto',
    ...(side === 'below'
      ? { top: Math.max(GUTTER, Math.min(rect.bottom + 8, highest)) }
      : { bottom: Math.max(GUTTER, Math.min(screen - rect.top + 8, highest)) }),
  }

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
