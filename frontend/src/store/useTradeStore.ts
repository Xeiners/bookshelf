import { create } from 'zustand'
import { diffMarket } from '../lib/trades'
import { tradesApi, type MarketQuery, type TradeOffer, type TradeResult } from '../services/tradesApi'
import { useBoosterStore } from './useBoosterStore'

type Status = 'idle' | 'loading' | 'ready' | 'error'

/** Feuille ouverte par-dessus le marché (aussi depuis une notification). */
export type TradeSheet = 'create' | 'mine' | null

/**
 * Marché d'échange (comptes seulement) : les offres des autres, filtrées, et
 * « Mes échanges ». Rien n'est persisté : le marché bouge sans cesse, il est
 * redemandé à chaque ouverture puis rafraîchi en direct (`refresh`).
 *
 * Le rafraîchissement ne bouscule jamais ce que l'on regarde : les nouvelles
 * offres attendent dans `incoming` (une pastille propose de les afficher), et
 * une offre prise entre-temps reste à sa place, marquée « partie » (`gone`).
 */
interface TradeState {
  query: MarketQuery
  market: TradeOffer[] | null
  marketStatus: Status
  /** Nouvelles offres reçues par le rafraîchissement, pas encore affichées. */
  incoming: TradeOffer[]
  /** Offres affichées qui ont quitté le marché (prises, annulées). */
  gone: string[]
  mine: TradeOffer[] | null
  mineStatus: Status
  sheet: TradeSheet
  /** Offre à mettre en avant (ouverte depuis une notification). */
  focusOfferId: string | null

  setQuery: (change: Partial<MarketQuery>) => void
  loadMarket: () => Promise<void>
  /** Rafraîchissement discret (sondage) : ne remplace pas la liste affichée. */
  refresh: () => Promise<void>
  /** Affiche les nouvelles offres en tête et retire les offres parties. */
  showIncoming: () => void
  loadMine: () => Promise<void>
  /** Publie une offre. Lève l'`ApiError` du serveur (doublon manquant, rareté…). */
  create: (offeredCardId: string, requestedCardId: string) => Promise<TradeOffer>
  /** Accepte une offre ; l'album se recharge. Lève l'`ApiError` (offre déjà prise…). */
  accept: (offer: TradeOffer) => Promise<TradeResult>
  cancel: (offerId: string) => Promise<void>
  openSheet: (sheet: TradeSheet) => void
  focusOffer: (offerId: string | null) => void
  /** Changement de compte : tout est à redemander. */
  reset: () => void
}

/** Incrémenté à chaque `reset` : une réponse arrivée après un changement de compte est ignorée. */
let generation = 0
/** Requête du marché en cours : une nouvelle (autre filtre) l'annule. */
let marketRequest: AbortController | null = null

const DEFAULT_QUERY: MarketQuery = { rarity: 'all', series: 'all', fillable: false }

export const useTradeStore = create<TradeState>((set, get) => ({
  query: DEFAULT_QUERY,
  market: null,
  marketStatus: 'idle',
  incoming: [],
  gone: [],
  mine: null,
  mineStatus: 'idle',
  sheet: null,
  focusOfferId: null,

  setQuery: (change) => {
    set((state) => ({ query: { ...state.query, ...change } }))
    void get().loadMarket()
  },

  loadMarket: async () => {
    marketRequest?.abort()
    const controller = new AbortController()
    marketRequest = controller
    const current = generation
    set({ marketStatus: 'loading' })
    try {
      const { offers } = await tradesApi.market(get().query, controller.signal)
      if (current === generation && !controller.signal.aborted) set({ market: offers, marketStatus: 'ready', incoming: [], gone: [] })
    } catch {
      if (current === generation && !controller.signal.aborted) {
        // Le dernier marché connu reste affiché ; l'erreur ne remplace qu'un marché absent.
        set((state) => ({ marketStatus: state.market ? 'ready' : 'error' }))
      }
    }
  },

  refresh: async () => {
    const shown = get().market
    // Pas encore de marché, ou un chargement en cours : rien à rafraîchir.
    if (!shown || get().marketStatus === 'loading') return
    const current = generation
    const query = get().query
    try {
      const { offers } = await tradesApi.market(query)
      // Filtre changé ou compte changé pendant la requête : réponse périmée.
      if (current !== generation || get().query !== query || get().marketStatus === 'loading') return
      const { market, incoming, gone } = diffMarket(get().market ?? [], offers)
      set({ market, incoming, gone })
    } catch {
      // Hors-ligne : le marché affiché reste, le prochain rafraîchissement rattrapera.
    }
  },

  showIncoming: () =>
    set((state) => ({
      market: [...state.incoming, ...(state.market ?? []).filter((offer) => !state.gone.includes(offer.id))],
      incoming: [],
      gone: [],
    })),

  loadMine: async () => {
    const current = generation
    set({ mineStatus: 'loading' })
    try {
      const { offers } = await tradesApi.mine()
      if (current === generation) set({ mine: offers, mineStatus: 'ready' })
    } catch {
      if (current === generation) set((state) => ({ mineStatus: state.mine ? 'ready' : 'error' }))
    }
  },

  create: async (offeredCardId, requestedCardId) => {
    const { offer } = await tradesApi.create(offeredCardId, requestedCardId)
    set((state) => ({ mine: [offer, ...(state.mine ?? [])] }))
    return offer
  },

  accept: async (offer) => {
    const result = await tradesApi.accept(offer.id)
    // L'offre quitte le marché ; l'album change ; mes offres possibles aussi.
    set((state) => ({
      market: state.market?.filter((entry) => entry.id !== offer.id) ?? null,
      focusOfferId: state.focusOfferId === offer.id ? null : state.focusOfferId,
    }))
    useBoosterStore.getState().collectionChanged()
    void get().loadMine()
    void get().loadMarket()
    return result
  },

  cancel: async (offerId) => {
    const { offer } = await tradesApi.cancel(offerId)
    set((state) => ({ mine: state.mine?.map((entry) => (entry.id === offerId ? offer : entry)) ?? null }))
  },

  openSheet: (sheet) => set({ sheet }),

  focusOffer: (focusOfferId) => set({ focusOfferId }),

  reset: () => {
    generation += 1
    marketRequest?.abort()
    set({
      query: DEFAULT_QUERY,
      market: null,
      marketStatus: 'idle',
      incoming: [],
      gone: [],
      mine: null,
      mineStatus: 'idle',
      sheet: null,
      focusOfferId: null,
    })
  },
}))
