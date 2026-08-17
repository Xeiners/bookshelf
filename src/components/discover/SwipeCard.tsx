import { Clock, Heart, Star, X } from 'lucide-react'
import { BookCover } from '../ui/BookCover'
import { Pill } from '../ui/Pill'
import { formatAuthors, formatReadingTime, primaryCategory } from '../../lib/format'
import type { Book } from '../../types/book'

interface SwipeCardProps {
  book: Book
  /** 0 = carte du dessus. Sert au rendu conditionnel du contenu coûteux. */
  depth: number
}

/**
 * Carte du deck, purement présentationnelle. Aucun transform ici : ils
 * appartiennent à `SwipeDeck`, qui accroche ses animations via les attributs
 * `data-cover`, `data-sheen` et `data-stamp`.
 */
export function SwipeCard({ book, depth }: SwipeCardProps) {
  const readingTime = formatReadingTime(book.pages)
  const isTop = depth === 0

  return (
    <article
      data-card={book.id}
      className="absolute inset-0 will-change-transform [backface-visibility:hidden]"
    >
      <div className="relative h-full w-full overflow-hidden rounded-[2.25rem] bg-ink shadow-card">
        <div data-cover className="absolute inset-0 scale-[1.06] will-change-transform">
          <BookCover book={book} bleed eager={depth <= 1} className="h-full w-full" />
        </div>

        <div className="absolute inset-0 bg-linear-to-t from-void via-void/55 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-32 bg-linear-to-b from-void/70 to-transparent" />

        {/* Reflet spéculaire : balayé horizontalement pendant le swipe.
            Pas de `mix-blend-*` : un mode de fusion force la recomposition de
            toute la pile de calques à chaque frame. */}
        <div
          data-sheen
          className="pointer-events-none absolute inset-0 opacity-0 will-change-transform"
          style={{
            background:
              'linear-gradient(105deg, transparent 28%, rgba(255,255,255,0.34) 50%, transparent 72%)',
          }}
        />

        {/* Métadonnées hautes — `flat` : ces badges se déplacent avec la carte */}
        <div className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 p-5">
          <Pill flat tone="glow">
            {primaryCategory(book)}
          </Pill>
          {book.rating !== null && (
            <Pill
              flat
              tone="gold"
              icon={<Star size={12} strokeWidth={2.5} className="fill-gold" />}
            >
              {book.rating.toFixed(1)}
            </Pill>
          )}
          {readingTime && (
            <Pill flat icon={<Clock size={12} strokeWidth={2.5} />}>
              {readingTime}
            </Pill>
          )}
        </div>

        {/* Révélés par l'amplitude du drag */}
        <div
          data-stamp="like"
          className="pointer-events-none absolute top-20 left-6 rotate-[-13deg] opacity-0"
        >
          <span className="flex items-center gap-2 rounded-2xl border-2 border-like/70 bg-void/65 px-4 py-2 font-display text-3xl leading-none text-like">
            <Heart size={22} strokeWidth={2.5} className="fill-like" />
            Wishlist
          </span>
        </div>
        <div
          data-stamp="skip"
          className="pointer-events-none absolute top-20 right-6 rotate-[13deg] opacity-0"
        >
          <span className="flex items-center gap-2 rounded-2xl border-2 border-nope/70 bg-void/65 px-4 py-2 font-display text-3xl leading-none text-nope">
            <X size={22} strokeWidth={3} />
            Passer
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-6 pb-7">
          <p className="mb-2 text-[10px] tracking-[0.28em] text-cream/55 uppercase">
            {formatAuthors(book.authors)}
            {book.year !== null && <span className="text-cream/30"> · {book.year}</span>}
          </p>

          <h2 className="font-display text-[clamp(2rem,8.5vw,2.75rem)] leading-[0.92] text-cream">
            {book.title}
          </h2>

          {book.subtitle && (
            <p className="mt-1.5 font-display text-lg leading-tight text-cream/45 italic">
              {book.subtitle}
            </p>
          )}

          {isTop &&
            (book.synopsis ? (
              <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-cream/70">
                {book.synopsis}
              </p>
            ) : (
              // Le synopsis est hydraté en tâche de fond : squelette en attendant.
              <div className="mt-4 space-y-2">
                {['92%', '78%', '55%'].map((width) => (
                  <div
                    key={width}
                    className="h-2 overflow-hidden rounded-full bg-cream/10"
                    style={{ width }}
                  >
                    <div className="animate-shimmer h-full w-1/2 bg-cream/20" />
                  </div>
                ))}
              </div>
            ))}
        </div>

        <div className="pointer-events-none absolute inset-0 rounded-[2.25rem] ring-1 ring-white/12 ring-inset" />
      </div>
    </article>
  )
}
