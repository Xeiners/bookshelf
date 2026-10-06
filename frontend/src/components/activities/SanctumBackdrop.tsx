import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { gsap, useGSAP } from '../../lib/gsap'

/** Une aurore discrète : un voile violet au sommet, une braise dorée tout en bas. */
const AURORA = [
  'radial-gradient(90% 55% at 50% -8%, rgba(124, 92, 255, 0.28), rgba(124, 92, 255, 0.08) 45%, transparent 75%)',
  'radial-gradient(60% 40% at 85% 108%, rgba(255, 170, 90, 0.10), transparent 70%)',
].join(', ')

/**
 * Fond du Sanctuaire : un noir profond (#050507) sous une aurore discrète. Monté dans
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
    <div ref={rootRef} aria-hidden className="pointer-events-none fixed inset-0 -z-[5] bg-[#050507]" style={{ backgroundImage: AURORA }} />,
    document.body,
  )
}
