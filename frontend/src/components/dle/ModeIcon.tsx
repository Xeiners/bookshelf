import { Blocks, LayoutGrid, ScanSearch, UserRound } from 'lucide-react'
import type { DleCategory, DleMode } from '../../services/dleApi'

/** Icône d'un format : grille (classique), loupe (couverture) ou visage (portrait), blocs (pixels). */
export function ModeIcon({ category, mode, size }: { category: DleCategory; mode: DleMode; size: number }) {
  if (mode === 'classic') return <LayoutGrid size={size} aria-hidden />
  if (mode === 'pixel') return <Blocks size={size} aria-hidden />
  return category === 'manga' ? <ScanSearch size={size} aria-hidden /> : <UserRound size={size} aria-hidden />
}
