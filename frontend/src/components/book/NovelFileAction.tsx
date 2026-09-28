import { useRef, useState } from 'react'
import { BookOpenText, LoaderCircle, Paperclip } from 'lucide-react'
import { useLinkedNovel, useNovels } from '../../hooks/useNovels'
import { useLanguage, useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { acceptsEpub } from '../../lib/novelLibrary'
import { displayPercent, useNovelStore, type UploadError } from '../../store/useNovelStore'
import { useUiStore } from '../../store/useUiStore'
import type { Book } from '../../types/book'
import { Pressable } from '../ui/Pressable'

/**
 * Fichier EPUB d'une fiche de roman, dans la fiche détaillée : « Lire » s'il
 * est sur le compte (reprise à la dernière position), sinon « Associer un
 * fichier EPUB » (le fichier rejoint cette fiche d'office). Rien pour une
 * œuvre qui n'est pas un roman.
 */
export function NovelFileAction({ book }: { book: Book }) {
  const t = useT()
  const copy = t.novels.epub
  const language = useLanguage()
  const { userId } = useNovels()
  const linked = useLinkedNovel(book.id)
  const openReader = useUiStore((state) => state.openReader)
  const openAuth = useUiStore((state) => state.openAuth)
  const notify = useUiStore((state) => state.notify)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UploadError | null>(null)

  if (linked) {
    const percent = Math.round(displayPercent(linked))
    return (
      <Pressable
        onClick={() => {
          vibrate(10)
          openReader({ source: 'cloud', bookId: linked.id })
        }}
        className="mb-2 flex w-full items-center justify-center gap-2 rounded-full bg-gold py-3 text-sm font-medium text-void"
      >
        <BookOpenText size={16} />
        {percent > 0 ? copy.resume(percent) : copy.read}
      </Pressable>
    )
  }

  if (!acceptsEpub(book)) return null

  if (!userId) {
    return (
      <button
        type="button"
        onClick={openAuth}
        className="glass mb-2 flex w-full items-center justify-center gap-2 rounded-full py-3 text-xs text-cream/80"
      >
        <Paperclip size={14} />
        {copy.signIn}
      </button>
    )
  }

  const attach = async (file: File) => {
    setBusy(true)
    setError(null)
    const [outcome] = await useNovelStore.getState().upload(userId, [file], language, { workId: book.id, record: book })
    setBusy(false)
    if (outcome?.error) {
      setError(outcome.error)
      return
    }
    vibrate(12)
    notify(copy.attached(book.title), 'like')
  }

  return (
    <div className="mb-2">
      <input
        ref={inputRef}
        type="file"
        accept=".epub,application/epub+zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void attach(file)
        }}
      />
      <Pressable
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="glass flex w-full items-center justify-center gap-2 rounded-full py-3 text-xs font-medium text-cream/85 disabled:opacity-60"
      >
        {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Paperclip size={14} />}
        {busy ? copy.attaching : copy.attach}
      </Pressable>
      {error ? (
        <p role="alert" className="mt-1.5 text-center text-[11px] text-nope">
          {t.novels.errors[error]}
        </p>
      ) : (
        <p className="mt-1.5 text-center text-[10px] leading-snug text-mist">{copy.attachHint}</p>
      )}
    </div>
  )
}
