import { Library, Search, Sparkles, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ViewId } from '../../store/useUiStore'

export interface NavItem {
  id: ViewId
  label: string
  icon: LucideIcon
}

/** Source unique de la navigation — partagée par la barre basse et le rail. */
export const NAV_ITEMS: NavItem[] = [
  { id: 'discover', label: 'Découvrir', icon: Sparkles },
  { id: 'search', label: 'Recherche', icon: Search },
  { id: 'library', label: 'Ma biblio', icon: Library },
  { id: 'profile', label: 'Profil', icon: User },
]

// Tokens dupliqués en JS : GSAP interpole des couleurs littérales, pas des var().
export const NAV_COLOR_ACTIVE = '#06060a'
export const NAV_COLOR_IDLE = '#9d9aab'
