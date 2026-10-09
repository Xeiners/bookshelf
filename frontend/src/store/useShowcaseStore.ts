import { create } from 'zustand'

/** Présentation de cartes montrées par un membre, rejouée depuis la liste des notifications. */
interface ShowcaseState {
  /** Notification `card_share` à rejouer, même déjà lue. */
  replaying: string | null
  replay: (id: string) => void
  clear: () => void
}

export const useShowcaseStore = create<ShowcaseState>((set) => ({
  replaying: null,
  replay: (id) => set({ replaying: id }),
  clear: () => set({ replaying: null }),
}))
