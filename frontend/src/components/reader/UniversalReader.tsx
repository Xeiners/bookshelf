import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { ReaderUiContext, useReaderChrome, useReaderUi } from '../../hooks/reader/useReaderUi'
import { useT } from '../../i18n'
import { getFile, markOpened, type LocalFile } from '../../lib/reader/localFiles'
import type { ReaderSession } from '../../types/reader'
import { ArchiveReader } from './ArchiveReader'
import { MangaReader } from './MangaReader'
import { ReaderMessage } from './ReaderMessage'

// epub.js et pdf.js pèsent lourd : chargés seulement à l'ouverture d'un tel fichier.
const EpubReader = lazy(() => import('./EpubReader').then((module) => ({ default: module.EpubReader })))
const PdfReader = lazy(() => import('./PdfReader').then((module) => ({ default: module.PdfReader })))

/**
 * Lecteur universel, plein écran, par-dessus toute l'application. Il choisit
 * le moteur selon le contenu :
 *  - images (MangaDex, CBZ)  → `MangaReader` / `ArchiveReader` (webtoon ou pages) ;
 *  - texte refondable (EPUB) → `EpubReader` ;
 *  - document (PDF)          → `PdfReader`.
 */
export function UniversalReader({ session }: { session: ReaderSession }) {
  const ui = useReaderUi()
  return (
    <ReaderUiContext value={ui}>
      {session.source === 'mangadex' ? (
        <MangaReader key={session.book.id} book={session.book} chapterId={session.chapterId} />
      ) : (
        <LocalReader key={session.fileId} fileId={session.fileId} />
      )}
    </ReaderUiContext>
  )
}

function LocalReader({ fileId }: { fileId: string }) {
  const t = useT()
  const ui = useReaderChrome()
  const [file, setFile] = useState<LocalFile | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    getFile(fileId)
      .then((found) => {
        if (cancelled) return
        setFile(found ?? null)
        if (found) void markOpened(fileId).catch(() => {})
      })
      .catch(() => {
        if (!cancelled) setFile(null)
      })
    return () => {
      cancelled = true
    }
  }, [fileId])

  if (file === undefined) return <FullScreen><ReaderMessage message={t.reader.opening} busy /></FullScreen>
  if (file === null) return <FullScreen><ReaderMessage message={t.reader.files.missing} onClose={ui.close} /></FullScreen>

  const fallback = <FullScreen><ReaderMessage message={t.reader.opening} busy /></FullScreen>
  switch (file.format) {
    case 'cbz':
      return <ArchiveReader file={file} />
    case 'epub':
      return <Suspense fallback={fallback}><EpubReader file={file} /></Suspense>
    case 'pdf':
      return <Suspense fallback={fallback}><PdfReader file={file} /></Suspense>
  }
}

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="fixed inset-0 z-[100] bg-black text-cream">{children}</div>
}
