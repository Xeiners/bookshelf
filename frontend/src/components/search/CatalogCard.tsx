import { Check, Flame, Heart, Plus, Star } from 'lucide-react'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { MATCH_TEXT, matchTone } from '../../lib/match'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import type { Book } from '../../types/book'
import { STATUS_TOKEN } from '../../types/book'
import { withoutDeckFields } from '../../services/discover'
import { BookCover } from '../ui/BookCover'
import { Pressable } from '../ui/Pressable'

interface CatalogCardProps {
  book: Book
}

/**
 * Tuile du catalogue, façon affiche : la couverture occupe toute la carte, le
 * titre se lit sur un dégradé. En haut, le % de match ; à droite, l'ajout
 * express (ou l'état du titre s'il est déjà en bibliothèque).
 */
export function CatalogCard({ book }: CatalogCardProps) {
  const t = useT()
  const entry = useLibraryStore((state) => state.entries[book.id])
  const save = useLibraryStore((state) => state.save)
  const openDetail = useUiStore((state) => state.openDetail)
  const match = book.matchPercentage

  return (
    <div data-row className="group relative">
      <button
        type="button"
        onClick={() => openDetail(book)}
        className="block w-full text-left"
        aria-label={book.title}
      >
        <div className="relative aspect-2/3 overflow-hidden rounded-2xl bg-carbon shadow-lift transition-transform duration-300 ease-out group-hover:-translate-y-1">
          <BookCover book={book} className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.04]" />
          <div className="absolute inset-0 bg-linear-to-t from-void via-void/35 via-45% to-transparent to-70%" />
          <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/10 ring-inset" />

          {match !== undefined && (
            <span
              title={t.deck.matchHint}
              className={`absolute top-2 left-2 flex items-center gap-1 rounded-full bg-void/75 px-2 py-1 text-[11px] leading-none font-semibold tabular-nums ${MATCH_TEXT[matchTone(match)]}`}
            >
              <Flame size={11} strokeWidth={2.6} />
              {match}%
            </span>
          )}

          <div className="absolute inset-x-0 bottom-0 p-3">
            <p className="line-clamp-2 font-display text-[1.05rem] leading-[1.05] text-cream [text-shadow:0_1px_10px_rgb(0_0_0/0.6)]">
              {book.title}
            </p>
            <div className="mt-1.5 flex items-center gap-2 text-[10px] text-cream/70">
              {book.rating !== null && (
                <span className="flex items-center gap-0.5 font-semibold text-gold">
                  <Star size={9} className="fill-gold" />
                  {book.rating.toFixed(1)}
                </span>
              )}
              {book.kind && book.kind !== 'book' && <span className="truncate">{t.kind[book.kind]}</span>}
              {book.year !== null && <span className="shrink-0 text-cream/45">{book.year}</span>}
            </div>
          </div>
        </div>
      </button>

      {/* Hors du bouton de la carte : deux cibles distinctes, jamais imbriquées. */}
      {entry ? (
        <span
          title={t.status[entry.status]}
          className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-void/75"
        >
          {entry.favorite ? (
            <Heart size={13} strokeWidth={2.6} className="fill-nope text-nope" />
          ) : (
            <Check size={14} strokeWidth={2.8} style={{ color: STATUS_TOKEN[entry.status] }} />
          )}
        </span>
      ) : (
        <Pressable
          onClick={() => {
            vibrate(10)
            save(withoutDeckFields(book), 'wishlist')
          }}
          aria-label={t.search.add(book.title)}
          title={t.deck.like}
          className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-void/75 text-cream/85 transition-colors hover:bg-cream hover:text-void"
        >
          <Plus size={15} strokeWidth={2.6} />
        </Pressable>
      )}
    </div>
  )
}
