import { BookCheck, Heart, Info, Undo2, X } from 'lucide-react'
import { useT } from '../../i18n'
import { Pressable } from '../ui/Pressable'

interface DeckActionsProps {
  disabled: boolean
  /** Absent sur le squelette de chargement : rien à annuler. */
  canUndo?: boolean
  onUndo?: () => void
  onRead: () => void
  onSkip: () => void
  onInfo: () => void
  onLike: () => void
}

/**
 * Alternative tactile au swipe, sur le même chemin de code. Les deux actions
 * principales restent au centre dans l'ordre des directions du geste ; le retour
 * arrière ouvre la rangée à gauche.
 *
 * Cinq boutons : sous 360 px de large, ils rétrécissent et se resserrent.
 */
export function DeckActions({ disabled, canUndo = false, onUndo, onRead, onSkip, onInfo, onLike }: DeckActionsProps) {
  const t = useT()
  return (
    <div className="flex items-center justify-center gap-2 pt-6 min-[360px]:gap-3 min-[390px]:gap-4">
      <Pressable
        onClick={onUndo}
        disabled={!canUndo}
        aria-label={t.deck.undo}
        title={t.deck.undoHint}
        className="glass grid size-11 place-items-center rounded-full text-cream/80 transition-opacity disabled:opacity-25 min-[360px]:size-12"
      >
        <Undo2 size={18} strokeWidth={2.2} />
      </Pressable>

      <Pressable
        onClick={onRead}
        disabled={disabled}
        aria-label={t.deck.alreadyRead}
        title={t.deck.readHint}
        className="glass flex size-11 flex-col items-center justify-center gap-0.5 rounded-full text-gold transition-opacity disabled:opacity-25 min-[360px]:size-12"
      >
        <BookCheck size={17} strokeWidth={2.2} />
        <span className="text-[8px] leading-none font-semibold tracking-wide">{t.deck.readShort}</span>
      </Pressable>

      <Pressable
        onClick={onSkip}
        disabled={disabled}
        aria-label={t.deck.skip}
        className="glass grid size-14 place-items-center rounded-full text-nope transition-opacity disabled:opacity-25 min-[360px]:size-16"
      >
        <X size={26} strokeWidth={2.5} />
      </Pressable>

      <Pressable
        onClick={onLike}
        disabled={disabled}
        aria-label={t.deck.like}
        className="grid size-14 place-items-center rounded-full bg-like text-void shadow-[0_12px_32px_-10px_rgb(63_224_160/0.7)] transition-opacity disabled:opacity-25 min-[360px]:size-16"
      >
        <Heart size={26} strokeWidth={2.5} className="fill-void" />
      </Pressable>

      <Pressable
        onClick={onInfo}
        disabled={disabled}
        aria-label={t.deck.open}
        className="glass grid size-11 place-items-center rounded-full text-cream/70 transition-opacity disabled:opacity-25 min-[360px]:size-12"
      >
        <Info size={18} strokeWidth={2.2} />
      </Pressable>
    </div>
  )
}
