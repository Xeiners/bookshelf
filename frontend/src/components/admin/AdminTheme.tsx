import { useEffect, useState } from 'react'
import { Check, Loader2, Palette } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { vibrate } from '../../lib/haptics'
import { SITE_THEMES, type SiteTheme } from '../../services/themeApi'
import { useThemeStore } from '../../store/useThemeStore'
import { useUiStore } from '../../store/useUiStore'

/** Aperçu de chaque thème : un fond, une pastille. */
const PREVIEW: Record<SiteTheme, string> = {
  none: 'radial-gradient(80% 70% at 20% 10%, rgba(124,92,255,0.45), transparent 70%), #0b0b12',
  halloween: 'radial-gradient(60% 55% at 80% 15%, rgba(255,214,150,0.85), rgba(255,122,26,0.35) 35%, transparent 60%), linear-gradient(180deg, #1a0b26, #07040c)',
}

/**
 * Thème saisonnier : habiller l'app pour une fête (Halloween…) pour tout le monde, ou la
 * remettre telle quelle. Le changement s'applique tout de suite ici, et chez les autres à leur
 * prochaine ouverture (ou au retour sur l'app).
 */
export function AdminTheme() {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const theme = useThemeStore((state) => state.theme)
  const [pending, setPending] = useState<SiteTheme | null>(null)

  // Le thème affiché peut dater : on relit celui du serveur en ouvrant l'onglet.
  useEffect(() => {
    void useThemeStore.getState().load(true)
  }, [])

  const apply = async (next: SiteTheme) => {
    if (next === theme || pending) return
    setPending(next)
    try {
      await useThemeStore.getState().change(next)
      vibrate([10, 40, 18])
      notify(t.admin.theme.applied(t.admin.theme.names[next]), 'like')
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <section className="glass flex flex-col gap-4 rounded-[1.5rem] p-4">
        <h2 className="flex items-center gap-2 font-display text-xl">
          <Palette size={20} className="text-glow" aria-hidden />
          {t.admin.theme.title}
        </h2>
        <p className="-mt-2 text-xs text-mist">{t.admin.theme.subtitle}</p>
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t.admin.theme.title}>
          {SITE_THEMES.map((value) => {
            const active = value === theme
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={pending !== null}
                onClick={() => void apply(value)}
                className={`flex flex-col overflow-hidden rounded-2xl border text-left transition-colors ${active ? 'border-glow' : 'border-white/10 hover:border-white/25'}`}
              >
                <span aria-hidden className="relative block h-20" style={{ background: PREVIEW[value] }}>
                  {active && (
                    <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-glow text-void">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  )}
                  {pending === value && (
                    <span className="absolute inset-0 grid place-items-center bg-black/40">
                      <Loader2 size={20} className="animate-spin text-cream" />
                    </span>
                  )}
                </span>
                <span className="flex flex-col gap-0.5 p-3">
                  <span className="text-sm font-semibold text-cream">{t.admin.theme.names[value]}</span>
                  <span className="text-[11px] leading-snug text-mist">{t.admin.theme.descriptions[value]}</span>
                </span>
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-mist">{t.admin.theme.note}</p>
      </section>
    </div>
  )
}
