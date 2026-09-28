import { useRef } from 'react'
import { Check, FileText } from 'lucide-react'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { novelAsBook } from '../../lib/novels'
import { useAuthStore } from '../../store/useAuthStore'
import { useNovelStore, type PendingMatch } from '../../store/useNovelStore'
import { useUiStore } from '../../store/useUiStore'
import type { Book } from '../../types/book'
import { BookCover } from '../ui/BookCover'
import { Sheet } from '../ui/Sheet'

/**
 * « Quel livre est-ce ? » : un EPUB importé ressemble à plusieurs fiches de
 * roman sans certitude. L'utilisateur choisit la bonne (couvertures à
 * l'appui), ou garde une fiche tirée du fichier. Fermer sans choisir revient
 * à ce second choix : un livre importé a toujours sa fiche dans la
 * bibliothèque. Un import à la fois, dans l'ordre d'arrivée.
 */
export function EpubMatchModal() {
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const pending = useNovelStore((state) => state.pendingMatches[0] ?? null)
  if (!userId || !pending) return null
  return <MatchSheet key={pending.book.id} userId={userId} pending={pending} />
}

function MatchSheet({ userId, pending }: { userId: string; pending: PendingMatch }) {
  const t = useT()
  const copy = t.novels.match
  const resolveMatch = useNovelStore((state) => state.resolveMatch)
  const notify = useUiStore((state) => state.notify)
  /** Choix fait ; appliqué une fois la feuille refermée (sortie animée, puis rattachement). */
  const choice = useRef<Book | 'own' | null>(null)
  const { book, candidates } = pending
  const fromFile = novelAsBook(book)

  const choose = (picked: Book | 'own', dismiss: () => void) => {
    if (choice.current) return
    choice.current = picked
    vibrate(10)
    dismiss()
  }

  return (
    <Sheet
      label={copy.title}
      title={copy.title}
      subtitle={copy.subtitle(book.title)}
      onClose={() => void resolveMatch(userId, book.id, choice.current ?? 'own').catch(() => notify(copy.error, 'nope'))}
      footer={(dismiss) => (
        <button
          type="button"
          onClick={() => choose('own', dismiss)}
          className="glass flex w-full items-center gap-3 rounded-2xl p-3 text-left"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cream/[0.06] text-mist">
            <FileText size={17} />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium text-cream">{copy.own}</span>
            <span className="block text-[11px] leading-snug text-mist">{copy.ownHint}</span>
          </span>
        </button>
      )}
    >
      {(dismiss) => (
        <div className="space-y-4 pb-2">
          {/* Le fichier importé, pour comparer. */}
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="aspect-2/3 w-12 shrink-0 overflow-hidden rounded-lg">
              <BookCover book={fromFile} className="h-full w-full" eager />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.2em] text-mist uppercase">{copy.fromFile}</p>
              <p className="mt-0.5 truncate text-sm text-cream">{book.title}</p>
              {book.author && <p className="truncate text-[11px] text-mist">{book.author}</p>}
            </div>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => choose(candidate, dismiss)}
                  aria-label={copy.pick(candidate.title)}
                  className="group block w-full text-left"
                >
                  <div className="relative aspect-2/3 overflow-hidden rounded-2xl ring-1 ring-white/10 transition-shadow group-hover:ring-glow/60">
                    <BookCover book={candidate} className="h-full w-full" eager />
                    <span className="absolute right-1.5 bottom-1.5 grid size-7 place-items-center rounded-full bg-cream text-void opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Check size={14} />
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-cream">
                    {candidate.title}
                    {candidate.subtitle && <span className="text-mist"> · {candidate.subtitle}</span>}
                  </p>
                  <p className="truncate text-[10px] text-mist">
                    {[candidate.authors[0], candidate.year, candidate.publisher].filter(Boolean).join(' · ')}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  )
}
