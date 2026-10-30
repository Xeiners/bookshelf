import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isSiteTheme, themeApi, type SiteTheme } from '../services/themeApi'

/** Le thème se relit au plus toutes les deux minutes (retour au premier plan, réseau revenu). */
const REFRESH_MS = 2 * 60 * 1000

interface ThemeState {
  /** Thème saisonnier en cours ; gardé sur l'appareil pour s'afficher dès le démarrage, sans clignement. */
  theme: SiteTheme
  loadedAt: number
  /** Relit le thème du serveur (`force` : tout de suite). */
  load: (force?: boolean) => Promise<void>
  /** Administration : le change pour tout le monde. */
  change: (theme: SiteTheme) => Promise<void>
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'none',
      loadedAt: 0,
      load: async (force = false) => {
        if (!force && Date.now() - get().loadedAt < REFRESH_MS) return
        set({ loadedAt: Date.now() })
        try {
          const theme = await themeApi.current()
          if (isSiteTheme(theme)) set({ theme })
        } catch {
          // Hors-ligne : le dernier thème connu reste affiché.
        }
      },
      change: async (theme) => {
        set({ theme: await themeApi.set(theme), loadedAt: Date.now() })
      },
    }),
    {
      name: 'bookshelf:theme:v1',
      partialize: (state) => ({ theme: state.theme }),
      merge: (persisted, current) => {
        const theme = (persisted as { theme?: unknown } | undefined)?.theme
        return { ...current, theme: isSiteTheme(theme) ? theme : 'none' }
      },
    },
  ),
)
