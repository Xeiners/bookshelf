import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { cleanOutfit, type Outfit } from '../lib/runner/wardrobe'
import { runnerApi, type WardrobeView } from '../services/runnerApi'
import { useDleStore } from './useDleStore'

/*
 * Garde-robe de l'aventurier du Manga Runner : ce que le serveur dit (pièces, tenue, boîte
 * gratuite, garantie), gardé sur l'appareil — la tenue reste portée hors ligne. Équiper est
 * immédiat à l'écran ; le serveur confirme (ou la tenue revient en arrière).
 */

interface WardrobeState {
  view: WardrobeView | null
  outfit: Outfit
  loading: boolean
  load: () => Promise<void>
  /** Après une boîte : la garde-robe à jour, et le solde de Poussières. */
  receive: (view: WardrobeView) => void
  equip: (outfit: Outfit) => Promise<void>
}

export const useRunnerWardrobe = create<WardrobeState>()(
  persist(
    (set, get) => ({
      view: null,
      outfit: {},
      loading: false,
      load: async () => {
        if (get().loading) return
        set({ loading: true })
        try {
          get().receive(await runnerApi.wardrobe())
        } catch {
          // Hors ligne ou sans compte : on garde ce qui est connu.
        } finally {
          set({ loading: false })
        }
      },
      receive: (view) => {
        set({ view, outfit: cleanOutfit(view.outfit) })
        useDleStore.getState().setStardust(view.balance)
      },
      equip: async (outfit) => {
        const before = get().outfit
        set({ outfit })
        try {
          get().receive(await runnerApi.setOutfit(outfit))
        } catch (error) {
          set({ outfit: before })
          throw error
        }
      },
    }),
    {
      name: 'bookshelf:runner:wardrobe',
      version: 1,
      partialize: ({ view, outfit }) => ({ view, outfit }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<WardrobeState>
        return { ...current, view: saved.view ?? null, outfit: cleanOutfit(saved.outfit) }
      },
    },
  ),
)
