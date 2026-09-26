import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { BookText, FileText, FileUp, Images, LoaderCircle, Trash2, X } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { importFile, listFiles, removeFile, UnsupportedFileError, type LocalFile } from '../../lib/reader/localFiles'
import { useUiStore } from '../../store/useUiStore'
import type { LocalFormat } from '../../types/reader'
import { Pressable } from '../ui/Pressable'

const ICONS: Record<LocalFormat, typeof FileText> = { pdf: FileText, epub: BookText, cbz: Images }
/** Libellés de format : des sigles, identiques dans toutes les langues. */
const FORMAT_LABEL: Record<LocalFormat, string> = { pdf: 'PDF', epub: 'EPUB', cbz: 'CBZ' }
const ACCEPT = '.pdf,.epub,.cbz,.cbr,application/pdf,application/epub+zip'

/**
 * « Mes fichiers » : PDF, EPUB et CBZ importés, gardés sur l'appareil
 * (IndexedDB) et lus avec le lecteur universel, même hors-ligne.
 */
export function LocalFilesSheet() {
  const t = useT()
  const closeFiles = useUiStore((state) => state.closeFiles)
  const openReader = useUiStore((state) => state.openReader)
  const notify = useUiStore((state) => state.notify)
  const [files, setFiles] = useState<LocalFile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const closing = useRef(false)

  const refresh = () =>
    listFiles()
      .then(setFiles)
      .catch(() => setFiles([]))

  useEffect(() => {
    void refresh()
  }, [])

  const { contextSafe } = useGSAP(
    () => {
      gsap
        .timeline({ defaults: { ease: EASE.glide } })
        .fromTo('[data-files-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 }, 0)
        .fromTo('[data-files-sheet]', { yPercent: 100 }, { yPercent: 0, duration: 0.6 }, 0)
    },
    { scope: rootRef },
  )

  const dismiss = () =>
    contextSafe(() => {
      if (closing.current) return
      closing.current = true
      gsap
        .timeline({ onComplete: closeFiles })
        .to('[data-files-sheet]', { yPercent: 100, duration: 0.35, ease: EASE.exit }, 0)
        .to('[data-files-backdrop]', { autoAlpha: 0, duration: 0.3 }, 0)
    })()

  const dismissRef = useRef(dismiss)
  useEffect(() => {
    dismissRef.current = dismiss
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    event.target.value = ''
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      const record = await importFile(picked)
      vibrate(10)
      notify(t.reader.files.imported(record.title), 'like')
      await refresh()
    } catch (reason) {
      setError(t.reader.files.errors[reason instanceof UnsupportedFileError ? reason.reason : 'storage'])
    } finally {
      setBusy(false)
    }
  }

  const remove = async (file: LocalFile) => {
    vibrate(12)
    await removeFile(file.id).catch(() => {})
    notify(t.reader.files.removed, 'nope')
    await refresh()
  }

  return (
    <div ref={rootRef} className="fixed inset-0 z-[90]" role="dialog" aria-modal aria-label={t.reader.files.title}>
      <div data-files-backdrop onClick={() => dismissRef.current()} className="absolute inset-0 bg-void/90 opacity-0" />
      <div
        data-files-sheet
        className="glass-strong absolute inset-x-0 bottom-0 mx-auto flex max-h-[85svh] flex-col rounded-t-[2.25rem] pb-safe will-change-transform md:bottom-6 md:max-w-xl md:rounded-[2.25rem]"
      >
        <div className="flex shrink-0 items-start gap-3 px-6 pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1.75rem] leading-none text-cream">{t.reader.files.title}</h2>
            <p className="mt-2 text-xs text-mist">{t.reader.files.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => dismissRef.current()}
            aria-label={t.common.close}
            className="glass grid size-9 shrink-0 place-items-center rounded-full text-cream/60"
          >
            <X size={16} />
          </button>
        </div>

        <div className="shrink-0 px-6 pt-5">
          <input ref={inputRef} type="file" accept={ACCEPT} onChange={(event) => void onPick(event)} className="hidden" />
          <Pressable
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-cream py-3 text-sm font-medium text-void disabled:opacity-60"
          >
            {busy ? <LoaderCircle size={16} /> : <FileUp size={16} />}
            {busy ? t.reader.files.importing : t.reader.files.import}
          </Pressable>
          {error && (
            <p role="alert" className="mt-3 text-center text-xs text-nope">
              {error}
            </p>
          )}
        </div>

        <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {files !== null && files.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="font-display text-xl text-cream">{t.reader.files.empty}</p>
              <p className="mx-auto mt-2 max-w-xs text-sm text-mist">{t.reader.files.emptyBody}</p>
            </div>
          )}
          <ul className="space-y-1">
            {(files ?? []).map((file) => {
              const Icon = ICONS[file.format]
              const percent = file.position ? Math.round(file.position.ratio * 100) : null
              // Jamais « 0 Mo » : un petit fichier affiche au moins 0,1.
              const size = Math.max(0.1, file.size / (1024 * 1024)).toLocaleString(t.locale, { maximumFractionDigits: 1 })
              return (
                <li key={file.id} className="flex items-center gap-2 rounded-2xl hover:bg-white/[0.04]">
                  <button
                    type="button"
                    onClick={() => openReader({ source: 'local', fileId: file.id })}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left"
                  >
                    <span className="glass grid size-10 shrink-0 place-items-center rounded-xl text-gold">
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-cream">{file.title}</span>
                      <span className="block truncate text-[11px] text-mist">
                        {FORMAT_LABEL[file.format]} · {t.reader.files.size(size)} ·{' '}
                        {percent !== null ? t.reader.files.progress(percent) : t.reader.files.fresh}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(file)}
                    aria-label={t.reader.files.remove(file.title)}
                    className="grid size-10 shrink-0 place-items-center rounded-full text-cream/40 hover:text-nope"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
