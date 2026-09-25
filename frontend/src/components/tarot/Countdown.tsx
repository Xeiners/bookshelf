import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { useT } from '../../i18n'
import { formatCountdown, msUntilNextDay } from '../../lib/oracle'

interface CountdownProps {
  /** Appelé à minuit : un nouveau tirage devient possible. */
  onNewDay: () => void
}

/** « Prochain tirage dans 05:12:33 », mis à jour chaque seconde. */
export function Countdown({ onNewDay }: CountdownProps) {
  const t = useT()
  const [remaining, setRemaining] = useState(msUntilNextDay)

  useEffect(() => {
    let previous = msUntilNextDay()
    const timer = window.setInterval(() => {
      const next = msUntilNextDay()
      // Passage de minuit : le reste remonte d'un coup vers ~24 h.
      if (next > previous + 1000) onNewDay()
      previous = next
      setRemaining(next)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [onNewDay])

  return (
    <p className="inline-flex items-center gap-2 text-[11px] tracking-[0.12em] text-mist uppercase tabular-nums">
      <Clock size={12} />
      {t.oracle.nextDraw(formatCountdown(remaining))}
    </p>
  )
}
