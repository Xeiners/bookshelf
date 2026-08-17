import { Check, Plus, Star } from 'lucide-react'
import { formatAuthors, primaryCategory } from '../../lib/format'
import { vibrate } from '../../lib/haptics'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import type { Book } from '../../types/book'
import { STATUS_LABEL, STATUS_TOKEN } from '../../types/book'
import { BookCover } from '../ui/BookCover'
import { Pressable } from '../ui/Pressable'

interface SearchResultRowProps {
  book: Book
}

/** Une ligne de résultat : consultation au tap, ajout express au bouton. */
export function SearchResultRow({ book }: SearchResultRowProps) {
  const entry = useLibraryStore((state) => state.entries[book.id])
  const save = useLibraryStore((state) => state.save)
  const openDetail = useUiStore((state) => state.openDetail)
  const notify = useUiStore((state) => state.notify)

  return (
    <div data-row className="flex items-center gap-3.5">
      <button
        type="button"
        onClick={() => openDetail(book)}
        className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
      >
        <div className="w-11 shrink-0 overflow-hidden rounded-lg shadow-lift">
          <BookCover book={book} className="aspect-2/3 w-full" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-snug font-medium text-cream">{book.title}</p>
          <p className="mt-0.5 truncate text-[11px] text-mist">{formatAuthors(book.authors)}</p>

          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-mist">
            {book.rating !== null && (
              <span className="flex items-center gap-0.5 text-gold">
                <Star size={9} className="fill-gold" />
                {book.rating.toFixed(1)}
              </span>
            )}
            {book.year !== null && <span>{book.year}</span>}
            <span className="truncate">{primaryCategory(book)}</span>
          </div>
        </div>
      </button>

      {entry ? (
        <span
          title={STATUS_LABEL[entry.status]}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-cream/[0.06]"
        >
          <Check size={15} style={{ color: STATUS_TOKEN[entry.status] }} />
        </span>
      ) : (
        <Pressable
          onClick={() => {
            vibrate(10)
            save(book, 'wishlist')
            notify(`« ${book.title} » rejoint ta wishlist`, 'like')
          }}
          aria-label="Ajouter à la wishlist"
          className="glass grid size-10 shrink-0 place-items-center rounded-full text-cream/70"
        >
          <Plus size={16} />
        </Pressable>
      )}
    </div>
  )
}
