import { useCallback, useState } from 'react'
import { RotateCcw, Shuffle, WifiOff } from 'lucide-react'
import { useDiscoveryQueue } from '../../hooks/useDiscoveryQueue'
import { withoutDeckFields, type DeckOrigin } from '../../services/discover'
import { useT } from '../../i18n'
import { type LibrarySnapshot, useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import type { Book, SwipeIntent } from '../../types/book'
import { Pressable } from '../ui/Pressable'
import { DeckActions } from './DeckActions'
import { DeckFilters } from './DeckFilters'
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

/** Profondeur de l'historique « Retour ». */
const MAX_UNDO = 20

interface Decision {
  book: Book
  before: LibrarySnapshot
}

function DeckEmpty({ onReload }: { onReload: () => void }) {
  const t = useT()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 text-center">
      <div className="glass grid size-20 place-items-center rounded-full">
        <Shuffle size={26} className="text-glow" />
      </div>
      <div>
        <h2 className="font-display text-3xl">{t.deck.exhaustedTitle}</h2>
        <p className="mx-auto mt-2 max-w-[16rem] text-sm text-mist">
          {t.deck.exhaustedBody}
        </p>
      </div>
      <Pressable
        onClick={onReload}
        className="flex items-center gap-2 rounded-full bg-cream px-5 py-3 text-sm font-medium text-void"
      >
        <RotateCcw size={16} />
        {t.deck.newSelection}
      </Pressable>
    </div>
  )
}

export function DiscoverView() {
  const t = useT()
  const {
    queue,
    cursor,
    remaining,
    shelf,
    origin,
    phase,
    offline,
    refilling,
    advance,
    rewind,
    selectShelf,
    selectOrigin,
    reload,
  } = useDiscoveryQueue()

  const save = useLibraryStore((state) => state.save)
  const skip = useLibraryStore((state) => state.skip)
  const snapshot = useLibraryStore((state) => state.snapshot)
  const restore = useLibraryStore((state) => state.restore)
  const openDetail = useUiStore((state) => state.openDetail)

  /*
   * Choix annulables, du plus ancien au plus récent. Pas de toast à chaque
   * swipe : le bouton « Retour » suffit à rattraper une erreur.
   */
  const [history, setHistory] = useState<Decision[]>([])
  // Annulable seulement si la carte juste avant le curseur est bien la dernière décidée
  // (une nouvelle étagère ou une relance remplace la file).
  const last = history.at(-1)
  const canUndo = last !== undefined && queue[cursor - 1]?.id === last.book.id

  const handleDecision = useCallback(
    (book: Book, intent: SwipeIntent) => {
      const before = snapshot(book.id)
      // Le % de match décrit la carte à un instant donné : il ne suit pas le titre en bibliothèque.
      if (intent === 'wishlist') save(withoutDeckFields(book), 'wishlist')
      else if (intent === 'read') save(withoutDeckFields(book), 'read')
      else skip(book)
      setHistory((previous) => [...previous.slice(1 - MAX_UNDO), { book, before }])
      advance()
    },
    [advance, save, skip, snapshot],
  )

  const handleUndo = useCallback(
    (book: Book) => {
      if (!last || last.book.id !== book.id) return
      restore(book.id, last.before)
      setHistory((previous) => previous.slice(0, -1))
      rewind()
    },
    [last, restore, rewind],
  )

  // Nouvelle étagère ou relance : l'historique ne correspond plus à la file.
  const changeShelf: typeof selectShelf = (next) => {
    setHistory([])
    selectShelf(next)
  }
  const changeOrigin = (next: DeckOrigin) => {
    if (next === origin) return
    setHistory([])
    selectOrigin(next)
  }
  const reloadDeck = () => {
    setHistory([])
    reload()
  }

  // La file peut tomber à zéro pendant qu'un renfort arrive : on montre alors
  // le squelette, jamais « étagère épuisée ».
  const isLoading = phase === 'loading' || (remaining === 0 && refilling)
  const isExhausted = !isLoading && remaining === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5">
      {/* Rail d'étagères + filtres, sur une seule ligne ; au-dessus du deck pour le panneau de filtres */}
      <div className="relative z-20 flex items-center gap-2">
        <ShelfPicker active={shelf} onSelect={changeShelf} />

        {offline && (
          <span
            title={t.deck.offline}
            className="glass grid size-11 shrink-0 place-items-center rounded-full text-gold"
          >
            <WifiOff size={15} />
          </span>
        )}

        {/* Origine + nouvelle sélection, dans un panneau : une seule rangée au-dessus de la carte. */}
        <DeckFilters origin={origin} onOrigin={changeOrigin} onReload={reloadDeck} />
      </div>

      {isLoading ? (
        <DeckSkeleton />
      ) : isExhausted ? (
        <DeckEmpty onReload={reloadDeck} />
      ) : (
        <SwipeDeck
          // Remonter le deck à chaque étagère (ou origine) rejoue l'entrée en éventail.
          key={`${shelf.id}|${origin}`}
          queue={queue}
          cursor={cursor}
          onDecision={handleDecision}
          onOpen={openDetail}
          canUndo={canUndo}
          onUndo={handleUndo}
        />
      )}
    </div>
  )
}
