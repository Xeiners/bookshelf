import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { detectLanguage, isLanguage, type Language } from '../i18n/languages'
import { outbox } from '../lib/syncOutbox'
import { useUiStore } from './useUiStore'

/**
 * Un toast est rédigé au moment où il est émis : après un changement de
 * langue, il resterait affiché dans l'ancienne. On le retire plutôt.
 */
const dismissStaleToast = () => useUiStore.getState().dismissToast()

interface SettingsState {
  /** Langue de l'interface ET du catalogue (titres, résumés, genres). */
  language: Language
  /**
   * Choix de l'utilisateur. Poussé vers le compte s'il est connecté
   * (`outbox.push` est sans effet en invité : le localStorage suffit).
   */
  setLanguage: (language: Language) => void
  /** Application d'une préférence venue du compte : aucune synchronisation en retour. */
  applyAccountLanguage: (language: Language) => void
  /** Barre latérale d'ordinateur repliée en rail d'icônes. Propre à l'appareil. */
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  /** Bandeau « connecte-toi » retiré par l'invité. Propre à l'appareil. */
  guestBannerDismissed: boolean
  dismissGuestBanner: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      language: detectLanguage(),

      setLanguage: (language) => {
        if (get().language === language) return
        set({ language })
        dismissStaleToast()
        outbox.push({ type: 'prefs', language, at: Date.now() })
      },

      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      guestBannerDismissed: false,
      dismissGuestBanner: () => set({ guestBannerDismissed: true }),

      applyAccountLanguage: (language) => {
        if (get().language === language) return
        set({ language })
        dismissStaleToast()
      },
    }),
    {
      name: 'bookshelf:settings:v1',
      version: 1,
      partialize: (state) => ({
        language: state.language,
        sidebarCollapsed: state.sidebarCollapsed,
        guestBannerDismissed: state.guestBannerDismissed,
      }),
      // Valeur corrompue ou d'une langue retirée : on revient à la détection.
      merge: (persisted, current) => {
        const saved = persisted as
          | { language?: unknown; sidebarCollapsed?: unknown; guestBannerDismissed?: unknown }
          | undefined
        return {
          ...current,
          language: isLanguage(saved?.language) ? saved.language : current.language,
          sidebarCollapsed: saved?.sidebarCollapsed === true,
          guestBannerDismissed: saved?.guestBannerDismissed === true,
        }
      },
    },
  ),
)
