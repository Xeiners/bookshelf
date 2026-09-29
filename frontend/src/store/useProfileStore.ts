import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { profileApi, type ProfileData, type ProfilePatch } from '../services/profileApi'

/**
 * Profil du compte connecté (présentation, cartes exposées, statistiques).
 * Le dernier profil connu est gardé sur l'appareil : la vue Profil s'affiche
 * aussitôt avec lui (et hors-ligne), puis se met à jour en arrière-plan.
 * Préchargé au démarrage de l'app ; effacé à la déconnexion.
 */
interface ProfileState {
  data: ProfileData | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Rechargement depuis le serveur (une seule requête à la fois). */
  load: () => Promise<void>
  /** Premier chargement de la session, en avance (démarrage de l'app) : rien s'il a déjà eu lieu. */
  preload: () => Promise<void>
  /** Rejette avec l'`ApiError` du serveur : la feuille d'édition l'affiche. */
  update: (patch: ProfilePatch) => Promise<ProfileData>
  /** Changement de compte : le profil est à recharger. */
  reset: () => void
}

/** Incrémenté à chaque `reset` : une réponse arrivée après un changement de compte est ignorée. */
let generation = 0

/** Profil relu du stockage : forme minimale vérifiée, sinon oublié (il sera redemandé). */
function sanitize(value: unknown): ProfileData | null {
  if (!value || typeof value !== 'object') return null
  const { profile, stats, titles } = value as Partial<ProfileData>
  if (!profile || typeof profile.id !== 'string' || !stats || typeof stats !== 'object' || !Array.isArray(titles)) return null
  if (!Array.isArray(profile.featured) || !Array.isArray(profile.recentReads)) return null
  return value as ProfileData
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
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

      preload: async () => {
        if (get().status === 'idle') await get().load()
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
    }),
    {
      name: 'bookshelf:profile:v1',
      version: 1,
      // Seul le profil est gardé : il sera de toute façon redemandé au serveur.
      partialize: (state) => ({ data: state.data }),
      merge: (persisted, current) => ({ ...current, data: sanitize((persisted as { data?: unknown } | null)?.data) }),
    },
  ),
)
