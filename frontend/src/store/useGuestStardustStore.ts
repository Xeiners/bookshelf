import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getT } from '../i18n'
import { receiptAmount } from '../lib/dle'
import { stardustApi } from '../services/dleApi'
import { useUiStore } from './useUiStore'

/**
 * Poussières d'Étoile gagnées en invité au BookshelfDLE : les reçus signés par le
 * serveur (cf. `backend/src/modules/dle/dle.guests.ts`), gardés sur l'appareil.
 * À la connexion ou à l'inscription, ils sont échangés contre des Poussières du
 * compte, puis effacés.
 */
interface GuestStardustState {
  receipts: string[]
  add: (receipt: string) => void
  clear: () => void
}

export const useGuestStardustStore = create<GuestStardustState>()(
  persist(
    (set) => ({
      receipts: [],
      add: (receipt) => set((state) => (state.receipts.includes(receipt) ? state : { receipts: [...state.receipts, receipt].slice(-50) })),
      clear: () => set({ receipts: [] }),
    }),
    { name: 'bookshelf:dle-guest-stardust:v1', version: 1 },
  ),
)

/** Poussières en attente sur l'appareil. */
export const pendingGuestStardust = (receipts: readonly string[]) => receipts.reduce((sum, receipt) => sum + receiptAmount(receipt), 0)

/** Compte retrouvé ou créé : les reçus d'invité rejoignent son solde. Silencieux s'il n'y en a pas. */
export async function claimGuestStardust(): Promise<void> {
  const { receipts, clear } = useGuestStardustStore.getState()
  if (receipts.length === 0) return
  try {
    const { credited } = await stardustApi.claim(receipts)
    clear()
    if (credited > 0) useUiStore.getState().notify(getT().dle.guest.claimed(credited), 'like')
  } catch {
    // Hors-ligne : les reçus restent sur l'appareil, réessayés à la prochaine connexion.
  }
}
