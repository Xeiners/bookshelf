import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { gsap, useGSAP } from '../../lib/gsap'

/** Une aurore douce : voiles violet et rose au sommet, une braise dorée tout en bas. */
const AURORA = [
  'radial-gradient(70% 50% at 20% -10%, rgba(124, 92, 255, 0.30), rgba(124, 92, 255, 0.08) 45%, transparent 75%)',
  'radial-gradient(60% 45% at 85% -5%, rgba(255, 94, 196, 0.16), transparent 70%)',
  'radial-gradient(60% 40% at 85% 108%, rgba(255, 170, 90, 0.12), transparent 70%)',
].join(', ')

/**
 * Fond du Sanctuaire : un noir profond (#050507) sous une aurore discrète. Monté dans
 * un portail, en plein écran derrière l'interface : la zone animée (`<main>`,
 * transformée) piégerait un élément fixe.
 *
 * Deux lueurs dérivent lentement par-dessus (une violette, une rose dorée). Le calque plein
 * écran, lui, reste IMMOBILE : le faire bouger obligeait à recomposer tout l'écran à chaque
 * image (saccades sur téléphone). Les lueurs ne bougent que par `transform`, en CSS (le
 * compositeur s'en charge), sont floues par leur dégradé (pas de `filter: blur`), et
 * s'arrêtent si l'appareil demande moins d'animations.
 */
export function SanctumBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    gsap.fromTo(rootRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: 'power1.out' })
  })

  return createPortal(
    <div ref={rootRef} aria-hidden className="pointer-events-none fixed inset-0 -z-[5] overflow-hidden bg-[#050507]" style={{ backgroundImage: AURORA }}>
      <span
        className="sanctum-orb absolute top-[8%] left-[-12%] size-[min(70vmax,900px)] rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(124, 92, 255, 0.38), rgba(124, 92, 255, 0.12) 50%, transparent)', animation: 'sanctum-drift-a 38s ease-in-out infinite alternate' }}
      />
      <span
        className="sanctum-orb absolute right-[-14%] bottom-[-10%] size-[min(60vmax,780px)] rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(255, 110, 170, 0.28), rgba(255, 170, 90, 0.10) 55%, transparent)', animation: 'sanctum-drift-b 46s ease-in-out infinite alternate' }}
      />
    </div>,
    document.body,
  )
}
