import { useEffect, useState } from 'react'
import { Check, Download, RotateCcw, Trash2, X } from 'lucide-react'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { cancelDownload, downloadChapter, removeDownload } from '../../lib/reader/downloads'
import { useDownloadStore } from '../../store/useDownloadStore'
import type { Book } from '../../types/book'
import type { ChapterLanguage, ReaderChapter } from '../../types/reader'

interface DownloadButtonProps {
  book: Book
  chapter: ReaderChapter
  language: ChapterLanguage
  /** Nom du chapitre, pour les lecteurs d'écran (« Chapitre 12 »). */
  label: string
}

/** Délai pour confirmer une suppression (second toucher). */
const CONFIRM_MS = 2600
const RING = 2 * Math.PI * 14

/**
 * Télécharger un chapitre pour le lire hors-ligne. Pas téléchargé → flèche ; en file ou en
 * cours → anneau de progression (toucher : annuler) ; téléchargé → coche verte (deux
 * touchers : supprimer) ; en erreur → réessayer, il reprend là où il s'était arrêté.
 */
export function DownloadButton({ book, chapter, language, label }: DownloadButtonProps) {
  const t = useT()
  const entry = useDownloadStore((state) => state.chapters[chapter.id])
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const timer = window.setTimeout(() => setConfirming(false), CONFIRM_MS)
    return () => window.clearTimeout(timer)
  }, [confirming])

  const base = 'relative grid size-9 shrink-0 place-items-center rounded-full transition-colors' // i18n-ignore

  if (!entry) {
    return (
      <button
        type="button"
        onClick={() => {
          vibrate(8)
          downloadChapter(book, chapter, language)
        }}
        aria-label={t.downloads.download(label)}
        title={t.downloads.download(label)}
        className={`${base} text-cream/55 hover:bg-white/[0.08] hover:text-cream`}
      >
        <Download size={17} aria-hidden />
      </button>
    )
  }

  if (entry.status === 'queued' || entry.status === 'downloading') {
    const total = Math.max(1, entry.pages.length)
    const ratio = entry.status === 'queued' || entry.pages.length === 0 ? 0 : entry.done / total
    return (
      <button
        type="button"
        onClick={() => void cancelDownload(chapter.id)}
        aria-label={t.downloads.cancel(label)}
        title={entry.status === 'queued' ? t.downloads.queued : t.downloads.progress(Math.round(ratio * 100))}
        className={`${base} group text-glow hover:bg-white/[0.08]`}
      >
        <svg viewBox="0 0 32 32" aria-hidden className={`absolute inset-0 size-9 -rotate-90 ${entry.status === 'queued' ? 'animate-spin [animation-duration:2.4s]' : ''}`}>
          <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={RING}
            strokeDashoffset={entry.status === 'queued' ? RING * 0.78 : RING * (1 - ratio)}
            className="transition-[stroke-dashoffset] duration-300"
          />
        </svg>
        {entry.status === 'queued' ? (
          <X size={13} aria-hidden />
        ) : (
          <>
            <span className="text-[9px] font-semibold tabular-nums group-hover:hidden">{Math.round(ratio * 100)}</span>
            <X size={13} aria-hidden className="hidden group-hover:block" />
          </>
        )}
      </button>
    )
  }

  if (entry.status === 'error') {
    const reason = t.downloads.errors[entry.error ?? 'network']
    return (
      <button
        type="button"
        onClick={() => downloadChapter(book, chapter, language)}
        aria-label={`${t.downloads.retry(label)} — ${reason}`}
        title={reason}
        className={`${base} text-gold hover:bg-white/[0.08]`}
      >
        <RotateCcw size={16} aria-hidden />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (!confirming) {
          setConfirming(true)
          return
        }
        vibrate(10)
        void removeDownload(chapter.id)
      }}
      aria-label={confirming ? t.downloads.confirmRemove(label) : t.downloads.downloaded(label)}
      title={confirming ? t.downloads.confirmRemove(label) : t.downloads.downloaded(label)}
      className={`${base} ${confirming ? 'bg-nope/15 text-nope' : 'text-like'}`}
    >
      {confirming ? (
        <Trash2 size={16} aria-hidden />
      ) : (
        <span className="grid size-6 place-items-center rounded-full bg-like/15">
          <Check size={14} strokeWidth={3} aria-hidden />
        </span>
      )}
    </button>
  )
}
