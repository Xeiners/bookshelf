import { Gift } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'
import { useT } from '../../i18n'
import { useUiStore } from '../../store/useUiStore'
import { CollectionAlbum } from './CollectionAlbum'

/**
 * « Ma collection » : l'album du compte. En invité, celui de ses boosters
 * d'essai, avec l'invitation à créer un compte pour les garder.
 */
export function CollectionView() {
  const t = useT()
  const { data, status, retry, signedIn } = useCollection()
  const openAuth = useUiStore((state) => state.openAuth)
  return (
    <CollectionAlbum
      data={data}
      status={status}
      retry={retry}
      intro={
        // Invité : ses cartes d'essai ne vivent que sur l'appareil, jusqu'à l'inscription.
        !signedIn && (
          <div className="mb-3 flex items-center gap-3 rounded-3xl border border-[#ffe39a]/25 bg-black/40 p-4">
            <p className="min-w-0 flex-1 text-sm text-cream/80">{t.activities.guest.banner}</p>
            <button type="button" onClick={openAuth} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-semibold text-void">
              <Gift size={14} aria-hidden />
              {t.activities.guest.keep}
            </button>
          </div>
        )
      }
    />
  )
}
