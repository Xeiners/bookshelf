import { useEffect } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { NEWS, newsDate, type NewsEntry } from '../../lib/news'
import { useNews } from '../../store/useNews'
import { runNewsAction } from './newsActions'
import { NewsVisual } from './NewsVisual'

/**
 * Page « Actus » : toutes les nouveautés, en images. La plus récente à la une (grande
 * illustration), les autres en cartes. Chaque carte mène à ce dont elle parle.
 */
export function NewsPage() {
  const t = useT()
  const close = useNews((state) => state.closePage)
  const [featured, ...others] = NEWS

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div role="dialog" aria-modal="true" aria-label={t.news.title} className="fixed inset-0 z-[88] overflow-y-auto overscroll-contain bg-void text-cream">
      <header className="sticky top-0 z-10 border-b border-white/5 bg-void/85 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button type="button" onClick={close} aria-label={t.news.back} className="grid size-10 place-items-center rounded-full bg-white/[0.06] active:scale-95">
            <ArrowLeft size={19} />
          </button>
          <div>
            <p className="text-[10px] tracking-[0.28em] text-mist uppercase">{t.news.subtitle}</p>
            <h1 className="font-display text-2xl leading-tight">{t.news.title}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {featured && <NewsCard entry={featured} featured />}
        <div className="grid gap-5 md:grid-cols-2">
          {others.map((entry) => (
            <NewsCard key={entry.id} entry={entry} />
          ))}
        </div>
      </main>
    </div>
  )
}

function NewsCard({ entry, featured = false }: { entry: NewsEntry; featured?: boolean }) {
  const t = useT()
  const language = useLanguage()
  const copy = t.news.items[entry.id]
  return (
    <article
      className={`overflow-hidden rounded-[1.75rem] border bg-[#0e0d14] ${featured ? 'border-[#ff5ec4]/35 md:grid md:grid-cols-[1.1fr_1fr]' : 'border-white/10'}`}
    >
      <div className={`relative w-full ${featured ? 'aspect-[16/11] md:aspect-auto md:min-h-80' : 'aspect-[16/9]'}`}>
        <NewsVisual id={entry.id} />
      </div>
      <div className={`flex flex-col gap-2.5 ${featured ? 'p-5 md:justify-center md:p-7' : 'p-4'}`}>
        <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] uppercase">
          <span className={`rounded-full px-2.5 py-1 ${featured ? 'bg-[#ff5ec4]/20 text-[#ff9ad8]' : 'bg-white/[0.07] text-cream/75'}`}>{copy.tag}</span>
          <span className="text-mist">{newsDate(entry.date, language)}</span>
          {featured && <span className="ml-auto rounded-full bg-[#ff4d6d] px-2 py-0.5 text-[10px] text-white">{t.news.fresh}</span>}
        </p>
        <h2 className={`font-display leading-tight ${featured ? 'text-[1.7rem]' : 'text-xl'}`}>{copy.title}</h2>
        <p className={`leading-relaxed text-cream/70 ${featured ? 'text-[15px]' : 'text-sm'}`}>{copy.text}</p>
        {entry.action && (
          <button
            type="button"
            onClick={() => runNewsAction(entry.action!)}
            className={
              featured
                ? 'mt-2 inline-flex h-12 items-center justify-center gap-2 self-start rounded-full px-6 text-sm font-semibold text-white active:scale-[0.98]'
                : 'mt-1 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-[#ff9ad8] hover:text-[#ffc2e8]'
            }
            style={featured ? { background: 'linear-gradient(135deg, #ff5ec4, #7c5cff)', boxShadow: '0 10px 26px -10px rgba(255,94,196,0.9)' } : undefined}
          >
            {copy.cta}
            <ArrowRight size={featured ? 16 : 14} aria-hidden />
          </button>
        )}
      </div>
    </article>
  )
}
