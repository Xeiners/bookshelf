import { Library, MoonStar, Search, Sparkles, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ViewId } from '../../store/useUiStore'

/** Le libellé vient du dictionnaire : `t.nav[item.id]`. */
export interface NavItem {
  id: ViewId
  icon: LucideIcon
}

/** Source unique de la navigation — partagée par la barre basse et le rail. */
export const NAV_ITEMS: NavItem[] = [
  { id: 'discover', icon: Sparkles },
  { id: 'oracle', icon: MoonStar },
  { id: 'search', icon: Search },
  { id: 'library', icon: Library },
  { id: 'profile', icon: User },
]

// Tokens dupliqués en JS : GSAP interpole des couleurs littérales, pas des var().
export const NAV_COLOR_ACTIVE = '#06060a'
export const NAV_COLOR_IDLE = '#9d9aab'
