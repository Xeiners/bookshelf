import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { GUEST_BOOSTERS } from '../lib/boosters'

/**
 * Boosters d'essai d'un invité : les reçus signés par le serveur (un par
 * booster ouvert, cf. `backend/src/modules/cards/guestPacks.ts`). Ils sont la
 * collection de l'invité ; à l'inscription, le serveur les transforme en
 * cartes du compte, puis ils sont effacés.
 */
interface GuestCardsState {
  receipts: string[]
  add: (receipt: string) => void
  clear: () => void
}

export const useGuestCardsStore = create<GuestCardsState>()(
  persist(
    (set) => ({
      receipts: [],
      add: (receipt) => set((state) => ({ receipts: [...state.receipts, receipt].slice(0, GUEST_BOOSTERS) })),
      clear: () => set({ receipts: [] }),
    }),
    { name: 'bookshelf:guest-cards:v1', version: 1 },
  ),
)
