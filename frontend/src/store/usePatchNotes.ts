import { create } from 'zustand'
import { markPatchNotesSeen, patchNotesSeen } from '../lib/patchNotes'

interface PatchNotesState {
  /** La fenêtre est affichée (à l'ouverture si non vue, ou à la demande depuis les paramètres). */
  open: boolean
  /** Déjà fermée pendant cette session : ne revient pas, même si le stockage est indisponible. */
  dismissed: boolean
  /** Ouverture automatique : seulement si ces nouveautés n'ont jamais été vues. */
  showIfNew: () => void
  /** Ouverture voulue (Paramètres). */
  show: () => void
  close: () => void
}

export const usePatchNotes = create<PatchNotesState>((set, get) => ({
  open: false,
  dismissed: false,
  showIfNew: () => {
    if (get().dismissed || patchNotesSeen()) return
    set({ open: true })
  },
  show: () => set({ open: true }),
  close: () => {
    markPatchNotesSeen()
    set({ open: false, dismissed: true })
  },
}))
