import { BookCheck, Clock, Flame, Heart, Sparkles, Star, X } from 'lucide-react'
import { BookCover } from '../ui/BookCover'
import { Pill } from '../ui/Pill'
import { matchTone } from '../../lib/match'
import { useT } from '../../i18n'
import { formatAuthors, formatReadingTime, primaryCategory } from '../../lib/format'
import type { Book } from '../../types/book'

interface SwipeCardProps {
  book: Book
  /** 0 = carte du dessus. Sert à n'animer que le contenu réellement visible. */
  depth: number
}

/**
 * Carte du deck, purement présentationnelle. Aucun transform ici : ils
 * appartiennent à `SwipeDeck`, qui accroche ses animations via les attributs
 * `data-cover`, `data-sheen` et `data-stamp` (un calque par direction : bord coloré + tampon).
 */
export function SwipeCard({ book, depth }: SwipeCardProps) {
  const t = useT()
  const readingTime = formatReadingTime(book.pages, t)
  const isTop = depth === 0

  return (
    <article
      data-card={book.id}
      className="absolute inset-0 will-change-transform [backface-visibility:hidden]"
    >
      <div className="relative h-full w-full overflow-hidden rounded-[2.25rem] bg-ink shadow-card">
        <div data-cover className="absolute inset-0 scale-[1.06] will-change-transform">
          {/* Les quatre cartes sont peu nombreuses et doivent être prêtes avant promotion. */}
          <BookCover book={book} eager className="h-full w-full" />
        </div>

        {/* Voile haut (badges) et plaque de lecture en bas : le texte ne se pose
            jamais directement sur l'illustration, quelle que soit la couverture. */}
        <div className="absolute inset-x-0 top-0 h-28 bg-linear-to-b from-void/75 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[68%] bg-linear-to-t from-void from-38% via-void/85 via-62% to-transparent" />

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

        {/*
          Métadonnées hautes — `flat` : ces badges se déplacent avec la carte.
          UNE seule ligne, par ordre d'importance : ceux qui ne tiennent pas
          passent à la ligne… masquée (hauteur d'un badge + overflow). Jamais de
          badge coupé en deux, et le titre n'est jamais recouvert, même sur un
          petit écran où la carte est courte.
        */}
        <div className="absolute inset-x-5 top-5 flex h-[26px] flex-wrap items-start gap-x-2 gap-y-6 overflow-hidden">
          {/* Compatibilité calculée par le moteur de recommandation */}
          {book.matchPercentage !== undefined && (
            <Pill
              flat
              tone={matchTone(book.matchPercentage)}
              icon={<Flame size={12} strokeWidth={2.5} />}
              className="font-semibold"
              title={t.deck.matchHint}
            >
              {t.deck.match(book.matchPercentage)}
            </Pill>
          )}
          {book.discovery && (
            <Pill flat tone="glow" icon={<Sparkles size={12} strokeWidth={2.5} />} title={t.deck.discoveryHint}>
              {t.deck.discovery}
            </Pill>
          )}
          {book.rating !== null && (
            <Pill
              flat
              tone="gold"
              icon={<Star size={12} strokeWidth={2.5} className="fill-gold" />}
            >
              {book.rating.toFixed(1)}
            </Pill>
          )}
          <Pill flat tone="glow">
            {primaryCategory(book, t)}
          </Pill>
          {book.kind && book.kind !== 'book' && <Pill flat>{t.kind[book.kind]}</Pill>}
          {readingTime && (
            <Pill flat icon={<Clock size={12} strokeWidth={2.5} />}>
              {readingTime}
            </Pill>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 p-6 pb-7">
          <p className="mb-2.5 flex items-center gap-2 text-[10px] font-semibold tracking-[0.24em] text-cream/80 uppercase">
            <span aria-hidden className="h-px w-5 shrink-0 bg-cream/50" />
            <span className="truncate">{formatAuthors(book.authors, t)}</span>
            {book.year !== null && <span className="shrink-0 text-cream/45">· {book.year}</span>}
          </p>

          {/* Trois lignes au plus : un titre fleuve ne mange plus la carte. */}
          <h2 className="line-clamp-3 font-display text-[clamp(1.75rem,7vw,2.35rem)] leading-[0.98] text-balance text-cream [text-shadow:0_2px_16px_rgb(0_0_0/0.55)]">
            {book.title}
          </h2>

          {book.subtitle && (
            <p className="mt-1.5 truncate font-display text-base leading-tight text-cream/55 italic">
              {book.subtitle}
            </p>
          )}

          <div aria-hidden className="mt-4 h-px bg-linear-to-r from-cream/25 via-cream/10 to-transparent" />

          {/* Rendu à toutes les profondeurs : le texte ne doit pas surgir (et
              décaler le titre) au moment où la carte est promue. */}
          {book.synopsis ? (
            <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-cream/85">
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
                  {/* Animation réservée à la carte visible : les autres sont masquées. */}
                  {isTop && <div className="animate-shimmer h-full w-1/2 bg-cream/20" />}
                </div>
              ))}
            </div>
          )}
        </div>

        {/*
          Retour visuel du geste, un calque par direction (opacité pilotée par
          le doigt) : le bord vers lequel on glisse se colore, et le tampon
          nomme la décision. Au-dessus du texte, pour rester lisible.
        */}
        <div data-stamp="like" className="pointer-events-none absolute inset-0 opacity-0">
          <div
            className="absolute inset-0 rounded-[2.25rem]"
            style={{
              background: 'linear-gradient(to left, color-mix(in oklab, var(--color-like) 45%, transparent), transparent 60%)',
              boxShadow: 'inset 0 0 0 3px var(--color-like)',
            }}
          />
          <span className="absolute top-20 left-6 flex rotate-[-13deg] items-center gap-2 rounded-2xl border-2 border-like/70 bg-void/65 px-4 py-2 font-display text-3xl leading-none text-like">
            <Heart size={22} strokeWidth={2.5} className="fill-like" />
            {t.deck.stampLike}
          </span>
        </div>
        <div data-stamp="skip" className="pointer-events-none absolute inset-0 opacity-0">
          <div
            className="absolute inset-0 rounded-[2.25rem]"
            style={{
              background: 'linear-gradient(to right, color-mix(in oklab, var(--color-nope) 45%, transparent), transparent 60%)',
              boxShadow: 'inset 0 0 0 3px var(--color-nope)',
            }}
          />
          <span className="absolute top-20 right-6 flex rotate-[13deg] items-center gap-2 rounded-2xl border-2 border-nope/70 bg-void/65 px-4 py-2 font-display text-3xl leading-none text-nope">
            <X size={22} strokeWidth={3} />
            {t.deck.stampSkip}
          </span>
        </div>
        {/* Glisser vers le haut : « déjà lu » */}
        <div data-stamp="read" className="pointer-events-none absolute inset-0 opacity-0">
          <div
            className="absolute inset-0 rounded-[2.25rem]"
            style={{
              background: 'linear-gradient(to bottom, color-mix(in oklab, var(--color-gold) 45%, transparent), transparent 55%)',
              boxShadow: 'inset 0 0 0 3px var(--color-gold)',
            }}
          />
          <div className="absolute inset-x-0 top-[34%] flex justify-center">
            <span className="flex rotate-[-4deg] items-center gap-2 rounded-2xl border-2 border-gold/70 bg-void/65 px-4 py-2 font-display text-3xl leading-none text-gold">
              <BookCheck size={22} strokeWidth={2.5} />
              {t.deck.stampRead}
            </span>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 rounded-[2.25rem] ring-1 ring-white/12 ring-inset" />
      </div>
    </article>
  )
}
