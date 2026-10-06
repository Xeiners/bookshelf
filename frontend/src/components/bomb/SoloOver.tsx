import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Crown, Loader2, RotateCcw, Sparkle } from 'lucide-react'
import { useT } from '../../i18n'
import { reducedMotion } from '../../lib/dle'
import { gsap, useGSAP } from '../../lib/gsap'
import type { SoloView } from '../../services/bombApi'
import { STARDUST_GRADIENT } from '../dle/dleStyle'

interface SoloOverProps {
  over: NonNullable<SoloView['over']>
  restarting: boolean
  onHome: () => void
  onReplay: () => void
}

/**
 * Fin d'une partie solo, en plein écran : le jeu s'estompe derrière un voile flouté et coloré,
 * la carte du bilan arrive (et pétille sur un nouveau record). Rendue sur <body> : un parent
 * animé ne peut pas l'enfermer dans un cadre.
 */
export function SoloOver({ over, restarting, onHome, onReplay }: SoloOverProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const record = over.record && over.words > 0

  useGSAP(
    () => {
      gsap.fromTo('[data-over-veil]', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' })
      gsap.fromTo('[data-over-card]', { y: 28, scale: 0.92, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.55, ease: 'back.out(1.6)', delay: 0.08 })
      gsap.fromTo('[data-over-line]', { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.07, delay: 0.25, ease: 'power2.out' })
      if (record && !reducedMotion()) {
        gsap.fromTo(
          '[data-over-spark]',
          { scale: 0, opacity: 1 },
          { scale: 1.6, opacity: 0, rotation: 120, duration: 1.1, stagger: { each: 0.09, repeat: -1, repeatDelay: 0.8 }, ease: 'power2.out', delay: 0.5 },
        )
      }
    },
    { scope: rootRef },
  )

  return createPortal(
    <div ref={rootRef} role="dialog" aria-modal aria-label={t.bomb.over.title} className="fixed inset-0 z-[120] grid place-items-center px-6">
      <div
        data-over-veil
        className="absolute inset-0 backdrop-blur-md"
        style={{ background: 'radial-gradient(circle at 50% 42%, rgba(124,92,255,0.28), rgba(255,94,156,0.08) 35%, rgba(5,4,10,0.88) 70%)' }}
      />
      <div
        data-over-card
        className="relative flex w-full max-w-sm flex-col items-center gap-3 overflow-hidden rounded-[2rem] border border-transparent px-6 pt-7 pb-6 text-center"
        style={{
          background: 'linear-gradient(165deg, rgba(26,20,44,0.97), rgba(10,8,18,0.98)) padding-box, linear-gradient(140deg, #6fd6ff, #b46cff 45%, #ff5e9c) border-box',
          boxShadow: '0 30px 80px -30px rgba(124,92,255,0.75)',
        }}
      >
        <span aria-hidden className="absolute -top-24 left-1/2 size-56 -translate-x-1/2 rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(255,94,156,0.25), transparent)' }} />
        {record &&
          [12, 30, 70, 88].map((left, index) => (
            <Sparkle key={left} data-over-spark size={14 + (index % 2) * 6} className="absolute fill-gold text-gold" style={{ left: `${left}%`, top: `${12 + (index % 2) * 14}%` }} aria-hidden />
          ))}
        <p data-over-line className="relative text-[11px] tracking-[0.22em] text-mist uppercase">
          {t.bomb.over.title}
        </p>
        <p data-over-line className="relative font-display text-7xl leading-none text-cream tabular-nums">
          {over.words}
        </p>
        <p data-over-line className="relative -mt-1 text-sm text-cream/70">
          {t.bomb.over.words(over.words)}
        </p>
        <div data-over-line className="relative flex flex-wrap items-center justify-center gap-2">
          {record && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold">
              <Crown size={13} aria-hidden />
              {t.bomb.over.record}
            </span>
          )}
          {over.reward > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-bold text-[#1a0b1f]" style={{ background: STARDUST_GRADIENT, boxShadow: '0 0 22px -4px rgba(255,94,196,0.6)' }}>
              <Sparkle size={14} className="fill-current" aria-hidden />+{over.reward}
            </span>
          )}
        </div>
        {over.capped && <p className="relative text-[11px] text-mist">{t.bomb.over.capped}</p>}
        <p data-over-line className="relative text-xs text-mist">
          {t.bomb.over.best(over.best)}
        </p>
        <div data-over-line className="relative mt-2 flex w-full gap-2">
          <button type="button" onClick={onHome} className="flex-1 rounded-full border border-white/15 bg-white/[0.04] py-3 text-sm text-cream/85 transition-colors hover:bg-white/[0.08]">
            {t.bomb.over.home}
          </button>
          <button
            type="button"
            onClick={onReplay}
            disabled={restarting}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-cream py-3 text-sm font-semibold text-void transition-transform active:scale-95 disabled:opacity-60"
          >
            {restarting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RotateCcw size={15} aria-hidden />}
            {t.bomb.over.again}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
