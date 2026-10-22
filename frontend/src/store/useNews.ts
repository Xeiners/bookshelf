import { create } from 'zustand'
import { markNewsSeen, readSeenNews, unseenCount } from '../lib/news'

interface NewsState {
  /** Fenêtre de la dernière actu, à l'ouverture du site. */
  popup: boolean
  /** Page « Actus » (toutes les actus). */
  page: boolean
  /** Actus pas encore vues sur cet appareil (pastille). */
  unseen: number
  /** Déjà refermée pendant cette visite : ne revient pas, même sans stockage. */
  dismissed: boolean
  /** Ouverture automatique : seulement s'il y a du neuf. */
  showIfNew: () => void
  openPage: () => void
  closePage: () => void
  closePopup: () => void
}

export const useNews = create<NewsState>((set, get) => ({
  popup: false,
  page: false,
  unseen: unseenCount(readSeenNews()),
  dismissed: false,
  showIfNew: () => {
    if (get().dismissed || get().unseen === 0) return
    set({ popup: true })
  },
  // Ouvrir la page, c'est avoir tout vu.
  openPage: () => {
    markNewsSeen()
    set({ page: true, popup: false, unseen: 0, dismissed: true })
  },
  closePage: () => set({ page: false }),
  closePopup: () => {
    markNewsSeen()
    set({ popup: false, unseen: 0, dismissed: true })
  },
}))
