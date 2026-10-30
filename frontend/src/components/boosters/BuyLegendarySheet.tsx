import { createPortal } from 'react-dom'
import { Crown } from 'lucide-react'
import { useT } from '../../i18n'
import { LEGENDARY_PACK_MYTHIC_CHANCE, LEGENDARY_PACK_PRICE, RARITY_STYLE } from '../../lib/boosters'
import { vibrate } from '../../lib/haptics'
import { useUiStore } from '../../store/useUiStore'
import { Sheet } from '../ui/Sheet'
import { BoosterPackArt } from './BoosterPackArt'

const percent = (value: number) => `${Math.round(value * 1000) / 10} %`

/**
 * Booster Légendaire de la boutique : le paquet, les chances de sa dernière carte, et « Acheter
 * et ouvrir ». Le débit et le tirage partent ensemble, à l'ouverture de la fenêtre des boosters.
 */
export function BuyLegendarySheet({ balance, onClose }: { balance: number; onClose: () => void }) {
  const t = useT()
  const copy = t.activities.shop
  const affordable = balance >= LEGENDARY_PACK_PRICE

  const buy = (dismiss: () => void) => {
    if (!affordable) return
    vibrate([12, 40, 20])
    dismiss()
    useUiStore.getState().buyLegendaryPack()
  }

  const odds = [
    { label: copy.legendaryRate, value: 1 - LEGENDARY_PACK_MYTHIC_CHANCE, color: RARITY_STYLE.LEGENDARY.color },
    { label: copy.mythicRate, value: LEGENDARY_PACK_MYTHIC_CHANCE, color: RARITY_STYLE.MYTHIC.color },
  ]

  return createPortal(
    <Sheet
      label={copy.legendaryTitle}
      title={copy.legendaryTitle}
      subtitle={copy.legendarySheetSubtitle}
      onClose={onClose}
      footer={(dismiss) => (
        <button
          type="button"
          disabled={!affordable}
          onClick={() => buy(dismiss)}
          className="btn-cta inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-bold transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          <Crown size={17} aria-hidden />
          {copy.legendaryBuy(LEGENDARY_PACK_PRICE)}
        </button>
      )}
    >
      <div className="flex flex-col items-center gap-4 pb-1">
        <span className="relative grid place-items-center py-2">
          <span aria-hidden className="absolute size-40 rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(255,196,107,0.35), transparent)' }} />
          <span className="relative -rotate-6">
            <BoosterPackArt width={86} series={3} lit halo="LEGENDARY" />
          </span>
        </span>
        <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="mb-2 text-[10px] font-semibold tracking-[0.2em] text-cream/55 uppercase">{copy.legendaryOdds}</p>
          <ul className="flex flex-col gap-1.5">
            {odds.map((odd) => (
              <li key={odd.label} className="flex items-center gap-2 text-sm">
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: odd.color }} />
                <span className="flex-1 font-semibold" style={{ color: odd.color }}>
                  {odd.label}
                </span>
                <span className="text-cream/80 tabular-nums">{percent(odd.value)}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-center text-xs text-cream/55 tabular-nums">{affordable ? copy.balance(balance) : copy.short(LEGENDARY_PACK_PRICE - balance)}</p>
      </div>
    </Sheet>,
    document.body,
  )
}
