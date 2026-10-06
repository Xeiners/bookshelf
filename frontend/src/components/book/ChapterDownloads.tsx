import { useMemo, useState } from 'react'
import { ChevronDown, Download, Loader2 } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { downloadChapter } from '../../lib/reader/downloads'
import { nextUnread } from '../../lib/reader/downloadPlan'
import { readingOrder } from '../../lib/reader/navigation'
import { chapterNumber } from '../../lib/reader/progress'
import { applySourcePreference } from '../../lib/reader/sources'
import { readerApi } from '../../services/readerApi'
import { useDownloadStore } from '../../store/useDownloadStore'
import { useReaderStore } from '../../store/useReaderStore'
import type { Book } from '../../types/book'
import type { ChapterLanguage, ReaderChapter } from '../../types/reader'
import { DownloadButton } from '../reader/DownloadButton'

/** Choix du lot « les N prochains non lus ». */
const BATCH_SIZES = [3, 5, 10] as const

type ListState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; chapters: ReaderChapter[] }

/**
 * Fiche d'un manga : la liste de ses chapitres, à télécharger un par un ou par lot (les N
 * prochains non lus), pour les lire sans connexion. Repliée par défaut : la liste n'est
 * demandée qu'à l'ouverture.
 */
export function ChapterDownloads({ book, chaptersRead }: { book: Book; chaptersRead: number }) {
  const t = useT()
  const interfaceLanguage = useLanguage()
  const preferredLanguage = useReaderStore((state) => state.chapterLanguage)
  const preferredSource = useReaderStore((state) => state.sourceByWork[book.id] ?? null)
  const language: ChapterLanguage = preferredLanguage ?? interfaceLanguage
  const downloads = useDownloadStore((state) => state.chapters)
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<ListState>({ status: 'idle' })
  const [batch, setBatch] = useState<(typeof BATCH_SIZES)[number]>(5)
  const [showRead, setShowRead] = useState(false)

  const ours = useMemo(() => Object.values(downloads).filter((entry) => entry.manga.id === book.id), [downloads, book.id])
  const downloadedCount = ours.filter((entry) => entry.status === 'done').length
  const pendingCount = ours.filter((entry) => entry.status === 'queued' || entry.status === 'downloading').length

  const load = () => {
    setList({ status: 'loading' })
    readerApi
      .chapters(book.id, language)
      .then((data) => setList({ status: 'ready', chapters: data.chapters }))
      .catch(() => setList({ status: 'error' }))
  }

  const order = useMemo(
    () => (list.status === 'ready' ? readingOrder(applySourcePreference(list.chapters, preferredSource)) : []),
    [list, preferredSource],
  )
  const isRead = (chapter: ReaderChapter) => {
    const number = chapterNumber(chapter.number)
    return number !== null && number <= chaptersRead
  }
  const readCount = order.filter(isRead).length
  const visible = showRead ? order : order.filter((chapter) => !isRead(chapter))
  const next = nextUnread(order, chaptersRead, (id) => Boolean(downloads[id]), batch)
  const labelOf = (chapter: ReaderChapter) => (chapter.number ? t.reader.chapter(chapter.number) : (chapter.title ?? t.reader.oneshot))

  return (
    <section className="mt-6 rounded-2xl bg-cream/[0.04]" data-sheet-item>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          const opening = !open
          setOpen(opening)
          if (opening && (list.status === 'idle' || list.status === 'error')) load()
        }}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-glow/15 text-glow">
          <Download size={16} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-cream">{t.downloads.section}</span>
          <span className="block truncate text-[11px] text-mist">
            {pendingCount > 0
              ? t.downloads.queuedMany(pendingCount)
              : downloadedCount > 0
                ? t.downloads.downloadedCount(downloadedCount)
                : t.downloads.sectionHint}
          </span>
        </span>
        <ChevronDown size={18} aria-hidden className={`shrink-0 text-mist transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-2 pb-3">
          {list.status === 'loading' && (
            <p className="flex items-center gap-2 px-2 py-3 text-xs text-mist">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              {t.downloads.loading}
            </p>
          )}
          {list.status === 'error' && (
            <div className="flex items-center justify-between gap-3 px-2 py-3 text-xs text-mist">
              {t.downloads.loadError}
              <button type="button" onClick={load} className="rounded-full bg-cream/10 px-3 py-1.5 text-cream">
                {t.downloads.retryList}
              </button>
            </div>
          )}
          {list.status === 'ready' && order.length === 0 && <p className="px-2 py-3 text-xs text-mist">{t.downloads.empty}</p>}

          {list.status === 'ready' && order.length > 0 && (
            <>
              {/* Par lot : les N prochains chapitres non lus. */}
              <div className="mb-2 flex items-center gap-2 px-2">
                <div role="radiogroup" className="flex shrink-0 rounded-full bg-black/25 p-0.5">
                  {BATCH_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      role="radio"
                      aria-checked={batch === size}
                      onClick={() => setBatch(size)}
                      className={`min-w-8 rounded-full px-2 py-1 text-xs tabular-nums transition-colors ${batch === size ? 'bg-cream text-void' : 'text-cream/60'}`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={next.length === 0}
                  onClick={() => {
                    vibrate(12)
                    for (const chapter of next) downloadChapter(book, chapter, language)
                  }}
                  className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-glow/20 px-3 py-2 text-xs font-medium text-cream transition-colors hover:bg-glow/30 disabled:opacity-45"
                >
                  <Download size={13} aria-hidden className="shrink-0" />
                  <span className="truncate">{next.length === 0 ? t.downloads.nothingNext : t.downloads.nextUnread(next.length)}</span>
                </button>
              </div>

              {readCount > 0 && (
                <button type="button" onClick={() => setShowRead((value) => !value)} className="px-2 py-1.5 text-[11px] text-glow">
                  {showRead ? t.downloads.hideRead : t.downloads.showRead(readCount)}
                </button>
              )}

              <ul className="max-h-[22rem] overflow-y-auto overscroll-contain">
                {visible.map((chapter) => (
                  <li
                    key={chapter.id}
                    className="flex items-center gap-2 rounded-xl px-2 py-1.5"
                    style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 48px' }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${isRead(chapter) ? 'text-cream/45' : 'text-cream/90'}`}>{labelOf(chapter)}</span>
                      {chapter.number && chapter.title && <span className="block truncate text-[11px] text-mist">{chapter.title}</span>}
                    </span>
                    <DownloadButton book={book} chapter={chapter} language={language} label={labelOf(chapter)} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}
