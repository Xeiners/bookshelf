import { useEffect, useMemo, useRef, useState } from 'react'
import { CloudOff } from 'lucide-react'
import { useReaderChrome } from '../../hooks/reader/useReaderUi'
import { useT } from '../../i18n'
import {
  cacheBook,
  cloudLocationsKey,
  getCachedBlob,
  getCachedBook,
  saveCachedBlob,
  saveCachedPosition,
} from '../../lib/reader/cloudBooks'
import { reportProgress } from '../../lib/novelLibrary'
import { ProgressSync, newestPosition, percentFrom, serverPosition } from '../../lib/reader/cloudSync'
import { ApiError, isNetworkError } from '../../services/api'
import { booksApi } from '../../services/booksApi'
import { useAuthStore } from '../../store/useAuthStore'
import type { CloudBook, CloudPosition } from '../../types/novel'
import { EpubReader, type EpubSource } from './EpubReader'
import { ReaderMessage } from './ReaderMessage'

type Failure = 'signin' | 'missing' | 'offline' | 'error'

interface Opened {
  book: CloudBook
  blob: Blob
  start: CloudPosition | null
  offline: boolean
}

/**
 * Roman du compte : fiche et position lues sur l'API (repli sur la copie de
 * l'appareil hors-ligne), fichier lu dans IndexedDB ou téléchargé une fois
 * pour toutes. Reprise à la position la plus récente, qu'elle vienne de ce
 * téléphone ou de l'ordinateur ; chaque page tournée est gardée sur
 * l'appareil puis envoyée à l'API (cf. `ProgressSync`).
 */
export function CloudReader({ bookId }: { bookId: string }) {
  const t = useT()
  const ui = useReaderChrome()
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [failure, setFailure] = useState<Failure | null>(userId ? null : 'signin')
  const [download, setDownload] = useState<number | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    let cancelled = false

    const load = async (): Promise<Opened> => {
      const cached = await getCachedBook(userId, bookId).catch(() => undefined)
      let book = cached?.book ?? null
      let offline = false
      try {
        book = await booksApi.get(bookId, controller.signal)
        await cacheBook(userId, book).catch(() => {})
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) throw new Error('missing')
        if (!isNetworkError(error)) throw error
        offline = true
      }
      if (!book) throw new Error('offline')

      let blob = cached?.downloaded ? await getCachedBlob(bookId).catch(() => undefined) : undefined
      if (!blob) {
        if (offline) throw new Error('offline')
        setDownload(0)
        blob = await booksApi.download(bookId, book.fileSize, (ratio) => setDownload(ratio), controller.signal)
        // Stockage plein : on lit quand même, depuis la mémoire.
        await saveCachedBlob(bookId, blob).catch(() => {})
      }
      return { book, blob, offline, start: newestPosition(cached?.position ?? null, serverPosition(book)) }
    }

    load()
      .then((result) => {
        if (!cancelled) setOpened(result)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const reason = error instanceof Error ? error.message : ''
        setFailure(reason === 'missing' || reason === 'offline' ? reason : 'error')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [bookId, userId, tick])

  if (failure) {
    const messages: Record<Failure, string> = {
      signin: t.novels.reader.signin,
      missing: t.novels.reader.missing,
      offline: t.novels.reader.notDownloaded,
      error: t.reader.errorFile,
    }
    const retry = failure === 'offline' || failure === 'error'
    return (
      <div className="fixed inset-0 z-[100] bg-black text-cream">
        <ReaderMessage
          message={messages[failure]}
          onRetry={retry ? () => {
            setFailure(null)
            setTick((value) => value + 1)
          } : undefined}
          onClose={ui.close}
        />
      </div>
    )
  }

  if (!opened) {
    const message = download === null ? t.reader.opening : t.novels.reader.downloading(Math.round(download * 100))
    return (
      <div className="fixed inset-0 z-[100] bg-black text-cream">
        <ReaderMessage message={message} busy />
      </div>
    )
  }

  return <SyncedEpub key={opened.book.id} opened={opened} />
}

function SyncedEpub({ opened }: { opened: Opened }) {
  const t = useT()
  const { book, blob, start, offline } = opened
  const [online, setOnline] = useState(() => !offline && navigator.onLine)
  const lastPercent = useRef(start?.percent ?? 0)
  // Position d'ouverture : rouvrir un livre n'est pas « lire ». Tant qu'on n'a
  // pas tourné de page, rien n'est envoyé — sinon, ouvrir le livre sur
  // l'ordinateur périmerait la page lue hors-ligne sur le téléphone.
  const openingCfi = useRef<string | null>(null)

  const sync = useMemo(
    () =>
      new ProgressSync({
        persist: (position, pending) => saveCachedPosition(book.id, position, pending),
        send: async (position, options) => {
          const result = await booksApi.progress(book.id, position, options)
          setOnline(true)
          return result
        },
      }),
    [book.id],
  )

  useEffect(() => {
    // Application en arrière-plan (un téléphone peut la fermer sans prévenir) : envoi immédiat.
    const onHide = () => {
      if (document.visibilityState === 'hidden') void sync.flush({ keepalive: true })
    }
    const onOnline = () => {
      setOnline(true)
      void sync.flush()
    }
    const onOffline = () => setOnline(false)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      void sync.flush({ keepalive: true })
      sync.dispose()
    }
  }, [sync])

  const source: EpubSource = {
    title: book.title,
    load: async () => blob,
    initialCfi: start?.cfi ?? null,
    locationsKey: cloudLocationsKey(book.id),
    onPosition: ({ cfi, ratio }) => {
      const percent = percentFrom(ratio, lastPercent.current)
      lastPercent.current = percent
      if (openingCfi.current === null) {
        openingCfi.current = cfi
        return
      }
      if (cfi === openingCfi.current && !sync.position) return
      sync.push({ cfi, percent, at: Date.now() })
      // La fiche rattachée suit : « En cours », puis « Lus » à la fin (et le profil avec elle).
      reportProgress(book.workId, percent)
    },
    notice: online ? null : (
      <span className="inline-flex items-center gap-1">
        <CloudOff size={11} aria-hidden />
        {t.novels.reader.offline}
      </span>
    ),
  }

  return <EpubReader source={source} />
}
