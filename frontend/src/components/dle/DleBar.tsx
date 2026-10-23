import type { ReactNode } from 'react'
import { BackButton } from '../ui/BackButton'
import { SfxVolume } from '../ui/SfxVolume'

interface DleBarProps {
  /** Où mène le retour : « Activités », « BookshelfDLE », « Quitter »… */
  label: string
  onBack: () => void
  /** Retour qui demande confirmation (quitter en pleine manche). */
  danger?: boolean
  /** À droite : solde, essais, code du salon… */
  children?: ReactNode
  /** Le haut-parleur (volume des bruitages, commun à tous les jeux) ; affiché par défaut. */
  sound?: boolean
}

/**
 * Barre du haut de chaque écran du BookshelfDLE. Le retour est TOUJOURS au même
 * endroit — en haut à gauche, comme le « ‹ Activités » des autres modules — et
 * hors des colonnes centrées, dont la largeur change d'un écran à l'autre. Elle
 * ne défile pas avec le contenu. Le haut-parleur y règle le volume des bruitages.
 */
export function DleBar({ label, onBack, danger = false, children, sound = true }: DleBarProps) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-4 pb-2">
      <BackButton label={label} onBack={onBack} danger={danger} />
      {(children || sound) && (
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {sound && <SfxVolume />}
          {children}
        </div>
      )}
    </div>
  )
}
