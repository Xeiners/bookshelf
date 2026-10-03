import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { vibrate } from '../../lib/haptics'

interface DleBarProps {
  /** Où mène le retour : « Activités », « BookshelfDLE », « Quitter »… */
  label: string
  onBack: () => void
  /** Retour qui demande confirmation (quitter en pleine manche). */
  danger?: boolean
  /** À droite : solde, essais, code du salon… */
  children?: ReactNode
}

/**
 * Barre du haut de chaque écran du BookshelfDLE. Le retour est TOUJOURS au même
 * endroit — en haut à gauche, comme le « ‹ Activités » des autres modules — et
 * hors des colonnes centrées, dont la largeur change d'un écran à l'autre. Elle
 * ne défile pas avec le contenu.
 */
export function DleBar({ label, onBack, danger = false, children }: DleBarProps) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 px-5 pb-2">
      <button
        type="button"
        onClick={() => {
          vibrate(6)
          onBack()
        }}
        className={`inline-flex shrink-0 items-center gap-1 rounded-full py-1.5 pr-3 text-sm transition-colors ${danger ? 'text-nope' : 'text-mist hover:text-cream'}`}
      >
        <ChevronLeft size={18} aria-hidden />
        {label}
      </button>
      {children && <div className="ml-auto flex min-w-0 items-center gap-2">{children}</div>}
    </div>
  )
}
