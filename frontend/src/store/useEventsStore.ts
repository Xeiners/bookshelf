import { create } from 'zustand'
import { eventsApi, type TeamEvent } from '../services/eventsApi'
import { useAuthStore } from './useAuthStore'
import { useBoosterStore } from './useBoosterStore'
import { useDleStore } from './useDleStore'

/**
 * Événements de l'équipe dont ce compte n'a pas encore récupéré les cadeaux. Relus à la
 * connexion et au retour sur l'app : la fenêtre de cadeaux se présente d'elle-même.
 */
interface EventsState {
  pending: TeamEvent[]
  /** L'événement dont on vient de récupérer les cadeaux : la fenêtre montre « C'est à toi ! ». */
  claimed: TeamEvent | null
  load: () => Promise<void>
  claim: (event: TeamEvent) => Promise<void>
  /** Ferme la fenêtre ; un événement non récupéré reviendra à la prochaine ouverture de l'app. */
  dismiss: () => void
  reset: () => void
}

export const useEventsStore = create<EventsState>((set, get) => ({
  pending: [],
  claimed: null,

  load: async () => {
    if (!useAuthStore.getState().user) return
    try {
      const pending = await eventsApi.pending()
      // Pendant « C'est à toi ! », la liste suit sans fermer la fenêtre.
      set({ pending })
    } catch {
      // Hors-ligne : on réessaiera à la prochaine occasion.
    }
  },

  claim: async (event) => {
    try {
      const { boosters, stardust } = await eventsApi.claim(event.id)
      // La réserve affichée suit aussitôt (boosters offerts, pack Légendaire).
      useBoosterStore.setState({ status: boosters, syncedAt: performance.now(), offline: false })
      if (stardust !== null) useDleStore.getState().setStardust(stardust)
      set((state) => ({ pending: state.pending.filter((item) => item.id !== event.id), claimed: event }))
    } catch (error) {
      // Déjà récupéré (autre appareil) ou terminé : la liste se remet d'accord avec le serveur.
      void get().load()
      throw error
    }
  },

  dismiss: () => set((state) => ({ claimed: null, pending: state.claimed ? state.pending : state.pending.slice(1) })),
  reset: () => set({ pending: [], claimed: null }),
}))
