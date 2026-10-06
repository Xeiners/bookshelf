import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { gsap, useGSAP } from '../../lib/gsap'

/**
 * Fond du Sanctuaire : un noir profond et uni (#050507), sans halos. Monté dans
 * un portail, en plein écran derrière l'interface : la zone animée (`<main>`,
 * transformée) piégerait un élément fixe.
 *
 * VOLONTAIREMENT IMMOBILE : un calque plein écran qui bouge oblige à
 * recomposer tout l'écran à chaque image — c'était la première cause de
 * saccades sur téléphone. La vie vient des artefacts, pas du fond.
 */
export function SanctumBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    gsap.fromTo(rootRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: 'power1.out' })
  })

  return createPortal(
    <div ref={rootRef} aria-hidden className="pointer-events-none fixed inset-0 -z-[5] bg-[#050507]" />,
    document.body,
  )
}
