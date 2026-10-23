import { create } from 'zustand'
import { cardsApi, type SeriesRetirement } from '../services/cardsApi'
import { useBoosterStore } from './useBoosterStore'
import { useDleStore } from './useDleStore'

interface RetirementState {
  /** Bilan à montrer (animation pas encore vue) ; `null` : rien à montrer. */
  retirement: SeriesRetirement | null
  /** Compte déjà interrogé (une fois par compte et par visite). */
  checkedFor: string | null
  load: (accountId: string) => Promise<void>
  /** Fin de l'animation : le serveur ne la remontrera plus ; solde et album se rafraîchissent. */
  acknowledge: () => Promise<void>
  reset: () => void
}

/**
 * Retrait des Séries 1 et 2 : la conversion est faite par le serveur, une seule fois. Ici, juste
 * son bilan, montré tant qu'il n'a pas été vu jusqu'au bout — recharger la page le rejoue, sans
 * jamais recréditer quoi que ce soit.
 */
export const useRetirementStore = create<RetirementState>((set, get) => ({
  retirement: null,
  checkedFor: null,

  load: async (accountId) => {
    if (get().checkedFor === accountId) return
    set({ checkedFor: accountId })
    try {
      const { retirement } = await cardsApi.retirement()
      // Compte changé entre-temps : ce bilan n'est plus le sien.
      if (get().checkedFor === accountId) set({ retirement })
    } catch {
      // Hors ligne : on réessaiera à la prochaine visite.
      set({ checkedFor: null })
    }
  },

  acknowledge: async () => {
    set({ retirement: null })
    // Les Poussières sont déjà sur le compte : on relit le solde et l'album.
    void useDleStore.getState().loadOverview()
    useBoosterStore.getState().collectionChanged()
    // Si l'accusé échoue (hors ligne), le bilan reviendra à la prochaine visite : rien n'est perdu.
    await cardsApi.retirementSeen().catch(() => undefined)
  },

  reset: () => set({ retirement: null, checkedFor: null }),
}))
