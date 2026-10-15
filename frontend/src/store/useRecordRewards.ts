import { create } from 'zustand'
import { rewardsApi, type RecordReward, type RewardChoice } from '../services/rewardsApi'
import { useAuthStore } from './useAuthStore'

/**
 * Récompenses de record à choisir. La fenêtre de choix s'ouvre d'elle-même quand une
 * partie bat un record de tous les temps (réponse de fin de partie, ou notification).
 */
interface RecordRewardsState {
  pending: RecordReward[]
  open: boolean
  /** Relit la liste ; `show` : ouvre la fenêtre s'il y a quelque chose à choisir. */
  load: (show?: boolean) => Promise<void>
  /** Une fin de partie annonce un record : la fenêtre s'ouvre tout de suite. */
  push: (reward: RecordReward) => void
  claim: (id: string, choice: RewardChoice) => Promise<RecordReward[]>
  close: () => void
}

export const useRecordRewards = create<RecordRewardsState>((set, get) => ({
  pending: [],
  open: false,
  load: async (show = false) => {
    if (!useAuthStore.getState().user) return
    try {
      const pending = await rewardsApi.pending()
      set({ pending, open: (show || get().open) && pending.length > 0 })
    } catch {
      // Hors-ligne : on réessaiera à la prochaine occasion.
    }
  },
  push: (reward) =>
    set((state) => ({ pending: state.pending.some((item) => item.id === reward.id) ? state.pending : [...state.pending, reward], open: true })),
  claim: async (id, choice) => {
    const { pending } = await rewardsApi.claim(id, choice)
    set({ pending, open: pending.length > 0 })
    return pending
  },
  close: () => set({ open: false }),
}))
