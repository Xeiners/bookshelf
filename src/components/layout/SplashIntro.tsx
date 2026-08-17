import { useRef } from 'react'
import { gsap, useGSAP } from '../../lib/gsap'

const WORD = 'Bookshelf'

interface SplashIntroProps {
  onDone: () => void
}

/**
 * Intro « rideau » : titre découpé en caractères masqués, révélés en cascade,
 * puis sortie par `clip-path` — GSAP interpole les nombres dans `inset(...)`.
 */
export function SplashIntro({ onDone }: SplashIntroProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useGSAP(
    () => {
      const timeline = gsap.timeline({
        defaults: { ease: 'expo.out' },
        onComplete: () => doneRef.current(),
      })

      timeline
        .from('[data-eyebrow]', { yPercent: 120, autoAlpha: 0, duration: 0.7 })
        .from(
          '[data-char]',
          { yPercent: 115, duration: 1, stagger: 0.045, ease: 'power4.out' },
          0.12,
        )
        .from('[data-rule]', { scaleX: 0, duration: 1.1, ease: 'expo.inOut' }, 0.3)
        .from('[data-tagline]', { autoAlpha: 0, y: 14, duration: 0.7 }, 0.62)
        .to('[data-char]', { yPercent: -115, duration: 0.7, stagger: 0.03 }, '+=0.45')
        .to('[data-eyebrow], [data-tagline]', { autoAlpha: 0, duration: 0.4 }, '<')
        .to('[data-rule]', { scaleX: 0, transformOrigin: 'right center', duration: 0.6 }, '<')
        .to(
          rootRef.current,
          {
            clipPath: 'inset(0% 0% 100% 0%)',
            duration: 0.9,
            ease: 'expo.inOut',
          },
          '-=0.35',
        )
    },
    { scope: rootRef },
  )

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] flex flex-col justify-center bg-void px-7"
      style={{ clipPath: 'inset(0% 0% 0% 0%)' }}
    >
      <div className="overflow-hidden">
        <p data-eyebrow className="text-[10px] tracking-[0.42em] text-glow uppercase">
          Bibliothèque vivante
        </p>
      </div>

      <h1 className="mt-3 flex flex-wrap font-display text-[clamp(3.25rem,19vw,6rem)] leading-[0.9]">
        {WORD.split('').map((char, index) => (
          <span key={`${char}-${index}`} className="inline-block overflow-hidden pb-[0.08em]">
            <span data-char className="inline-block">
              {char}
            </span>
          </span>
        ))}
      </h1>

      <div data-rule className="mt-5 h-px w-full origin-left bg-cream/25" />

      <p data-tagline className="mt-5 max-w-[18rem] text-sm leading-relaxed text-mist">
        Swipe à droite ce qui t'attire, à gauche ce qui attendra.
      </p>
    </div>
  )
}
