import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useUiStore } from '../../store/useUiStore'
import { useBackToClose, useThemeColor, useWakeLock } from './useReaderEnvironment'

export type ReaderPanel = 'contents' | 'settings' | null

/**
 * État d'interface commun aux trois moteurs (images, texte, document) :
 * commandes affichées ou non, panneau latéral ouvert, fermeture du lecteur
 * (bouton, Échap, geste « retour » du téléphone), écran maintenu allumé.
 */
export function useReaderUi() {
  const closeReader = useUiStore((state) => state.closeReader)
  const [controls, setControls] = useState(true)
  const [panel, setPanel] = useState<ReaderPanel>(null)

  const close = useBackToClose(closeReader)
  useWakeLock()
  useThemeColor('#000000')

  // Échap : d'abord le panneau ouvert, puis le lecteur.
  const panelRef = useRef(panel)
  const closeRef = useRef(close)
  useEffect(() => {
    panelRef.current = panel
    closeRef.current = close
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (panelRef.current) setPanel(null)
      else closeRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return {
    controls,
    setControls,
    toggleControls: () => setControls((visible) => !visible),
    /** Première interaction de lecture (défilement, page tournée) : les commandes s'effacent. */
    hideControls: () => setControls(false),
    panel,
    setPanel,
    close,
  }
}

export type ReaderUi = ReturnType<typeof useReaderUi>

/**
 * Une seule instance par lecteur ouvert (créée par `UniversalReader`) : une
 * seconde ajouterait une autre entrée d'historique et un autre écouteur d'Échap.
 */
export const ReaderUiContext = createContext<ReaderUi | null>(null)

export function useReaderChrome(): ReaderUi {
  const ui = useContext(ReaderUiContext)
  if (!ui) throw new Error('useReaderChrome hors de <UniversalReader>')
  return ui
}
