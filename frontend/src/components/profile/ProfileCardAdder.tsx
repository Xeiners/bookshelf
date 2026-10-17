import { useState } from 'react'
import { useCollection } from '../../hooks/useCollection'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import type { CollectionCard } from '../../lib/boosters'
import { vibrate } from '../../lib/haptics'
import { FEATURED_MAX, type ProfileCard } from '../../services/profileApi'
import { useProfileStore } from '../../store/useProfileStore'
import { useUiStore } from '../../store/useUiStore'
import { Sheet } from '../ui/Sheet'
import { CardPicker } from './CardPicker'

interface ProfileCardAdderProps {
  /** Cartes déjà exposées : la nouvelle prend la première place libre. */
  featured: ProfileCard[]
  onClose: () => void
}

/**
 * Ajout direct d'une carte à la vitrine, depuis le profil : on choisit dans les cartes
 * possédées et c'est enregistré aussitôt (sans passer par l'éditeur complet).
 */
export function ProfileCardAdder({ featured, onClose }: ProfileCardAdderProps) {
  const t = useT()
  const { data: album } = useCollection()
  const update = useProfileStore((state) => state.update)
  const notify = useUiStore((state) => state.notify)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (card: CollectionCard, dismiss: () => void) => {
    if (saving || featured.length >= FEATURED_MAX) return
    setSaving(true)
    setError(null)
    try {
      await update({ featuredCardIds: [...featured.map((entry) => entry.id), card.id] })
      vibrate(10)
      notify(t.profile.showcase.added(card.name || card.title), 'like')
      dismiss()
    } catch (reason) {
      setError(apiErrorMessage(reason, t))
      setSaving(false)
    }
  }

  return (
    <Sheet label={t.profile.showcase.add} title={t.profile.showcase.add} onClose={onClose}>
      {(dismiss) => (
        <>
          <CardPicker
            heading={t.profile.editor.pickFeatured(featured.length + 1)}
            cards={album?.cards ?? []}
            loading={!album}
            selectedId={null}
            unavailableIds={new Set(featured.map((card) => card.id))}
            onPick={(card) => void pick(card, dismiss)}
            onBack={dismiss}
          />
          {error && (
            <p role="alert" className="mt-3 text-center text-xs text-nope">
              {error}
            </p>
          )}
        </>
      )}
    </Sheet>
  )
}
