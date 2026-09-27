import { createContext, useContext } from 'react'

/**
 * Recours quand une page ne s'affiche pas : ouvrir ce chapitre chez une autre
 * source, en un tap, depuis la page en erreur elle-même. Fourni par
 * `ImageReader` (chapitre publié par plusieurs sources), lu par `PageImage`
 * sans traverser les vues défilement / pages.
 */
export interface PageRecovery {
  /** Libellé du bouton (« Essayer sur Asura Scans »). */
  label: string
  onSwitch: () => void
}

export const PageRecoveryContext = createContext<PageRecovery | null>(null)

export const usePageRecovery = () => useContext(PageRecoveryContext)
