import { create } from 'zustand'
import { dailyApi, type DailyClaim, type DailyStatus } from '../services/dailyApi'
import { ApiError } from '../services/api'
import { useAuthStore } from './useAuthStore'
import { useBoosterStore } from './useBoosterStore'
import { useCollectionStore } from './useCollectionStore'
import { useDleStore } from './useDleStore'
import { useRunnerWardrobe } from './useRunnerWardrobeStore'

/**
 * Récompense quotidienne. Le calendrier s'ouvre de lui-même à la première connexion du jour
 * (de minuit à 23 h 59, heure de Paris) tant que la case n'est pas prise ; il se rouvre à
 * volonté depuis les Activités.
 */
interface DailyState {
  status: DailyStatus | null
  open: boolean
  /** Jour pour lequel le calendrier s'est déjà ouvert tout seul : une fois par jour et par session. */
  autoOpenedFor: string | null
  /** Ce qu'on vient de gagner : la fenêtre présente la récompense avant de revenir au calendrier. */
  reward: DailyClaim | null
  /** Relit le calendrier ; `auto` : l'ouvre s'il y a une case à prendre. */
  load: (auto?: boolean) => Promise<void>
  claim: () => Promise<DailyClaim>
  show: () => void
  /** Ferme la récompense reçue (retour au calendrier). */
  dismissReward: () => void
  close: () => void
  reset: () => void
}

export const useDailyStore = create<DailyState>((set, get) => ({
  status: null,
  open: false,
  autoOpenedFor: null,
  reward: null,

  load: async (auto = false) => {
    if (!useAuthStore.getState().user) return
    try {
      const status = await dailyApi.status()
      const state = get()
      const opens = auto && status.claimable && state.autoOpenedFor !== status.today
      set({ status, ...(opens && { open: true, autoOpenedFor: status.today }) })
    } catch {
      // Hors-ligne : on réessaiera à la prochaine occasion.
    }
  },

  claim: async () => {
    try {
      const result = await dailyApi.claim()
      set({ status: result.status, reward: result })
      // Les stocks affichés suivent : Poussières, boosters, boîtes, album.
      useDleStore.getState().setStardust(result.balance)
      void useBoosterStore.getState().refresh()
      if (result.reward.boxes > 0) void useRunnerWardrobe.getState().load()
      if (result.cards.length > 0) useCollectionStore.getState().reset()
      return result
    } catch (error) {
      // Déjà prise (autre appareil) : le calendrier se remet à jour.
      if (error instanceof ApiError && error.code === 'daily_claimed') void get().load()
      throw error
    }
  },

  show: () => {
    set({ open: true })
    void get().load()
  },
  dismissReward: () => set({ reward: null }),
  close: () => set({ open: false, reward: null }),
  reset: () => set({ status: null, open: false, autoOpenedFor: null, reward: null }),
}))
