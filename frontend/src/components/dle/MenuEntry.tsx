import { useState, type ReactNode } from 'react'
import { Check, Loader2, Zap } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { vibrate } from '../../lib/haptics'
import type { DleMode, DleOverview } from '../../services/dleApi'
import { CARD_SERIES, type CardSeries } from '../../services/cardsApi'
import { useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { BoosterPackArt } from '../boosters/BoosterPackArt'
import { STARDUST_GRADIENT, VERDICT_STYLE } from './dleStyle'

/** Couleur de chaque entrée : un dégradé pour sa pastille, un halo assorti. */
const ACCENT = {
  classic: { gradient: 'linear-gradient(135deg, #b46cff, #7c5cff)', edge: 'rgba(180,108,255,0.55)' },
  zoom: { gradient: 'linear-gradient(135deg, #6fe3ff, #3a86ff)', edge: 'rgba(76,201,240,0.55)' },
  pixel: { gradient: 'linear-gradient(135deg, #ff8ad8, #b46cff 50%, #4cc9f0)', edge: 'rgba(180,108,255,0.55)' },
  multi: { gradient: 'linear-gradient(135deg, #ff8ad8, #ff5e7e)', edge: 'rgba(255,94,196,0.55)' },
  booster: { gradient: 'linear-gradient(135deg, #fff0b0, #e0a82e)', edge: 'rgba(255,196,107,0.55)' },
  room: { gradient: 'linear-gradient(135deg, #7af0c0, #1fae6a)', edge: 'rgba(63,224,160,0.6)' },
} as const

export type MenuAccent = keyof typeof ACCENT

interface MenuEntryProps {
  accent: MenuAccent
  icon: ReactNode
  label: string
  trailing: ReactNode
  onClick: () => void
  disabled?: boolean
}

/**
 * Une entrée de menu du BookshelfDLE, sans cadre : pastille ronde colorée, nom,
 * état à droite. Au survol, un halo de sa couleur glisse derrière la ligne.
 */
export function MenuEntry({ accent, icon, label, trailing, onClick, disabled = false }: MenuEntryProps) {
  const colors = ACCENT[accent]
  return (
    <button
      type="button"
      data-entry
      disabled={disabled}
      onClick={() => {
        vibrate(8)
        onClick()
      }}
      className="group relative flex w-full items-center gap-4 py-3.5 pr-1 text-left transition-transform duration-200 hover:translate-x-1 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-x-0"
    >
      {/* Halo au survol, de la couleur de l'entrée. */}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-4 -right-2 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: `radial-gradient(ellipse at 15% 50%, ${colors.edge.replace(/[\d.]+\)$/, '0.16)')}, transparent 70%)` }} />
      <span aria-hidden className="relative grid size-11 shrink-0 place-items-center rounded-full text-white" style={{ background: colors.gradient, boxShadow: `0 0 22px -4px ${colors.edge}` }}>
        {icon}
      </span>
      <span className="relative min-w-0 flex-1 truncate font-display text-2xl text-cream">{label}</span>
      <span className="relative flex shrink-0 items-center text-cream/50 transition-colors group-hover:text-cream">{trailing}</span>
    </button>
  )
}

/** État d'une énigme du jour : coche et gain, essais en cours, ou point rose « à jouer ». */
export function DailyStatus({ progress }: { progress: DleOverview['daily']['manga'][DleMode] }) {
  const t = useT()
  if (progress.solved) {
    return (
      <span className="inline-flex items-center gap-2">
        {progress.reward > 0 && <span className="text-xs font-semibold text-[#ffd0ee] tabular-nums">{t.dle.earned(progress.reward)}</span>}
        <span className="grid size-7 place-items-center rounded-full text-white" style={{ background: VERDICT_STYLE.exact.solid }}>
          <Check size={16} strokeWidth={3} aria-hidden />
        </span>
      </span>
    )
  }
  if (progress.attempts > 0) return <span className="text-sm font-semibold text-gold tabular-nums">{t.dle.game.attempts(progress.attempts)}</span>
  return <span aria-label={t.dle.home.play} className="size-3 animate-pulse rounded-full bg-[#ff5ec4] shadow-[0_0_12px_#ff5ec4]" />
}

/**
 * Le booster contre des Poussières : un tap propose les deux séries, le choix l'achète
 * et l'ouvre ; sinon, ce qu'il reste à gagner.
 */
export function BoosterEntry({ balance, price }: { balance: number; price: number }) {
  const t = useT()
  const buyBooster = useDleStore((state) => state.buyBooster)
  const notify = useUiStore((state) => state.notify)
  const [busy, setBusy] = useState<CardSeries | null>(null)
  const [picking, setPicking] = useState(false)
  const affordable = balance >= price

  const buy = async (series: CardSeries) => {
    setBusy(series)
    try {
      await buyBooster(series)
      setPicking(false)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <MenuEntry
        accent="booster"
        icon={busy !== null ? <Loader2 size={22} className="animate-spin" aria-hidden /> : <Zap size={22} className="fill-current" aria-hidden />}
        label={t.dle.home.booster}
        disabled={!affordable || busy !== null}
        onClick={() => setPicking((value) => !value)}
        trailing={
          affordable ? (
            <span className="rounded-full px-3 py-1.5 text-sm font-bold text-[#1a0b1f]" style={{ background: STARDUST_GRADIENT }}>
              {price} ✦
            </span>
          ) : (
            <span className="text-sm font-semibold text-mist tabular-nums">
              {balance}/{price} ✦
            </span>
          )
        }
      />
      {picking && affordable && (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t.boosters.choose.title}>
          {CARD_SERIES.map((series) => (
            <button
              key={series}
              type="button"
              disabled={busy !== null}
              onClick={() => void buy(series)}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-left transition-transform active:scale-95 disabled:opacity-60"
            >
              <BoosterPackArt width={40} series={series} lit />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-bold text-cream">{t.boosters.seriesName(series)}</span>
                <span className="truncate text-[11px] text-cream/55">{t.boosters.seriesTagline[series]}</span>
              </span>
              {busy === series && <Loader2 size={16} className="ml-auto animate-spin text-cream/70" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
