import { useEffect, useRef, useState } from 'react'
import { Flame, Sparkle } from 'lucide-react'
import { useCountUp } from '../../hooks/useCountUp'
import { useT } from '../../i18n'
import { formatCountdownLong } from '../../lib/dle'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import type { WorkSummary } from '../../services/dleApi'
import { AnswerCard } from './AnswerCard'
import { STARDUST_GRADIENT } from './dleStyle'
import { inkText } from '../../lib/ink'

interface VictoryPanelProps {
  answer: WorkSummary
  reward: number
  /** Série de jours (énigme du jour). */
  streak?: number
  /** Prochaine énigme. */
  nextAt?: string
  /** Victoire à l'instant : la carte jaillit, le gain défile. Sinon (revenu plus tard) : posé. */
  fresh: boolean
}

/** Énigme résolue : la carte de l'œuvre, retournée et inclinable, et les Poussières gagnées. */
export function VictoryPanel({ answer, reward, streak = 0, nextAt, fresh }: VictoryPanelProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const rewardRef = useCountUp(reward, { duration: fresh ? 1.4 : 0.01, delay: fresh ? 0.6 : 0 })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!nextAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [nextAt])

  useGSAP(
    () => {
      if (!fresh) return
      gsap.fromTo('[data-victory-card]', { rotationY: 180, scale: 0.6, autoAlpha: 0, transformPerspective: 900 }, { rotationY: 0, scale: 1, autoAlpha: 1, duration: 1.1, ease: 'back.out(1.3)' })
      gsap.fromTo('[data-victory-line]', { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.08, delay: 0.45, ease: EASE.swift })
    },
    { scope: rootRef },
  )

  return (
    <div ref={rootRef} className="relative flex flex-col items-center gap-4 overflow-hidden rounded-[1.75rem] border border-like/30 px-5 py-6 text-center" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(63,224,160,0.16), transparent 60%), linear-gradient(160deg, rgba(20,18,32,0.92), rgba(8,8,14,0.94))' }}>
      <div data-victory-card>
        <AnswerCard work={answer} width={150} />
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <p data-victory-line className="font-display text-3xl" style={inkText('linear-gradient(135deg, #dcfff1, #3fe0a0 50%, #4cc9f0)')}>
          {t.dle.game.solvedTitle}
        </p>
        <p data-victory-line className="max-w-xs text-sm text-cream/85">{answer.name}</p>
      </div>
      <div data-victory-line className="flex flex-wrap items-center justify-center gap-2">
        {reward > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-base font-bold text-[#1a0b1f] tabular-nums" style={{ background: STARDUST_GRADIENT, boxShadow: '0 0 26px -4px rgba(255,94,196,0.6)' }}>
            <Sparkle size={16} className="fill-current" aria-hidden />
            +<span ref={rewardRef}>{reward}</span>
          </span>
        )}
        {streak > 1 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold">
            <Flame size={13} aria-hidden />
            {t.dle.game.streak(streak)}
          </span>
        )}
      </div>
      {nextAt && (
        <p data-victory-line className="text-[11px] tracking-[0.12em] text-cream/55 uppercase tabular-nums">
          {t.dle.game.comeBack(formatCountdownLong(Date.parse(nextAt) - now))}
        </p>
      )}
    </div>
  )
}
