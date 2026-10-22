import type { NewsAction } from '../../lib/news'
import { useAuthStore } from '../../store/useAuthStore'
import { useDailyStore } from '../../store/useDailyStore'
import { useNews } from '../../store/useNews'
import { useUiStore } from '../../store/useUiStore'

/** Ce qu'il faut un compte pour voir : sans compte, la connexion d'abord. */
const NEEDS_ACCOUNT: ReadonlySet<NewsAction> = new Set(['daily', 'market', 'canvas'])

/** Le bouton d'une actu : ferme les actus et ouvre ce dont elle parle. */
export function runNewsAction(action: NewsAction): void {
  const ui = useUiStore.getState()
  const news = useNews.getState()
  news.closePopup()
  news.closePage()
  if (NEEDS_ACCOUNT.has(action) && !useAuthStore.getState().user) {
    ui.openAuth()
    return
  }
  switch (action) {
    case 'edits':
      ui.openEdits()
      return
    case 'activities':
      ui.openActivity('hub', 'cards')
      return
    case 'daily':
      useDailyStore.getState().show()
      return
    case 'library':
      ui.setView('library')
      return
    default:
      ui.openActivity(action)
  }
}
