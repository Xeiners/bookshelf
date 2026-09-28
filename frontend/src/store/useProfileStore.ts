import { create } from 'zustand'
import { profileApi, type ProfileData, type ProfilePatch } from '../services/profileApi'

/**
 * Profil du compte connecté (présentation, cartes exposées, statistiques).
 * Rechargé à chaque ouverture de la vue Profil ; le dernier profil connu reste
 * affiché pendant ce temps (et hors-ligne).
 */
interface ProfileState {
  data: ProfileData | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  load: () => Promise<void>
  /** Rejette avec l'`ApiError` du serveur : la feuille d'édition l'affiche. */
  update: (patch: ProfilePatch) => Promise<ProfileData>
  /** Changement de compte : le profil est à recharger. */
  reset: () => void
}

/** Incrémenté à chaque `reset` : une réponse arrivée après un changement de compte est ignorée. */
let generation = 0

export const useProfileStore = create<ProfileState>((set, get) => ({
  data: null,
  status: 'idle',

  load: async () => {
    if (get().status === 'loading') return
    const current = generation
    set({ status: 'loading' })
    try {
      const data = await profileApi.me()
      if (current === generation) set({ data, status: 'ready' })
    } catch {
      if (current === generation) set((state) => ({ status: state.data ? 'ready' : 'error' }))
    }
  },

  update: async (patch) => {
    const current = generation
    const data = await profileApi.update(patch)
    if (current === generation) set({ data, status: 'ready' })
    return data
  },

  reset: () => {
    generation += 1
    set({ data: null, status: 'idle' })
  },
}))
