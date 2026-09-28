import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CloudOff, HardDriveDownload, Info, LoaderCircle, Trash2, X } from 'lucide-react'
import { useNovels } from '../../hooks/useNovels'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { novelAsBook } from '../../lib/novels'
import type { CachedCloudBook } from '../../lib/reader/cloudBooks'
import { displayPercent, useNovelStore, type UploadItem } from '../../store/useNovelStore'
import { useUiStore } from '../../store/useUiStore'
import { BookCover } from '../ui/BookCover'
import { EpubDropZone } from './EpubDropZone'
import { NovelDetails } from './NovelDetails'

/** Taille lisible, jamais « 0 Mo ». */
const megabytes = (bytes: number, locale: string) => Math.max(0.1, bytes / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })

/**
 * « Mes romans » : EPUB du compte, stockés sur le serveur et lus sur tous les
 * appareils. Import (glisser-déposer ou sélecteur), avancement de chaque
 * roman, présence hors-ligne, fiche détaillée, suppression.
 */
export function NovelsSheet() {
  const t = useT()
  const closeNovels = useUiStore((state) => state.closeNovels)
  const { signedIn, userId, books, offline, uploads, importFiles } = useNovels()
  const [selected, setSelected] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const closing = useRef(false)

  const { contextSafe } = useGSAP(
    () => {
      gsap
        .timeline({ defaults: { ease: EASE.glide } })
        .fromTo('[data-novels-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 }, 0)
        .fromTo('[data-novels-sheet]', { yPercent: 100 }, { yPercent: 0, duration: 0.6 }, 0)
    },
    { scope: rootRef },
  )

  const dismiss = () =>
    contextSafe(() => {
      if (closing.current) return
      closing.current = true
      gsap
        .timeline({ onComplete: closeNovels })
        .to('[data-novels-sheet]', { yPercent: 100, duration: 0.35, ease: EASE.exit }, 0)
        .to('[data-novels-backdrop]', { autoAlpha: 0, duration: 0.3 }, 0)
    })()

  // Échap : ferme d'abord la fiche ouverte, puis la feuille.
  const escapeRef = useRef(() => {})
  useEffect(() => {
    escapeRef.current = () => (selected ? setSelected(null) : dismiss())
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escapeRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const selectedEntry = selected ? books?.find((entry) => entry.id === selected) : undefined

  return (
    <div ref={rootRef} className="fixed inset-0 z-[90]" role="dialog" aria-modal aria-label={t.novels.title}>
      <div data-novels-backdrop onClick={() => dismiss()} className="absolute inset-0 bg-void/90 opacity-0" />
      <div
        data-novels-sheet
        className="glass-strong absolute inset-x-0 bottom-0 mx-auto flex max-h-[88svh] flex-col rounded-t-[2.25rem] pb-safe will-change-transform md:bottom-6 md:max-w-xl md:rounded-[2.25rem]"
      >
        <div className="flex shrink-0 items-start gap-3 px-6 pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1.75rem] leading-none text-cream">{t.novels.title}</h2>
            <p className="mt-2 text-xs text-mist">{t.novels.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => dismiss()}
            aria-label={t.common.close}
            className="glass grid size-9 shrink-0 place-items-center rounded-full text-cream/60"
          >
            <X size={16} />
          </button>
        </div>

        {!signedIn || !userId ? (
          <GuestInvite />
        ) : selectedEntry ? (
          <NovelDetails userId={userId} entry={selectedEntry} onBack={() => setSelected(null)} />
        ) : (
          <>
            <div className="shrink-0 space-y-3 px-6 pt-5">
              <EpubDropZone onFiles={(files) => importFiles(files)} />
              {uploads.map((upload) => (
                <UploadRow key={upload.id} upload={upload} />
              ))}
              {offline && (
                <p className="flex items-center gap-2 text-xs text-gold">
                  <CloudOff size={13} aria-hidden />
                  {t.novels.offlineList}
                </p>
              )}
            </div>

            <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
              {books === null && (
                <div className="grid place-items-center py-10 text-mist">
                  <LoaderCircle size={20} className="animate-spin" aria-hidden />
                </div>
              )}
              {books?.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <p className="font-display text-xl text-cream">{t.novels.empty}</p>
                  <p className="mx-auto mt-2 max-w-xs text-sm text-mist">{t.novels.emptyBody}</p>
                </div>
              )}
              <ul className="space-y-1">
                {(books ?? []).map((entry) => (
                  <NovelRow key={entry.id} userId={userId} entry={entry} onDetails={() => setSelected(entry.id)} />
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function GuestInvite() {
  const t = useT()
  return (
    <div className="px-6 pt-6 pb-6">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <p className="font-display text-xl text-cream">{t.novels.guest.title}</p>
        <p className="mt-2 text-sm text-mist">{t.novels.guest.body}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => useUiStore.getState().openAuth()}
            className="rounded-full bg-cream px-5 py-2.5 text-xs font-semibold text-void"
          >
            {t.novels.guest.cta}
          </button>
          <button
            type="button"
            onClick={() => {
              const ui = useUiStore.getState()
              ui.closeNovels()
              ui.openFiles()
            }}
            className="text-xs text-cream/70 underline-offset-4 hover:underline"
          >
            {t.novels.guest.local}
          </button>
        </div>
      </div>
    </div>
  )
}

function UploadRow({ upload }: { upload: UploadItem }) {
  const t = useT()
  const failed = upload.status === 'error'
  return (
    <div role={failed ? 'alert' : 'status'} className="rounded-2xl bg-white/[0.04] px-4 py-3">
      <div className="flex items-center gap-2 text-xs">
        {failed ? <AlertCircle size={14} className="shrink-0 text-nope" aria-hidden /> : <LoaderCircle size={14} className="shrink-0 animate-spin text-gold" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-cream">{upload.name}</span>
        {failed ? (
          <button type="button" onClick={() => useNovelStore.getState().dismissUpload(upload.id)} aria-label={t.novels.dismiss} className="text-cream/50 hover:text-cream">
            <X size={14} />
          </button>
        ) : (
          <span className="shrink-0 text-mist tabular-nums">
            {upload.status === 'processing' ? t.novels.processing : t.novels.uploading(Math.round(upload.progress * 100))}
          </span>
        )}
      </div>
      {failed ? (
        <p className="mt-1.5 text-xs text-nope">{t.novels.errors[upload.error ?? 'unknown']}</p>
      ) : (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-full origin-left rounded-full bg-gold transition-transform" style={{ transform: `scaleX(${upload.progress})` }} />
        </div>
      )}
    </div>
  )
}

function NovelRow({ userId, entry, onDetails }: { userId: string; entry: CachedCloudBook; onDetails: () => void }) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const { book } = entry
  const percent = displayPercent(entry)

  const remove = async () => {
    if (!confirming) {
      vibrate(8)
      setConfirming(true)
      return
    }
    setBusy(true)
    try {
      await useNovelStore.getState().remove(userId, entry.id)
      useUiStore.getState().notify(t.novels.removed, 'nope')
    } catch {
      useUiStore.getState().notify(t.novels.removeFailed, 'nope')
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <li className="flex items-center gap-1 rounded-2xl hover:bg-white/[0.04]">
      <button
        type="button"
        onClick={() => useUiStore.getState().openReader({ source: 'cloud', bookId: entry.id })}
        aria-label={t.novels.read(book.title)}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="relative block h-16 w-11 shrink-0 overflow-hidden rounded-md bg-carbon shadow-lift">
          <BookCover book={novelAsBook(book)} className="h-full w-full" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-cream">{book.title}</span>
          {book.author && <span className="block truncate text-xs text-cream/60">{book.author}</span>}
          <span className="mt-1 flex items-center gap-2 text-[11px] text-mist">
            <span>{percent > 0 ? t.novels.progress(Math.round(percent)) : t.novels.fresh}</span>
            <span aria-hidden>·</span>
            <span>{t.novels.size(megabytes(book.fileSize, t.locale))}</span>
            {entry.downloaded && (
              <span title={t.novels.onDeviceHint} className="inline-flex items-center gap-1 text-like">
                <HardDriveDownload size={11} aria-hidden />
                <span className="sr-only">{t.novels.onDevice}</span>
              </span>
            )}
          </span>
          {percent > 0 && (
            <span className="mt-1.5 block h-0.5 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full w-full origin-left bg-gold" style={{ transform: `scaleX(${percent / 100})` }} />
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={onDetails}
        aria-label={t.novels.details(book.title)}
        className="grid size-10 shrink-0 place-items-center rounded-full text-cream/50 hover:text-cream"
      >
        <Info size={16} />
      </button>
      {confirming ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          onBlur={() => !busy && setConfirming(false)}
          aria-label={t.novels.remove(book.title)}
          className="mr-1 flex h-9 shrink-0 items-center gap-1 rounded-full bg-nope/15 px-3 text-[11px] font-semibold text-nope"
        >
          {busy ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : <Trash2 size={13} aria-hidden />}
          {t.novels.confirmRemove}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void remove()}
          aria-label={t.novels.remove(book.title)}
          className="grid size-10 shrink-0 place-items-center rounded-full text-cream/40 hover:text-nope"
        >
          <Trash2 size={15} />
        </button>
      )}
    </li>
  )
}
