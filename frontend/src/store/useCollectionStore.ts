import { create } from 'zustand'
import { cardsApi, type Collection } from '../services/cardsApi'

/**
 * Album affiché (toutes les cartes du set, possédées ou non) : celui du
 * compte, ou celui d'un invité reconstitué depuis ses reçus d'essai. Partagé
 * par le hub (progression) et la page Collection ; rechargé après chaque
 * booster ouvert (`useBoosterStore.collectionVersion`).
 */
interface CollectionState {
  data: Collection | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Version de collection chargée (cf. `collectionVersion`). */
  loadedVersion: number
  /** `guestReceipts` : album d'invité ; `null` : album du compte. */
  load: (version: number, guestReceipts: string[] | null) => Promise<void>
  /** Favori basculé tout de suite, annulé si le serveur refuse (comptes seulement). */
  toggleFavorite: (cardId: string) => Promise<void>
  /** Changement de compte (connexion, inscription, déconnexion) : l'album est à recharger. */
  reset: () => void
}

/** Incrémenté à chaque `reset` : une réponse arrivée après un changement de compte est ignorée. */
let generation = 0

export const useCollectionStore = create<CollectionState>((set, get) => ({
  data: null,
  status: 'idle',
  loadedVersion: -1,

  load: async (version, guestReceipts) => {
    if (get().status === 'loading') return
    const current = generation
    set({ status: 'loading' })
    try {
      const data = guestReceipts ? await cardsApi.guestCollection(guestReceipts) : await cardsApi.collection()
      if (current === generation) set({ data, status: 'ready', loadedVersion: version })
    } catch {
      // Le dernier album connu reste affiché ; l'erreur ne remplace qu'un album absent.
      if (current === generation) set((state) => ({ status: state.data ? 'ready' : 'error' }))
    }
  },

  toggleFavorite: async (cardId) => {
    const flip = (data: Collection | null) =>
      data && { ...data, cards: data.cards.map((card) => (card.id === cardId ? { ...card, isFavorite: !card.isFavorite } : card)) }
    const card = get().data?.cards.find((entry) => entry.id === cardId)
    if (!card?.owned) return
    set((state) => ({ data: flip(state.data) }))
    try {
      await cardsApi.favorite(cardId, !card.isFavorite)
    } catch {
      set((state) => ({ data: flip(state.data) }))
    }
  },

  reset: () => {
    generation += 1
    set({ data: null, status: 'idle', loadedVersion: -1 })
  },
}))
