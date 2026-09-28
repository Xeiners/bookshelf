import { useState, type FormEvent } from 'react'
import { ArrowLeft, BookOpen, HardDriveDownload, ImageOff, LoaderCircle, Search, WandSparkles } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { hasExternalCover, novelAsBook, patchFromRecord } from '../../lib/novels'
import type { CachedCloudBook } from '../../lib/reader/cloudBooks'
import { booksApi } from '../../services/booksApi'
import { displayPercent, useNovelStore } from '../../store/useNovelStore'
import { useUiStore } from '../../store/useUiStore'
import type { Book } from '../../types/book'
import { BookCover } from '../ui/BookCover'

type SearchState = { phase: 'idle' } | { phase: 'loading' } | { phase: 'error' } | { phase: 'done'; results: Book[] }

/**
 * Fiche d'un roman du compte : couverture, résumé, avancement, et
 * « Corriger la fiche » — recherche Open Library / Google Books, puis la
 * fiche choisie remplace titre, auteur, résumé et couverture.
 */
export function NovelDetails({ userId, entry, onBack }: { userId: string; entry: CachedCloudBook; onBack: () => void }) {
  const t = useT()
  const language = useLanguage()
  const { book } = entry
  const [query, setQuery] = useState(() => [book.title, book.author?.split(',')[0]].filter(Boolean).join(' '))
  const [search, setSearch] = useState<SearchState>({ phase: 'idle' })
  const [applying, setApplying] = useState<string | null>(null)
  const percent = Math.round(displayPercent(entry))
  const notify = useUiStore((state) => state.notify)

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault()
    if (query.trim().length < 2) return
    setSearch({ phase: 'loading' })
    try {
      setSearch({ phase: 'done', results: await booksApi.search(query.trim(), language) })
    } catch {
      setSearch({ phase: 'error' })
    }
  }

  const apply = async (patch: Parameters<typeof booksApi.update>[1], key: string) => {
    setApplying(key)
    try {
      await useNovelStore.getState().update(userId, book.id, patch)
      notify(t.novels.sheet.applied, 'like')
      setSearch({ phase: 'idle' })
    } catch {
      notify(t.novels.sheet.applyFailed, 'nope')
    } finally {
      setApplying(null)
    }
  }

  const facts = [book.year ? String(book.year) : null, book.pages ? t.novels.sheet.pages(book.pages) : null, book.publisher].filter(Boolean)

  return (
    <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-xs text-cream/70 hover:text-cream">
        <ArrowLeft size={14} aria-hidden />
        {t.novels.sheet.back}
      </button>

      <div className="flex gap-4">
        <span className="relative block h-40 w-[6.75rem] shrink-0 overflow-hidden rounded-lg bg-carbon shadow-lift">
          <BookCover book={novelAsBook(book)} eager className="h-full w-full" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-2xl leading-tight text-cream">{book.title}</h3>
          {book.author && <p className="mt-1 text-sm text-cream/70">{t.novels.sheet.by(book.author)}</p>}
          {facts.length > 0 && <p className="mt-2 text-xs text-mist">{facts.join(' · ')}</p>}
          <p className="mt-2 text-xs text-mist">
            {percent > 0 ? t.novels.progress(percent) : t.novels.fresh}
            {entry.downloaded && (
              <span className="ml-2 inline-flex items-center gap-1 text-like">
                <HardDriveDownload size={11} aria-hidden />
                {t.novels.onDeviceHint}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => useUiStore.getState().openReader({ source: 'cloud', bookId: book.id })}
            aria-label={t.novels.read(book.title)}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-cream px-5 py-2.5 text-xs font-semibold text-void"
          >
            <BookOpen size={14} aria-hidden />
            {percent > 0 ? t.novels.resume : t.novels.start}
          </button>
        </div>
      </div>

      <p className="mt-5 text-sm leading-relaxed whitespace-pre-line text-cream/80">{book.synopsis || t.novels.sheet.noSynopsis}</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {entry.downloaded && (
          <button
            type="button"
            onClick={() => {
              void useNovelStore.getState().forgetDownload(book.id).then(() => notify(t.novels.forgotten, 'neutral'))
            }}
            className="glass rounded-full px-3.5 py-2 text-xs text-cream/80"
          >
            {t.novels.forget}
          </button>
        )}
        {hasExternalCover(book) && (
          <button
            type="button"
            disabled={applying !== null}
            onClick={() => void apply({ coverUrl: null }, 'cover')}
            className="glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs text-cream/80 disabled:opacity-50"
          >
            <ImageOff size={13} aria-hidden />
            {t.novels.sheet.originalCover}
          </button>
        )}
      </div>

      <section className="mt-6 rounded-3xl bg-white/[0.03] p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-cream">
          <WandSparkles size={15} className="text-gold" aria-hidden />
          {t.novels.sheet.fixTitle}
        </h4>
        <p className="mt-1 text-xs text-mist">{t.novels.sheet.fixHint}</p>
        <form onSubmit={(event) => void runSearch(event)} className="mt-3 flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t.novels.sheet.searchLabel}
            className="glass min-w-0 flex-1 rounded-full px-4 py-2 text-sm text-cream placeholder:text-mist focus:outline-none"
          />
          <button
            type="submit"
            disabled={search.phase === 'loading'}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-cream px-4 text-xs font-semibold text-void disabled:opacity-60"
          >
            {search.phase === 'loading' ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : <Search size={13} aria-hidden />}
            {search.phase === 'loading' ? t.novels.sheet.searching : t.novels.sheet.search}
          </button>
        </form>

        {search.phase === 'error' && <p role="alert" className="mt-3 text-xs text-nope">{t.novels.sheet.searchError}</p>}
        {search.phase === 'done' && search.results.length === 0 && <p className="mt-3 text-xs text-mist">{t.novels.sheet.noResults}</p>}
        {search.phase === 'done' && search.results.length > 0 && (
          <ul className="mt-3 space-y-1">
            {search.results.slice(0, 8).map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  disabled={applying !== null}
                  onClick={() => void apply(patchFromRecord(record), record.id)}
                  aria-label={t.novels.sheet.apply(record.title)}
                  className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-white/[0.05] disabled:opacity-60"
                >
                  <span className="relative block h-14 w-10 shrink-0 overflow-hidden rounded bg-carbon">
                    <BookCover book={record} className="h-full w-full" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-cream">{record.title}</span>
                    <span className="block truncate text-xs text-mist">
                      {[record.authors.join(', '), record.year, record.pages ? t.novels.sheet.pages(record.pages) : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {applying === record.id && <LoaderCircle size={14} className="shrink-0 animate-spin text-gold" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
