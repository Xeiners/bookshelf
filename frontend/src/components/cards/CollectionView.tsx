import { useState } from 'react'
import { Gift, Sparkles } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'
import { useDuplicates } from '../../hooks/useDuplicates'
import { useT } from '../../i18n'
import { useBoosterStore } from '../../store/useBoosterStore'
import { useUiStore } from '../../store/useUiStore'
import { CollectionAlbum } from './CollectionAlbum'
import { ConvertDuplicatesSheet } from './ConvertSheet'

/**
 * « Ma collection » : l'album du compte. En invité, celui de ses boosters
 * d'essai, avec l'invitation à créer un compte pour les garder.
 */
export function CollectionView() {
  const t = useT()
  const { data, status, retry, signedIn } = useCollection()
  const openAuth = useUiStore((state) => state.openAuth)
  const [duplicates] = useDuplicates(useBoosterStore((state) => state.collectionVersion))
  const [converting, setConverting] = useState(false)
  // Tous les doublons convertibles : cartes et exemplaires (les favoris sont décochés d'office dans la feuille).
  const spare = duplicates?.items ?? []
  const worth = spare.reduce((sum, item) => sum + item.value, 0)
  const copies = spare.reduce((sum, item) => sum + item.extra, 0)
  return (
    <>
      <CollectionAlbum
        data={data}
        status={status}
        retry={retry}
        intro={
          <>
            {signedIn && copies > 0 && (
              <button
                type="button"
                onClick={() => setConverting(true)}
                className="mb-3 flex w-full items-center gap-3 rounded-3xl border border-gold/30 bg-gold/10 p-3.5 text-left transition-colors hover:bg-gold/15"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold/20 text-gold">
                  <Sparkles size={17} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-sm text-cream/90">{t.cards.convert.banner(copies, spare.length, worth)}</span>
                <span className="shrink-0 rounded-full bg-gold px-3.5 py-1.5 text-xs font-semibold text-void">{t.cards.convert.open}</span>
              </button>
            )}
            {/* Invité : ses cartes d'essai ne vivent que sur l'appareil, jusqu'à l'inscription. */}
            {!signedIn && (
              <div className="mb-3 flex items-center gap-3 rounded-3xl border border-[#ffe39a]/25 bg-black/40 p-4">
                <p className="min-w-0 flex-1 text-sm text-cream/80">{t.activities.guest.banner}</p>
                <button type="button" onClick={openAuth} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-semibold text-void">
                  <Gift size={14} aria-hidden />
                  {t.activities.guest.keep}
                </button>
              </div>
            )}
          </>
        }
      />
      {converting && <ConvertDuplicatesSheet onClose={() => setConverting(false)} />}
    </>
  )
}
