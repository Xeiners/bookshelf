import { useRef } from 'react'
import { gsap, useGSAP } from '../lib/gsap'

interface CountUpOptions {
  duration?: number
  delay?: number
  format?: (value: number) => string
}

/**
 * Compteur animé par GSAP.
 *
 * On anime un objet JS puis on écrit dans `textContent` : aucun re-render React
 * pendant les 60 frames de l'animation.
 */
export function useCountUp(value: number, options: CountUpOptions = {}) {
  const ref = useRef<HTMLSpanElement>(null)
  const { duration = 1.2, delay = 0.1, format } = options

  useGSAP(
    () => {
      const node = ref.current
      if (!node) return

      const render = format ?? ((current: number) => String(Math.round(current)))
      const counter = { value: 0 }
      node.textContent = render(0)

      gsap.to(counter, {
        value,
        duration,
        delay,
        ease: 'power2.out',
        onUpdate: () => {
          node.textContent = render(counter.value)
        },
      })
    },
    { dependencies: [value], revertOnUpdate: true },
  )

  return ref
}
