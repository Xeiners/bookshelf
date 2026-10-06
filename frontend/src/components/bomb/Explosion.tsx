import { useRef } from 'react'
import { reducedMotion } from '../../lib/dle'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'

/**
 * Explosion plein écran, façon impact d'anime : flash blanc, lignes de vitesse qui
 * jaillissent du centre, deux ondes de choc, le kanji 爆 (« explosion ») et des éclats.
 * Rejouée à chaque nouvelle valeur de `burst` (0 : rien).
 */
export function Explosion({ burst, label }: { burst: number; label: string }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (burst === 0) return
      vibrate([70, 40, 140])
      const timeline = gsap.timeline()
      timeline.set(rootRef.current, { autoAlpha: 1 })
      timeline.fromTo('[data-boom-flash]', { opacity: 0.95 }, { opacity: 0, duration: 0.45, ease: 'power2.out' }, 0)
      if (!reducedMotion()) {
        timeline.fromTo('[data-boom-lines]', { scale: 0.4, opacity: 1, rotation: 0 }, { scale: 1.9, opacity: 0, rotation: 18, duration: 0.9, ease: 'power3.out' }, 0)
        timeline.fromTo('[data-boom-wave]', { scale: 0.1, opacity: 0.95 }, { scale: 3.4, opacity: 0, duration: 0.95, ease: 'power2.out', stagger: 0.12 }, 0.02)
        timeline.fromTo(
          '[data-boom-shard]',
          { x: 0, y: 0, opacity: 1, scale: 1 },
          {
            x: (index: number) => Math.cos((index / 14) * Math.PI * 2) * (180 + (index % 3) * 70),
            y: (index: number) => Math.sin((index / 14) * Math.PI * 2) * (180 + (index % 3) * 70),
            opacity: 0,
            scale: 0.3,
            rotation: (index: number) => (index % 2 ? 1 : -1) * 220,
            duration: 0.9,
            ease: 'power3.out',
          },
          0,
        )
      }
      timeline.fromTo('[data-boom-word]', { scale: 2.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.32, ease: 'back.out(2.4)' }, 0.04)
      timeline.to('[data-boom-word]', { scale: 1.12, opacity: 0, duration: 0.4, ease: 'power2.in' }, 0.95)
      timeline.set(rootRef.current, { autoAlpha: 0 })
    },
    { scope: rootRef, dependencies: [burst] },
  )

  return (
    <div ref={rootRef} aria-hidden className="pointer-events-none fixed inset-0 z-[130] grid place-items-center overflow-hidden" style={{ visibility: 'hidden' }}>
      <div data-boom-flash className="absolute inset-0 bg-[radial-gradient(circle,#fff6d8,#ffb347_45%,#ff3b3b_80%)] opacity-0" />
      {/* Lignes de vitesse : un dégradé conique répété, comme un impact de manga. */}
      <div
        data-boom-lines
        className="absolute size-[160vmax] opacity-0"
        style={{
          background: 'repeating-conic-gradient(from 0deg, rgba(255,255,255,0.85) 0deg 1.2deg, transparent 1.2deg 9deg)',
          maskImage: 'radial-gradient(circle, transparent 12%, black 30%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(circle, transparent 12%, black 30%, transparent 70%)',
        }}
      />
      {[0, 1].map((index) => (
        <div key={index} data-boom-wave className="absolute size-48 rounded-full border-[6px] border-[#ffe7a0] opacity-0" style={{ boxShadow: '0 0 40px #ff7a3d, inset 0 0 30px #ff7a3d' }} />
      ))}
      {Array.from({ length: 14 }, (_, index) => (
        <span
          key={index}
          data-boom-shard
          className="absolute size-3 rotate-45 opacity-0"
          style={{ background: index % 3 === 0 ? '#fff4c8' : index % 3 === 1 ? '#ff7a3d' : '#b46cff', borderRadius: index % 2 ? 2 : 999 }}
        />
      ))}
      <div data-boom-word className="relative flex flex-col items-center opacity-0">
        <span className="font-display text-[9rem] leading-none text-white" style={{ textShadow: '0 0 30px #ff3b3b, 0 0 60px #ff7a3d, 4px 4px 0 #2b0a1a' }}>
          爆
        </span>
        <span className="mt-1 text-3xl font-black tracking-[0.3em] text-[#fff4c8] uppercase" style={{ textShadow: '3px 3px 0 #2b0a1a, 0 0 18px #ff7a3d' }}>
          {label}
        </span>
      </div>
    </div>
  )
}
