import { useRef, useState } from 'react'
import { Quote } from 'lucide-react'
import { useT } from '../../i18n'
import { pickQuote, quotePortrait } from '../../lib/bombQuotes'
import { gsap, useGSAP } from '../../lib/gsap'

/**
 * Après une défaite : une réplique d'anime pour repartir au combat (Naruto, Luffy, Rengoku…),
 * avec le portrait du personnage quand le BookshelfDLE l'a, sinon son initiale sur un médaillon.
 * Une nouvelle réplique à chaque fin de partie.
 */
export function QuoteCard({ delay = 0.4 }: { delay?: number }) {
  const t = useT()
  const rootRef = useRef<HTMLElement>(null)
  const [quote] = useState(pickQuote)
  const [portraitFailed, setPortraitFailed] = useState(false)
  const lines = t.bomb.quotes[quote.id]
  const portrait = portraitFailed ? null : quotePortrait(quote)

  useGSAP(
    () => {
      gsap.fromTo(rootRef.current, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, delay, ease: 'power2.out' })
      gsap.fromTo('[data-quote-portrait]', { scale: 0.6, rotation: -12 }, { scale: 1, rotation: 0, duration: 0.6, delay: delay + 0.1, ease: 'back.out(2)' })
    },
    { scope: rootRef },
  )

  return (
    <figure
      ref={rootRef}
      className="relative w-full overflow-hidden rounded-2xl border border-white/10 p-3.5 text-left opacity-0"
      style={{ background: `linear-gradient(135deg, ${quote.tint}22, rgba(255,255,255,0.03) 55%)` }}
    >
      <Quote size={44} aria-hidden className="absolute -top-1 -right-1 rotate-180 opacity-10" style={{ color: quote.tint }} />
      <figcaption className="mb-2 text-[10px] tracking-[0.18em] text-mist uppercase">{t.bomb.quotes.label}</figcaption>
      <div className="flex items-start gap-3">
        <span
          data-quote-portrait
          className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full p-[2px]"
          style={{ background: `linear-gradient(140deg, ${quote.tint}, #ffffff55)` }}
        >
          {portrait ? (
            <img src={portrait} alt="" loading="lazy" onError={() => setPortraitFailed(true)} className="size-full rounded-full bg-[#0d0b18] object-cover object-top" />
          ) : (
            <span className="grid size-full place-items-center rounded-full bg-[#0d0b18] font-display text-xl" style={{ color: quote.tint }}>
              {lines.by.charAt(0)}
            </span>
          )}
        </span>
        <blockquote className="min-w-0 flex-1">
          <p className="font-display text-[1.05rem] leading-snug text-cream italic">« {lines.text} »</p>
          <p className="mt-1.5 text-[11px] text-mist">
            — <span className="font-semibold" style={{ color: quote.tint }}>{lines.by}</span> · {lines.from}
          </p>
        </blockquote>
      </div>
    </figure>
  )
}
