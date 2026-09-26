import { useEffect } from 'react'
import { NAV_ITEMS } from '../components/layout/navItems'
import { useSettingsStore } from '../store/useSettingsStore'
import { useUiStore } from '../store/useUiStore'

/** Cible d'édition : les chiffres y tapent du texte, ils ne naviguent pas. */
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || Boolean(target.closest('input, textarea, select')))

/**
 * Raccourcis clavier globaux (utiles surtout sur ordinateur) :
 *  - 1 à 5        → Découvrir, Oracle, Recherche, Ma biblio, Profil
 *  - Ctrl/⌘ K     → Recherche, curseur dans le champ
 *  - Ctrl/⌘ B     → replier / déplier la barre latérale
 *
 * Inactifs quand une feuille modale est ouverte (elle a ses propres touches) ;
 * les chiffres sont ignorés pendant la saisie. Les flèches restent au deck.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ui = useUiStore.getState()
      if (ui.detail !== null || ui.authOpen || ui.reader !== null || ui.filesOpen || event.repeat) return

      const command = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (command && !event.shiftKey && !event.altKey && key === 'k') {
        event.preventDefault()
        ui.focusSearch()
        return
      }
      if (command && !event.shiftKey && !event.altKey && key === 'b') {
        event.preventDefault()
        useSettingsStore.getState().toggleSidebar()
        return
      }

      if (command || event.altKey || isEditable(event.target)) return
      const index = Number(event.key) - 1
      if (Number.isInteger(index) && index >= 0 && index < NAV_ITEMS.length) ui.setView(NAV_ITEMS[index].id)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
