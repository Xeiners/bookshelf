import { useMemo, useRef } from 'react'
import { gsap, useGSAP } from '../../lib/gsap'

const COUNT = 26

/**
 * Poussière d'étoiles : des points qui dérivent lentement vers le haut en
 * scintillant. Quelques-uns prennent la couleur du tirage (`--oracle-tone`).
 * Rien ne bouge si l'utilisateur a demandé moins d'animations.
 */
export function OracleParticles() {
  const rootRef = useRef<HTMLDivElement>(null)

  // Positions tirées une fois pour toutes : pas de saut à chaque rendu.
  const dots = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, index) => ({
        id: index,
        left: gsap.utils.random(0, 100),
        top: gsap.utils.random(0, 100),
        size: gsap.utils.random(1.5, 3.2),
        toned: index % 4 === 0,
      })),
    [],
  )

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      for (const dot of gsap.utils.toArray<HTMLElement>('[data-dot]')) {
        gsap.to(dot, {
          y: gsap.utils.random(-90, -40),
          x: gsap.utils.random(-14, 14),
          duration: gsap.utils.random(7, 13),
          ease: 'sine.inOut',
          repeat: -1,
          yoyo: true,
        })
        gsap.fromTo(
          dot,
          { autoAlpha: gsap.utils.random(0.05, 0.2) },
          { autoAlpha: gsap.utils.random(0.4, 0.8), duration: gsap.utils.random(1.8, 4), repeat: -1, yoyo: true, ease: 'sine.inOut' },
        )
      }
    },
    { scope: rootRef },
  )

  return (
    <div ref={rootRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {dots.map((dot) => (
        <span
          key={dot.id}
          data-dot
          className="absolute rounded-full"
          style={{
            left: `${dot.left}%`,
            top: `${dot.top}%`,
            width: dot.size,
            height: dot.size,
            background: dot.toned ? 'var(--oracle-tone)' : '#f7f5f0',
            boxShadow: dot.toned ? '0 0 8px var(--oracle-tone)' : undefined,
          }}
        />
      ))}
    </div>
  )
}
