import { useEffect } from 'react'
import { Boxes, Brush, Gift, Library, PartyPopper, Repeat2, Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import type { PatchIcon } from '../../lib/patchNotes'
import { useAuthStore } from '../../store/useAuthStore'
import { useDailyStore } from '../../store/useDailyStore'
import { usePatchNotes } from '../../store/usePatchNotes'
import { useUiStore } from '../../store/useUiStore'
import { Sheet } from '../ui/Sheet'

/** Délai avant la première ouverture : le temps que la récompense du jour (s'il y en a une) se présente d'abord. */
const OPEN_DELAY_MS = 2600

const ICONS: Record<PatchIcon, typeof Sparkles> = {
  stack: Boxes,
  gift: Gift,
  dust: Sparkles,
  market: Repeat2,
  library: Library,
  canvas: Brush,
}

/**
 * « Nouveautés » : s'ouvre une fois par version, à l'ouverture du site, une fois le calendrier du jour
 * refermé (jamais par-dessus lui, ni de la fenêtre de connexion). Se rouvre depuis les Paramètres.
 * À monter une fois, dans `App`.
 */
export function PatchNotesModal() {
  const t = useT()
  const open = usePatchNotes((state) => state.open)
  const dailyOpen = useDailyStore((state) => state.open)
  const authOpen = useUiStore((state) => state.authOpen)
  const signedIn = useAuthStore((state) => state.user !== null)

  useEffect(() => {
    const timer = window.setTimeout(() => usePatchNotes.getState().showIfNew(), OPEN_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  // Le calendrier du jour d'abord : la feuille attend qu'il soit refermé (et revient ensuite).
  if (!open || (signedIn && dailyOpen) || authOpen) return null
  return (
    <Sheet
      label={t.patchNotes.title}
      title={t.patchNotes.title}
      subtitle={t.patchNotes.subtitle}
      onClose={() => usePatchNotes.getState().close()}
      footer={(dismiss) => (
        <button type="button" onClick={dismiss} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-cream text-sm font-semibold text-void transition-transform active:scale-[0.98]">
          <PartyPopper size={17} aria-hidden />
          {t.patchNotes.close}
        </button>
      )}
    >
      <ul className="flex flex-col gap-2.5">
        {t.patchNotes.items.map((item) => {
          const Icon = ICONS[item.icon]
          return (
            <li key={item.title} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
                <Icon size={19} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-cream">{item.title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-cream/70">{item.text}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
