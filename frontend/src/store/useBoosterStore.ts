import { create } from 'zustand'
import { addToTally, emptyTally, type BoosterStatus, type DropTally } from '../lib/boosters'
import { isNetworkError } from '../services/api'
import { cardsApi, type CardSeries, type PulledCard, type SeriesChoice, type SeriesShowcase } from '../services/cardsApi'
import { useGuestCardsStore } from './useGuestCardsStore'

/**
 * Stock de boosters du compte, tel que le serveur le décrit. Rien n'est
 * persisté : à chaque ouverture de l'app le serveur redonne l'état exact, et
 * le minuteur affiché repart de sa réponse (cf. `lib/boosters.ts`).
 */
interface BoosterState {
  status: BoosterStatus | null
  /** `performance.now()` au moment de la réponse : origine du décompte local. */
  syncedAt: number
  loading: boolean
  /** Dernière synchronisation impossible (hors-ligne, serveur arrêté). */
  offline: boolean
  /** Incrémenté à chaque booster ouvert (ou échange conclu) : l'album sait qu'il doit se recharger. */
  collectionVersion: number
  /** Recette : raretés tirées depuis l'ouverture de l'app (taux observés). */
  tally: DropTally

  refresh: () => Promise<void>
  /**
   * Ouvre un booster du compte, ou un booster d'essai (`guest` : son reçu est
   * gardé sur l'appareil). Lève l'erreur de l'API (409 : plus de stock,
   * 503 : collection en préparation).
   */
  open: (as: 'account' | 'guest', series: SeriesChoice) => Promise<{ cards: PulledCard[]; series: CardSeries }>
  /** Couvertures de chaque série (illustration des paquets) ; `null` tant qu'elles ne sont pas chargées. */
  showcase: SeriesShowcase[] | null
  loadShowcase: () => Promise<void>
  /** L'album a changé ailleurs (échange au marché) : il se recharge, sans disparaître entre-temps. */
  collectionChanged: () => void
  /** Compte déconnecté : plus de stock à afficher. */
  reset: () => void
}

let inflight: Promise<void> | null = null
let showcaseLoading = false

export const useBoosterStore = create<BoosterState>((set) => ({
  status: null,
  syncedAt: 0,
  loading: false,
  offline: false,
  collectionVersion: 0,
  tally: emptyTally(),
  showcase: null,

  loadShowcase: async () => {
    if (showcaseLoading) return
    showcaseLoading = true
    try {
      set({ showcase: (await cardsApi.series()).series })
    } catch {
      // Sans couvertures, les paquets gardent leur décor de base.
    } finally {
      showcaseLoading = false
    }
  },

  refresh: () => {
    inflight ??= (async () => {
      set({ loading: true })
      try {
        const status = await cardsApi.status()
        set({ status, syncedAt: performance.now(), offline: false })
      } catch (error) {
        // Hors-ligne : on garde le dernier état connu, le minuteur continue de tourner.
        if (isNetworkError(error)) set({ offline: true })
        else set({ status: null })
      } finally {
        set({ loading: false })
        inflight = null
      }
    })()
    return inflight
  },

  open: async (as, choice) => {
    if (as === 'guest') {
      const guest = useGuestCardsStore.getState()
      const { cards, receipt, series } = await cardsApi.guestOpen(guest.receipts, choice)
      guest.add(receipt)
      set((state) => ({
        collectionVersion: state.collectionVersion + 1,
        tally: addToTally(state.tally, cards.map((pulled) => pulled.card.rarity)),
      }))
      return { cards, series }
    }
    const { cards, status, series } = await cardsApi.open(choice)
    set((state) => ({
      status,
      syncedAt: performance.now(),
      offline: false,
      collectionVersion: state.collectionVersion + 1,
      tally: addToTally(state.tally, cards.map((pulled) => pulled.card.rarity)),
    }))
    return { cards, series }
  },

  collectionChanged: () => set((state) => ({ collectionVersion: state.collectionVersion + 1 })),

  reset: () => set({ status: null, syncedAt: 0, offline: false, tally: emptyTally() }),
}))
