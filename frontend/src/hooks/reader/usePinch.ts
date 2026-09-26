import { useEffect, useRef, type RefObject } from 'react'

export interface PinchPoint {
  /** Centre du geste, en coordonnées de la fenêtre. */
  x: number
  y: number
}

export interface PinchHandlers {
  /** `factor` : échelle relative depuis le début du geste (1 = inchangé). */
  onPinch: (factor: number, center: PinchPoint) => void
  onPinchEnd: (factor: number, center: PinchPoint) => void
}

const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
const middle = (a: Touch, b: Touch): PinchPoint => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 })

/**
 * Pincer pour zoomer (deux doigts), et Ctrl + molette / pavé tactile sur ordinateur.
 *
 * Événements tactiles et non Pointer Events : un seul doigt garde le défilement
 * natif du conteneur (fluide, avec inertie), seul le geste à deux doigts est
 * intercepté (`preventDefault`, d'où les écouteurs non passifs). Le zoom natif
 * de la page, lui, est bloqué : il agrandirait aussi les commandes.
 */
export function usePinch(ref: RefObject<HTMLElement | null>, handlers: PinchHandlers, enabled = true): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  useEffect(() => {
    const node = ref.current
    if (!node || !enabled) return

    let startDistance = 0
    let factor = 1
    let center: PinchPoint = { x: 0, y: 0 }
    let active = false

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      const [a, b] = [event.touches[0], event.touches[1]]
      if (!a || !b) return
      active = true
      startDistance = distance(a, b) || 1
      factor = 1
      center = middle(a, b)
      event.preventDefault()
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!active || event.touches.length !== 2) return
      const [a, b] = [event.touches[0], event.touches[1]]
      if (!a || !b) return
      event.preventDefault()
      factor = distance(a, b) / startDistance
      center = middle(a, b)
      latest.current.onPinch(factor, center)
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (!active || event.touches.length >= 2) return
      active = false
      latest.current.onPinchEnd(factor, center)
    }

    // Ctrl + molette (et pincement du pavé tactile, que les navigateurs traduisent ainsi).
    let wheelTimer: number | undefined
    let wheelFactor = 1
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      wheelFactor *= Math.exp(-event.deltaY / 300)
      const point = { x: event.clientX, y: event.clientY }
      latest.current.onPinch(wheelFactor, point)
      window.clearTimeout(wheelTimer)
      wheelTimer = window.setTimeout(() => {
        latest.current.onPinchEnd(wheelFactor, point)
        wheelFactor = 1
      }, 160)
    }

    node.addEventListener('touchstart', onTouchStart, { passive: false })
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    node.addEventListener('touchend', onTouchEnd)
    node.addEventListener('touchcancel', onTouchEnd)
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.clearTimeout(wheelTimer)
      node.removeEventListener('touchstart', onTouchStart)
      node.removeEventListener('touchmove', onTouchMove)
      node.removeEventListener('touchend', onTouchEnd)
      node.removeEventListener('touchcancel', onTouchEnd)
      node.removeEventListener('wheel', onWheel)
    }
  }, [ref, enabled])
}
