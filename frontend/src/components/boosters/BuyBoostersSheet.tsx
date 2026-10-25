import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { vibrate } from '../../lib/haptics'
import { LIVE_SERIES } from '../../services/cardsApi'
import { useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { STARDUST_GRADIENT } from '../dle/dleStyle'
import { Sheet } from '../ui/Sheet'
import { PackCountPicker } from './PackCountPicker'
import { PackStack } from './PackStack'

interface BuyBoostersSheetProps {
  /** Prix d'un booster (promotion comprise). */
  price: number
  balance: number
  onClose: () => void
}

/**
 * Achat de boosters contre des Poussières : on en choisit de 1 à 6, ils rejoignent la réserve
 * (à ouvrir quand on veut, un par un ou plusieurs d'un coup).
 */
export function BuyBoostersSheet({ price, balance, onClose }: BuyBoostersSheetProps) {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const affordable = Math.floor(balance / price)
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const total = price * quantity

  const buy = async (dismiss: () => void) => {
    if (busy || total > balance) return
    setBusy(true)
    try {
      await useDleStore.getState().purchaseBooster(quantity)
      vibrate([10, 40, 18])
      notify(t.activities.shop.bought(quantity), 'like')
      dismiss()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  // Au-dessus de tout (barre de navigation, onglets) : la feuille s'ouvre depuis le milieu d'une page.
  return createPortal(
    <Sheet
      label={t.activities.shop.buyTitle}
      title={t.activities.shop.buyTitle}
      subtitle={t.activities.shop.buySubtitle}
      onClose={onClose}
      footer={(dismiss) => (
        <button
          type="button"
          disabled={busy || total > balance}
          onClick={() => void buy(dismiss)}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-bold text-[#1a0b1f] transition-transform active:scale-[0.98] disabled:opacity-40"
          style={{ background: STARDUST_GRADIENT }}
        >
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />}
          {t.activities.shop.buy(quantity, total)}
        </button>
      )}
    >
      <div className="flex flex-col items-center gap-4 pb-1">
        <PackStack count={quantity} width={64} series={LIVE_SERIES[LIVE_SERIES.length - 1]!} />
        <p className="text-xs font-semibold tracking-[0.16em] text-cream/60 uppercase">{t.activities.shop.quantity}</p>
        <PackCountPicker value={quantity} max={Math.max(1, affordable)} onChange={setQuantity} label={t.activities.shop.quantity} />
        <p className="text-center text-xs text-cream/55 tabular-nums">
          {affordable < 1 ? t.activities.shop.short(price - balance) : t.activities.shop.balance(balance)}
        </p>
      </div>
    </Sheet>,
    document.body,
  )
}
