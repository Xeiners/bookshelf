import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getT } from '../i18n'
import { outbox } from '../lib/syncOutbox'
import { ApiError } from '../services/api'
import { authApi, libraryApi, type AuthUser, type Credentials } from '../services/accountApi'
import { librarySnapshot, useLibraryStore } from './useLibraryStore'
import { useOracleStore } from './useOracleStore'
import { useSettingsStore } from './useSettingsStore'
import { useUiStore } from './useUiStore'

interface AuthState {
  /** Persisté : l'app redémarre connectée même hors-ligne. */
  user: AuthUser | null
  /** Session connue mais API injoignable : les actions attendent dans l'outbox. */
  offline: boolean

  /** Au démarrage : valide la session, vide l'outbox, récupère la bibliothèque du compte. */
  bootstrap: () => Promise<void>
  register: (input: Credentials & { displayName?: string }) => Promise<void>
  login: (input: Credentials) => Promise<void>
  logout: () => Promise<void>
}

/**
 * Fin de session côté client.
 * - `expired` : le cookie n'est plus valide. Les données locales sont gardées
 *   comme données invité : elles seront refusionnées à la prochaine connexion.
 * - `logout` : départ volontaire, l'appareil repart d'une bibliothèque vierge
 *   (elle reste intacte sur le compte).
 */
/**
 * La langue du compte suit l'utilisateur d'un appareil à l'autre : on l'adopte
 * à la connexion et au démarrage. Exception : un changement fait localement
 * et pas encore envoyé (hors-ligne) est plus récent, il l'emporte.
 */
function adoptAccountLanguage(user: AuthUser) {
  if (outbox.hasPendingPrefs()) return
  useSettingsStore.getState().applyAccountLanguage(user.preferredLanguage)
}

function endSession(reason: 'expired' | 'logout') {
  outbox.disable()
  outbox.clear()
  if (reason === 'logout') useLibraryStore.getState().replaceAll({ entries: [], skipped: [] })
  useAuthStore.setState({ user: null, offline: false })
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      offline: false,

      bootstrap: async () => {
        outbox.setUnauthorizedHandler(() => {
          if (!get().user) return
          endSession('expired')
          useUiStore.getState().notify(getT().account.sessionExpired, 'nope')
        })

        // Invité : rien à valider, on ne sollicite pas l'API.
        if (!get().user) return

        // Les actions faites pendant la vérification sont déjà mises en file.
        outbox.enable()

        try {
          const { user } = await authApi.me()
          adoptAccountLanguage(user)
          set({ user, offline: false })
          useOracleStore.getState().reconcile(user.oracle)

          const drained = await outbox.flush()
          if (!drained) return

          const library = await libraryApi.fetch()
          // Un swipe a pu partir pendant le chargement : l'état local est alors
          // plus récent que la réponse, on le garde (l'outbox l'enverra).
          if (outbox.size() === 0) useLibraryStore.getState().replaceAll(library)
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) endSession('expired')
          else set({ offline: true })
        }
      },

      register: async ({ email, password, displayName }) => {
        const { user, library } = await authApi.register({
          email,
          password,
          displayName: displayName?.trim() || undefined,
          // La langue choisie en invité devient celle du compte.
          preferredLanguage: useSettingsStore.getState().language,
          initialData: librarySnapshot(),
        })
        // L'API a fusionné l'état invité : sa réponse fait désormais foi.
        outbox.clear()
        useLibraryStore.getState().replaceAll(library)
        outbox.enable()
        set({ user, offline: false })
        // La série faite en invité rejoint le compte.
        useOracleStore.getState().reconcile(user.oracle)
      },

      login: async ({ email, password }) => {
        const { user, library } = await authApi.login({
          email,
          password,
          initialData: librarySnapshot(),
        })
        outbox.clear()
        adoptAccountLanguage(user)
        useLibraryStore.getState().replaceAll(library)
        outbox.enable()
        set({ user, offline: false })
        useOracleStore.getState().reconcile(user.oracle)
      },

      logout: async () => {
        // Dernière chance d'envoyer les actions en attente.
        await outbox.flush().catch(() => false)
        try {
          await authApi.logout()
        } catch {
          // Hors-ligne : le cookie expirera de lui-même, on déconnecte l'appareil quand même.
        }
        endSession('logout')
      },
    }),
    {
      name: 'bookshelf:auth:v1',
      version: 1,
      partialize: (state) => ({ user: state.user }),
    },
  ),
)

/** Nombre d'actions pas encore confirmées par l'API. */
export function usePendingSync(): number {
  return useSyncExternalStore(outbox.subscribe, outbox.size, outbox.size)
}
