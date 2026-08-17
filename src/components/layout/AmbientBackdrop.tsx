import { useRef } from 'react'
import { onAmbientPauseChange } from '../../lib/ambient'
import { gsap, useGSAP } from '../../lib/gsap'

/**
 * Halos en dérive lente + grain filmique.
 *
 * Contraintes de perf à ne pas casser : translation seule (animer `scale` sur un
 * élément flouté force la re-rastérisation du flou à chaque frame),
 * `will-change: transform` pour figer le calque, et pas de `mix-blend-mode` sur
 * le grain. Le décor se met en pause pendant les gestes — cf. `lib/ambient.ts`.
 */
export function AmbientBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const drift = gsap.to('[data-blob]', {
        xPercent: () => gsap.utils.random(-16, 16),
        yPercent: () => gsap.utils.random(-14, 14),
        duration: () => gsap.utils.random(11, 18),
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        repeatRefresh: true,
        stagger: 0.6,
      })

      return onAmbientPauseChange((paused) => {
        if (paused) drift.pause()
        else drift.resume()
      })
    },
    { scope: rootRef },
  )

  return (
    <div ref={rootRef} aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-void">
      <div className="absolute inset-0 overflow-hidden">
        <div
          data-blob
          className="absolute -top-28 -left-24 size-80 rounded-full bg-glow/30 blur-[70px] will-change-transform"
        />
        <div
          data-blob
          className="absolute top-1/3 -right-28 size-72 rounded-full bg-[#1d5cff]/22 blur-[80px] will-change-transform"
        />
        <div
          data-blob
          className="absolute -bottom-28 left-1/5 size-72 rounded-full bg-like/12 blur-[85px] will-change-transform"
        />
      </div>

      {/* Casse le banding des dégradés */}
      <div className="grain absolute inset-0 opacity-[0.05]" />

      <div className="absolute inset-0 bg-[radial-gradient(125%_85%_at_50%_5%,transparent_30%,var(--color-void)_100%)]" />
    </div>
  )
}
