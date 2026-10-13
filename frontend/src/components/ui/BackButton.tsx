import { ChevronLeft } from 'lucide-react'
import { vibrate } from '../../lib/haptics'

interface BackButtonProps {
  /** Où mène le retour : « Activités », « BookshelfDLE », « Quitter »… */
  label: string
  onBack: () => void
  /** Retour qui demande confirmation (quitter en pleine manche). */
  danger?: boolean
}

/**
 * Retour en haut à gauche des écrans des Activités : une pastille bien visible (fond,
 * contour, texte clair), pas un simple lien gris qu'on ne remarque pas.
 */
export function BackButton({ label, onBack, danger = false }: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        vibrate(6)
        onBack()
      }}
      className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-full border pr-3.5 pl-2 text-sm font-semibold shadow-[0_2px_12px_rgba(0,0,0,0.35)] transition-colors active:scale-[0.97] ${
        danger ? 'border-nope/40 bg-nope/15 text-nope hover:bg-nope/25' : 'border-white/15 bg-white/[0.08] text-cream hover:bg-white/[0.14]'
      }`}
    >
      <ChevronLeft size={18} strokeWidth={2.5} aria-hidden />
      {label}
    </button>
  )
}
