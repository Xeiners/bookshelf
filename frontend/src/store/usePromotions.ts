import { create } from 'zustand'
import { promotionsApi, type Promotion, type PromotionTarget } from '../services/promotionsApi'

/**
 * Promotions en cours (boutique) : relues au besoin, au plus une fois par minute ; une
 * notification de promotion les relit tout de suite.
 */
interface PromotionsState {
  items: Promotion[]
  loadedAt: number
  load: (force?: boolean) => Promise<void>
}

export const usePromotions = create<PromotionsState>((set, get) => ({
  items: [],
  loadedAt: 0,
  load: async (force = false) => {
    if (!force && Date.now() - get().loadedAt < 60_000) return
    set({ loadedAt: Date.now() })
    try {
      set({ items: await promotionsApi.active() })
    } catch {
      // Hors-ligne : les prix affichés restent ceux connus (le serveur débite toujours le bon).
    }
  },
}))

/** La promotion en cours sur un article (et encore valable à `now`), ou `null`. */
export const promotionOf = (items: readonly Promotion[], target: PromotionTarget, now = Date.now()): Promotion | null =>
  items.find((item) => item.target === target && item.active && Date.parse(item.endsAt) > now) ?? null
