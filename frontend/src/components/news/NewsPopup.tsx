import { useEffect } from 'react'
import { ArrowRight, Newspaper, X } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { NEWS, newsDate } from '../../lib/news'
import { useAuthStore } from '../../store/useAuthStore'
import { useDailyStore } from '../../store/useDailyStore'
import { useNews } from '../../store/useNews'
import { useRetirementStore } from '../../store/useRetirementStore'
import { useUiStore } from '../../store/useUiStore'
import { runNewsAction } from './newsActions'
import { NewsVisual } from './NewsVisual'

/** Délai avant l'ouverture : le temps que la récompense du jour (s'il y en a une) se présente d'abord. */
const OPEN_DELAY_MS = 2600

/**
 * La dernière actu, en grand, à l'ouverture du site : une seule fois par nouveauté et par
 * appareil, jamais par-dessus le calendrier du jour ni la connexion. Le bouton mène droit à ce
 * dont elle parle ; « Toutes les actus » ouvre la page. À monter une fois, dans `App`.
 */
export function NewsPopup() {
  const t = useT()
  const language = useLanguage()
  const open = useNews((state) => state.popup)
  const unseen = useNews((state) => state.unseen)
  const dailyOpen = useDailyStore((state) => state.open)
  const authOpen = useUiStore((state) => state.authOpen)
  const signedIn = useAuthStore((state) => state.user !== null)
  // La conversion des Séries 1 et 2 passe avant : l'actu attendra.
  const retiring = useRetirementStore((state) => state.retirement !== null)

  useEffect(() => {
    const timer = window.setTimeout(() => useNews.getState().showIfNew(), OPEN_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const latest = NEWS[0]
  if (!open || !latest || (signedIn && dailyOpen) || authOpen || retiring) return null
  const copy = t.news.items[latest.id]
  const close = () => useNews.getState().closePopup()

  return (
    <div role="dialog" aria-modal="true" aria-label={copy.title} className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onClick={close}>
      <article
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-t-[2rem] border border-white/10 bg-[#0e0d14] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] motion-safe:animate-[news-in_0.45s_cubic-bezier(0.2,0.9,0.3,1)_both] sm:rounded-[2rem]"
      >
        <div className="relative aspect-[4/3] w-full">
          <NewsVisual id={latest.id} />
          <button type="button" onClick={close} aria-label={t.news.close} className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-black/45 text-cream backdrop-blur active:scale-95">
            <X size={17} />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] uppercase">
            <span className="rounded-full bg-[#ff5ec4]/20 px-2.5 py-1 text-[#ff9ad8]">{copy.tag}</span>
            <span className="text-mist">{newsDate(latest.date, language)}</span>
            {unseen > 1 && <span className="ml-auto text-gold normal-case">{t.news.unseen(unseen)}</span>}
          </p>
          <h2 className="font-display text-2xl leading-tight text-cream">{copy.title}</h2>
          <p className="text-sm leading-relaxed text-cream/70">{copy.text}</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            {latest.action && (
              <button
                type="button"
                onClick={() => runNewsAction(latest.action!)}
                className="inline-flex h-12 items-center sm:flex-1 justify-center gap-2 rounded-full text-sm font-semibold text-white active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #ff5ec4, #7c5cff)', boxShadow: '0 10px 26px -10px rgba(255,94,196,0.9)' }}
              >
                {copy.cta}
                <ArrowRight size={16} aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={() => useNews.getState().openPage()}
              className="inline-flex h-12 items-center sm:flex-1 justify-center gap-2 rounded-full border border-white/12 bg-white/[0.05] text-sm font-semibold text-cream/85 active:scale-[0.98]"
            >
              <Newspaper size={16} aria-hidden />
              {t.news.all}
            </button>
          </div>
        </div>
      </article>
    </div>
  )
}
