import { Fragment, useRef, useState } from 'react'
import { Quote } from 'lucide-react'
import { useT } from '../../i18n'
import { pickQuote, quotePortrait } from '../../lib/bombQuotes'
import { reducedMotion } from '../../lib/dle'
import { EASE, gsap, useGSAP } from '../../lib/gsap'

/**
 * Après une défaite : une réplique d'anime pour repartir au combat (Naruto, Luffy, Rengoku…),
 * avec le portrait du personnage (son initiale sur un médaillon si l'image ne vient pas).
 * Une nouvelle réplique à chaque fin de partie, qui entre en scène : la carte surgit, le
 * portrait atterrit dans une onde de choc, un reflet balaie la carte et la phrase s'écrit
 * mot à mot.
 */
export function QuoteCard({ delay = 0.4 }: { delay?: number }) {
  const t = useT()
  const rootRef = useRef<HTMLElement>(null)
  const [quote] = useState(pickQuote)
  const [portraitFailed, setPortraitFailed] = useState(false)
  const lines = t.bomb.quotes[quote.id]
  const portrait = portraitFailed ? null : quotePortrait(quote)
  const words = `«\u00a0${lines.text}\u00a0»`.split(' ') // i18n-ignore

  useGSAP(
    () => {
      if (reducedMotion()) {
        gsap.fromTo(rootRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4, delay })
        return
      }
      const glow = `0 0 0 1px ${quote.tint}55, 0 18px 50px -12px ${quote.tint}aa`
      gsap
        .timeline({ delay })
        .fromTo(
          rootRef.current,
          { opacity: 0, y: 40, scale: 0.82, rotationX: 28, transformPerspective: 700, boxShadow: `0 0 0 0px ${quote.tint}00` },
          { opacity: 1, y: 0, scale: 1, rotationX: 0, boxShadow: glow, duration: 0.75, ease: EASE.snap },
        )
        .fromTo('[data-quote-portrait]', { scale: 2.4, opacity: 0, rotation: -25, filter: 'blur(6px)' }, { scale: 1, opacity: 1, rotation: 0, filter: 'blur(0px)', duration: 0.7, ease: EASE.spring }, '-=0.45')
        .fromTo('[data-quote-ring]', { scale: 0.9, opacity: 0.9 }, { scale: 2.6, opacity: 0, duration: 0.9, ease: 'power2.out', stagger: 0.18 }, '-=0.45')
        .fromTo('[data-quote-shine]', { xPercent: -110, opacity: 1 }, { xPercent: 320, duration: 1.2, ease: 'power2.inOut' }, '<')
        .fromTo('[data-quote-word]', { opacity: 0, y: 14, filter: 'blur(4px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.45, stagger: 0.045, ease: 'power3.out' }, '-=1.0')
        .fromTo('[data-quote-by]', { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.5 }, '-=0.2')
        .to(rootRef.current, { boxShadow: `0 0 0 1px ${quote.tint}33, 0 12px 36px -14px ${quote.tint}66`, duration: 1.2, ease: 'sine.out' })
    },
    { scope: rootRef },
  )

  return (
    <figure
      ref={rootRef}
      className="relative w-full overflow-hidden rounded-2xl border border-white/10 p-4 text-left opacity-0"
      style={{ background: `linear-gradient(135deg, ${quote.tint}30, rgba(255,255,255,0.04) 60%)` }}
    >
      <span
        data-quote-shine
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 opacity-0"
        style={{ background: 'linear-gradient(105deg, transparent 20%, rgba(255,255,255,0.24), transparent 80%)' }}
      />
      <Quote size={56} aria-hidden className="absolute -top-1 -right-1 rotate-180 opacity-15" style={{ color: quote.tint }} />
      <figcaption className="mb-2.5 text-[10px] font-semibold tracking-[0.2em] uppercase" style={{ color: quote.tint }}>
        {t.bomb.quotes.label}
      </figcaption>
      <div className="flex items-center gap-3.5">
        <span className="relative shrink-0">
          {[0, 1].map((ring) => (
            <span key={ring} data-quote-ring aria-hidden className="absolute inset-0 rounded-full border-2 opacity-0" style={{ borderColor: quote.tint }} />
          ))}
          <span
            data-quote-portrait
            className="relative grid size-16 place-items-center overflow-hidden rounded-full p-[2.5px]"
            style={{ background: `linear-gradient(140deg, ${quote.tint}, #ffffff88)`, boxShadow: `0 0 22px ${quote.tint}88` }}
          >
            {portrait ? (
              <img src={portrait} alt={lines.by} loading="lazy" onError={() => setPortraitFailed(true)} className="size-full rounded-full bg-[#0d0b18] object-cover object-top" />
            ) : (
              <span className="grid size-full place-items-center rounded-full bg-[#0d0b18] font-display text-2xl" style={{ color: quote.tint }}>
                {lines.by.charAt(0)}
              </span>
            )}
          </span>
        </span>
        <blockquote className="min-w-0 flex-1">
          <p className="font-display text-[1.1rem] leading-snug text-cream italic">
            {words.map((word, index) => (
              <Fragment key={index}>
                <span data-quote-word className="inline-block">
                  {word}
                </span>{' '}
              </Fragment>
            ))}
          </p>
          <p data-quote-by className="mt-2 text-[11px] text-mist">
            — <span className="font-semibold" style={{ color: quote.tint }}>{lines.by}</span> · {lines.from}
          </p>
        </blockquote>
      </div>
    </figure>
  )
}
