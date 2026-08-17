import { useCallback } from 'react'
import { RotateCcw, Shuffle, WifiOff } from 'lucide-react'
import { useDiscoveryQueue } from '../../hooks/useDiscoveryQueue'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import type { Book, SwipeIntent } from '../../types/book'
import { Pressable } from '../ui/Pressable'
import { DeckActions } from './DeckActions'
import { ShelfPicker } from './ShelfPicker'
import { SwipeDeck } from './SwipeDeck'

/** Placeholder de chargement — même géométrie que la carte pour éviter le saut. */
function DeckSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-x-4 -top-6 bottom-6 scale-95 rounded-[2rem] bg-cream/[0.03]" />
        <div className="absolute inset-0 overflow-hidden rounded-[2.25rem] bg-carbon shadow-card">
          <div className="animate-shimmer absolute inset-y-0 -left-full w-1/2 bg-linear-to-r from-transparent via-white/[0.05] to-transparent" />
        </div>
      </div>
      <DeckActions
        disabled
        onRead={() => {}}
        onSkip={() => {}}
        onLike={() => {}}
        onInfo={() => {}}
      />
    </div>
  )
}

function DeckEmpty({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 text-center">
      <div className="glass grid size-20 place-items-center rounded-full">
        <Shuffle size={26} className="text-glow" />
      </div>
      <div>
        <h2 className="font-display text-3xl">Étagère épuisée</h2>
        <p className="mx-auto mt-2 max-w-[16rem] text-sm text-mist">
          Tu as passé en revue tout ce rayon. Change de thème ou relance une fournée.
        </p>
      </div>
      <Pressable
        onClick={onReload}
        className="flex items-center gap-2 rounded-full bg-cream px-5 py-3 text-sm font-medium text-void"
      >
        <RotateCcw size={16} />
        Nouvelle sélection
      </Pressable>
    </div>
  )
}

export function DiscoverView() {
  const { queue, cursor, remaining, shelf, phase, offline, refilling, advance, selectShelf, reload } =
    useDiscoveryQueue()

  const save = useLibraryStore((state) => state.save)
  const skip = useLibraryStore((state) => state.skip)
  const notify = useUiStore((state) => state.notify)
  const openDetail = useUiStore((state) => state.openDetail)

  const handleDecision = useCallback(
    (book: Book, intent: SwipeIntent) => {
      if (intent === 'wishlist') {
        save(book, 'wishlist')
        notify(`« ${book.title} » rejoint ta wishlist`, 'like')
      } else if (intent === 'read') {
        save(book, 'read')
        notify(`« ${book.title} » classé dans tes lectures`, 'like')
      } else {
        skip(book)
      }
      advance()
    },
    [advance, notify, save, skip],
  )

  // La file peut tomber à zéro pendant qu'un renfort arrive : on montre alors
  // le squelette, jamais « étagère épuisée ».
  const isLoading = phase === 'loading' || (remaining === 0 && refilling)
  const isExhausted = !isLoading && remaining === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5">
      {/* Rail d'étagères + actions, sur une seule ligne de hauteur constante */}
      <div className="flex items-center gap-2">
        <ShelfPicker active={shelf} onSelect={selectShelf} />

        {offline && (
          <span
            title="Mode hors-ligne — jeu de secours local"
            className="glass grid size-11 shrink-0 place-items-center rounded-full text-gold"
          >
            <WifiOff size={15} />
          </span>
        )}

        <Pressable
          onClick={reload}
          aria-label="Relancer une sélection"
          className="glass grid size-11 shrink-0 place-items-center rounded-full text-cream/70"
        >
          <Shuffle size={17} />
        </Pressable>
      </div>

      {isLoading ? (
        <DeckSkeleton />
      ) : isExhausted ? (
        <DeckEmpty onReload={reload} />
      ) : (
        <SwipeDeck
          // Remonter le deck à chaque étagère rejoue l'entrée en éventail.
          key={shelf.id}
          queue={queue}
          cursor={cursor}
          onDecision={handleDecision}
          onOpen={openDetail}
        />
      )}
    </div>
  )
}
