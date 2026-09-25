import { useRef } from 'react'
import { Zap } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'

interface StreakBadgeProps {
  /** Série en cours (0 si rompue). */
  streak: number
  best: number
}

/**
 * Compteur de série « ⚡ 7 jours d'affilée ». Pastille néo-brutaliste (bord
 * franc, ombre portée dure) ; l'éclair s'allume et la pastille « claque » quand
 * la série augmente.
 */
export function StreakBadge({ streak, best }: StreakBadgeProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const previous = useRef(streak)

  useGSAP(
    () => {
      const grew = streak > previous.current
      previous.current = streak
      if (!grew) return
      gsap
        .timeline()
        .fromTo(rootRef.current, { scale: 1.18 }, { scale: 1, duration: 0.7, ease: EASE.spring })
        .fromTo('[data-streak-bolt]', { rotate: -25, scale: 1.6 }, { rotate: 0, scale: 1, duration: 0.6, ease: EASE.snap }, 0)
    },
    { dependencies: [streak], scope: rootRef },
  )

  const active = streak > 0

  return (
    <div
      ref={rootRef}
      className={`inline-flex items-center gap-2 rounded-xl border-2 px-3 py-1.5 ${
        active ? 'border-gold bg-void text-gold shadow-[3px_3px_0_0_var(--color-gold)]' : 'border-cream/25 bg-void/60 text-mist'
      }`}
    >
      <Zap data-streak-bolt size={14} strokeWidth={2.5} className={active ? 'fill-gold' : ''} />
      <span className="text-[11px] font-semibold tracking-[0.08em] uppercase">
        {active ? t.oracle.streak(streak) : t.oracle.streakNone}
      </span>
      {best > 1 && (
        <span className="border-l border-current/30 pl-2 text-[10px] font-medium opacity-70">{t.oracle.streakBest(best)}</span>
      )}
    </div>
  )
}
