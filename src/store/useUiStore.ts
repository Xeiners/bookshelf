import { create } from 'zustand'
import type { Book } from '../types/book'

export type ViewId = 'discover' | 'search' | 'library' | 'profile'
export type ToastTone = 'like' | 'nope' | 'neutral'

export interface Toast {
  /** Incrémental : sert de `key` React pour rejouer l'animation d'entrée. */
  id: number
  message: string
  tone: ToastTone
}

interface UiState {
  view: ViewId
  /** Livre affiché dans la feuille de détail (bottom sheet), `null` = fermée. */
  detail: Book | null
  toast: Toast | null

  setView: (view: ViewId) => void
  openDetail: (book: Book) => void
  closeDetail: () => void
  notify: (message: string, tone?: ToastTone) => void
  dismissToast: () => void
}

let toastId = 0

export const useUiStore = create<UiState>((set) => ({
  view: 'discover',
  detail: null,
  toast: null,

  setView: (view) => set({ view }),
  openDetail: (detail) => set({ detail }),
  closeDetail: () => set({ detail: null }),

  notify: (message, tone = 'neutral') => {
    toastId += 1
    set({ toast: { id: toastId, message, tone } })
  },
  dismissToast: () => set({ toast: null }),
}))
