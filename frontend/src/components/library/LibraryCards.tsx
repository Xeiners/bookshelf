import { useState } from 'react'
import { useCollection } from '../../hooks/useCollection'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { CollectionAlbum } from '../cards/CollectionAlbum'
import { CollectionView } from '../cards/CollectionView'

type CardTab = 'collection' | 'owned' | 'favorites'

/**
 * Cartes dans la bibliothèque : la collection complète (la même que dans les Activités, avec la
 * conversion des doublons), celles qu'on possède et ses favoris. Même album (filtres rareté,
 * série, recherche ; toucher une carte l'affiche en grand, avec son cœur de favori).
 */
export function LibraryCards() {
  const t = useT()
  const { data, status, retry } = useCollection()
  const [tab, setTab] = useState<CardTab>('collection')
  const favorites = data ? data.cards.filter((card) => card.owned && card.isFavorite).length : null
  const owned = data ? data.owned : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div role="tablist" className="glass mx-5 flex shrink-0 self-start rounded-full p-1 md:max-w-lg">
        {(['collection', 'owned', 'favorites'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              if (id === tab) return
              vibrate(6)
              setTab(id)
            }}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${tab === id ? 'bg-cream text-void' : 'text-cream/75'}`}
          >
            {t.library.cardTabs[id]}
            {id !== 'collection' && <span className="text-[10px] tabular-nums opacity-60">{id === 'owned' ? owned : favorites}</span>}
          </button>
        ))}
      </div>
      {tab === 'collection' ? (
        <CollectionView />
      ) : (
      <CollectionAlbum
        key={tab}
        data={data}
        status={status}
        retry={retry}
        lockedOwnership={tab}
        emptyLabel={tab === 'owned' ? t.library.cardTabs.emptyOwned : t.library.cardTabs.emptyFavorites}
      />
      )}
    </div>
  )
}
