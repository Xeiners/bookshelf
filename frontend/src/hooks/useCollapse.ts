import type { RefObject } from 'react'
import { useRef } from 'react'
import { gsap, useGSAP } from '../lib/gsap'

/**
 * Replie un bloc (hauteur → 0, fondu) ou le déplie (hauteur naturelle). Une
 * seule animation par bascule, pas pendant le défilement : la mise en page
 * ne bouge que le temps du repli. `overflow: hidden` seulement replié — déplié,
 * une bulle qui déborde du bloc (menu, mini-lecteur) reste visible.
 * `gapPx` : écart flex du parent, rattrapé par une marge négative une fois replié.
 */
export function useCollapse(ref: RefObject<HTMLElement | null>, collapsed: boolean, gapPx = 0) {
  const first = useRef(true)
  useGSAP(
    () => {
      const element = ref.current
      if (!element) return
      // Premier rendu déplié : rien à animer.
      if (first.current) {
        first.current = false
        if (!collapsed) return
      }
      if (collapsed) {
        gsap.to(element, { height: 0, marginBottom: -gapPx, autoAlpha: 0, overflow: 'hidden', duration: 0.3, ease: 'power2.inOut', overwrite: 'auto' })
      } else {
        gsap.to(element, {
          height: 'auto',
          marginBottom: 0,
          autoAlpha: 1,
          duration: 0.32,
          ease: 'power2.out',
          overwrite: 'auto',
          onComplete: () => {
            gsap.set(element, { clearProps: 'height,marginBottom,overflow' })
          },
        })
      }
    },
    { dependencies: [collapsed] },
  )
}
