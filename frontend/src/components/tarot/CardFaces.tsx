import { Star } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useT } from '../../i18n'
import { rankTier } from '../../lib/oracle'
import type { Book } from '../../types/book'
import { BookCover } from '../ui/BookCover'
import { CARD_NUMERALS } from './decks'

/** En dessous de cette largeur, la carte ne garde que l'essentiel (mobile, 3 de front). */
const COMPACT_WIDTH = 150

interface FaceHeaderProps {
  index: number
  name: string
  tone: string
  compact: boolean
}

/** Bandeau haut de la face : numéro et nom de la carte, filet épais — grammaire néo-brutaliste. */
function FaceHeader({ index, name, tone, compact }: FaceHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between border-b-2 ${compact ? 'px-2 py-1.5' : 'px-3.5 py-2.5'}`}
      style={{ borderColor: tone }}
    >
      <span className={`font-display ${compact ? 'text-[11px]' : 'text-sm'}`} style={{ color: tone }}>
        {CARD_NUMERALS[index]}
      </span>
      <span
        className={`truncate pl-2 font-semibold tracking-[0.18em] text-cream/80 uppercase ${compact ? 'text-[7px]' : 'text-[9.5px]'}`}
      >
        {name}
      </span>
    </div>
  )
}

interface SymbolFaceProps {
  index: number
  cardName: string
  icon: LucideIcon
  tone: string
  title: string
  line: string
  width: number
}

/** Face « symbole » : l'Ambiance et le Rythme. */
export function SymbolFace({ index, cardName, icon: Icon, tone, title, line, width }: SymbolFaceProps) {
  const compact = width < COMPACT_WIDTH
  return (
    <div className="flex h-full flex-col">
      <FaceHeader index={index} name={cardName} tone={tone} compact={compact} />
      <div className="relative flex flex-1 flex-col items-center justify-center gap-2 px-2 text-center">
        {/* Trame de fond : lignes diagonales, très discrètes */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ background: `repeating-linear-gradient(135deg, ${tone} 0 1px, transparent 1px 9px)` }}
        />
        <span
          className={`relative grid place-items-center rounded-full border-2 ${compact ? 'size-11' : 'size-20'}`}
          style={{ borderColor: tone, color: tone, boxShadow: `0 0 28px -4px ${tone}` }}
        >
          <Icon size={compact ? 20 : 36} strokeWidth={2} />
        </span>
        <p className={`relative font-display leading-[1.02] text-cream ${compact ? 'text-[15px]' : 'text-[1.7rem]'}`}>
          {title}
        </p>
        {!compact && <p className="relative max-w-[90%] text-[11px] leading-snug text-cream/60 italic">{line}</p>}
      </div>
    </div>
  )
}

interface PepiteFaceProps {
  index: number
  cardName: string
  book: Book
  tone: string
  width: number
}

/** Face « Pépite » : couverture HD, titre, rang et note. */
export function PepiteFace({ index, cardName, book, tone, width }: PepiteFaceProps) {
  const t = useT()
  const compact = width < COMPACT_WIDTH
  return (
    <div className="flex h-full flex-col">
      <FaceHeader index={index} name={cardName} tone={tone} compact={compact} />
      <div className={`relative min-h-0 flex-1 border-b-2`} style={{ borderColor: tone }}>
        <BookCover book={book} eager className="h-full w-full" />
        <span
          className={`absolute top-1.5 right-1.5 rounded-md border-2 border-void font-black tracking-[0.1em] text-void uppercase ${
            compact ? 'px-1 py-px text-[7px]' : 'px-2 py-0.5 text-[10px]'
          }`}
          style={{ backgroundColor: tone }}
        >
          {t.oracle.rank(rankTier(book.rating))}
        </span>
      </div>
      <div className={compact ? 'px-2 py-1.5' : 'px-3.5 py-3'}>
        <p className={`line-clamp-2 font-display leading-[1.05] text-cream ${compact ? 'text-[11px]' : 'text-lg'}`}>
          {book.title}
        </p>
        {!compact && book.rating !== null && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-gold">
            <Star size={11} className="fill-gold" />
            {book.rating.toFixed(1)}
          </p>
        )}
      </div>
    </div>
  )
}
