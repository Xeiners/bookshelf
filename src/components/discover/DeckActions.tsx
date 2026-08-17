import { BookCheck, Heart, Info, X } from 'lucide-react'
import { Pressable } from '../ui/Pressable'

interface DeckActionsProps {
  disabled: boolean
  onRead: () => void
  onSkip: () => void
  onInfo: () => void
  onLike: () => void
}

/**
 * Alternative tactile au swipe, sur le même chemin de code. Les deux actions
 * principales restent au centre dans l'ordre des directions du geste.
 */
export function DeckActions({ disabled, onRead, onSkip, onInfo, onLike }: DeckActionsProps) {
  return (
    <div className="flex items-center justify-center gap-4 pt-6">
      <Pressable
        onClick={onRead}
        disabled={disabled}
        aria-label="Je l'ai déjà lu"
        title="Je l'ai déjà lu"
        className="glass flex size-12 flex-col items-center justify-center gap-0.5 rounded-full text-gold transition-opacity disabled:opacity-25"
      >
        <BookCheck size={17} strokeWidth={2.2} />
        <span className="text-[8px] leading-none font-semibold tracking-wide">Lu</span>
      </Pressable>

      <Pressable
        onClick={onSkip}
        disabled={disabled}
        aria-label="Passer ce livre"
        className="glass grid size-16 place-items-center rounded-full text-nope transition-opacity disabled:opacity-25"
      >
        <X size={26} strokeWidth={2.5} />
      </Pressable>

      <Pressable
        onClick={onLike}
        disabled={disabled}
        aria-label="Ajouter à la wishlist"
        className="grid size-16 place-items-center rounded-full bg-like text-void shadow-[0_12px_32px_-10px_rgb(63_224_160/0.7)] transition-opacity disabled:opacity-25"
      >
        <Heart size={26} strokeWidth={2.5} className="fill-void" />
      </Pressable>

      <Pressable
        onClick={onInfo}
        disabled={disabled}
        aria-label="Ouvrir la fiche du livre"
        className="glass grid size-12 place-items-center rounded-full text-cream/70 transition-opacity disabled:opacity-25"
      >
        <Info size={18} strokeWidth={2.2} />
      </Pressable>
    </div>
  )
}
