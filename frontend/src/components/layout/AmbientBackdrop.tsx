import { useRef } from 'react'
import { gsap, useGSAP } from '../../lib/gsap'

/**
 * Halos en dérive lente + grain filmique.
 *
 * Les halos sont des dégradés radiaux, sans filtre CSS. Leur dérive n'anime que
 * `transform`, ce qui permet au compositeur de les déplacer sans les recalculer.
 */
export function AmbientBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      gsap.to('[data-blob]', {
        xPercent: () => gsap.utils.random(-16, 16),
        yPercent: () => gsap.utils.random(-14, 14),
        duration: () => gsap.utils.random(11, 18),
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        repeatRefresh: true,
        stagger: 0.6,
      })

    },
    { scope: rootRef },
  )

  return (
    <div ref={rootRef} aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-void">
      <div className="absolute inset-0 overflow-hidden">
        <div
          data-blob
          className="absolute -top-36 -left-32 size-[28rem] rounded-full bg-[radial-gradient(circle,rgb(124_92_255/0.3)_0%,rgb(124_92_255/0.12)_34%,transparent_70%)] will-change-transform"
        />
        <div
          data-blob
          className="absolute top-1/4 -right-40 size-[30rem] rounded-full bg-[radial-gradient(circle,rgb(29_92_255/0.22)_0%,rgb(29_92_255/0.08)_36%,transparent_70%)] will-change-transform"
        />
        <div
          data-blob
          className="absolute -bottom-40 left-[8%] size-[30rem] rounded-full bg-[radial-gradient(circle,rgb(63_224_160/0.12)_0%,rgb(63_224_160/0.04)_38%,transparent_72%)] will-change-transform"
        />
      </div>

      {/* Casse le banding des dégradés */}
      <div className="grain absolute inset-0 opacity-[0.05]" />

      <div className="absolute inset-0 bg-[radial-gradient(125%_85%_at_50%_5%,transparent_30%,var(--color-void)_100%)]" />
    </div>
  )
}
