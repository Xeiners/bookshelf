import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { gsap, useGSAP } from '../../lib/gsap'

/** « Mesh gradient » : quatre halos néon (violet, magenta, cyan, or), dans un seul calque. */
const MESH = [
  'radial-gradient(34% 30% at 18% 16%, rgba(124, 92, 255, 0.32), transparent 70%)',
  'radial-gradient(30% 26% at 82% 30%, rgba(255, 94, 196, 0.18), transparent 70%)',
  'radial-gradient(30% 28% at 26% 74%, rgba(76, 201, 240, 0.15), transparent 70%)',
  'radial-gradient(28% 24% at 80% 86%, rgba(255, 196, 107, 0.13), transparent 70%)',
].join(', ')

/**
 * Fond du Sanctuaire : noir profond (#050507), mesh néon, vignette. Monté dans
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
    <div ref={rootRef} aria-hidden className="pointer-events-none fixed inset-0 -z-[5] overflow-hidden bg-[#050507]">
      <div className="absolute inset-0" style={{ background: MESH }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 40%, transparent 30%, rgba(0,0,0,0.75) 100%)' }} />
    </div>,
    document.body,
  )
}
