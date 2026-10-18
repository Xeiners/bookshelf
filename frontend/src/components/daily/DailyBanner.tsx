import { CalendarCheck, ChevronRight, Flame } from 'lucide-react'
import { useT } from '../../i18n'
import { CYCLE_DAYS } from '../../services/dailyApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDailyStore } from '../../store/useDailyStore'

/**
 * Entrée des Activités vers le calendrier de récompenses : la case du jour à prendre
 * (point lumineux), ou la série en cours et le retour le lendemain. Rien en invité.
 */
export function DailyBanner() {
  const t = useT()
  const signedIn = useAuthStore((state) => state.user !== null)
  const status = useDailyStore((state) => state.status)
  const show = useDailyStore((state) => state.show)
  if (!signedIn || !status) return null
  const ready = status.claimable
  const done = Math.min(status.streak, CYCLE_DAYS)
  return (
    <button
      type="button"
      onClick={show}
      className="relative isolate flex w-full shrink-0 items-center gap-3 rounded-[1.75rem] border px-4 py-3.5 text-left"
      style={{ backgroundColor: '#101017', borderColor: ready ? '#ffc46b88' : '#ffc46b38' }}
    >
      <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl text-[#3a2200]" style={{ background: 'linear-gradient(150deg, #fff6c8, #ffc23a 55%, #ff8a3d)' }}>
        <CalendarCheck size={22} aria-hidden />
        {ready && <span aria-hidden className="absolute -top-1 -right-1 size-3 animate-pulse rounded-full bg-[#ff4d6d] ring-2 ring-[#101017]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-cream">{t.daily.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-cream/60">
          {ready ? (
            t.daily.hub.ready
          ) : (
            <>
              {status.streak > 0 && <Flame size={12} className="text-[#ff9b3d]" aria-hidden />}
              {t.daily.hub.done(done, CYCLE_DAYS)}
            </>
          )}
        </span>
        <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-cream/10">
          <span className="block h-full rounded-full bg-gradient-to-r from-[#ffc23a] to-[#ff5ec4]" style={{ width: `${(done / CYCLE_DAYS) * 100}%` }} />
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-cream/40" aria-hidden />
    </button>
  )
}
