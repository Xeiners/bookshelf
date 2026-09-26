import { useEffect, useState } from 'react'
import { useLocalPosition } from '../../hooks/reader/useLocalPosition'
import { useT } from '../../i18n'
import { openArchive } from '../../lib/reader/archive'
import { getFileBlob, type LocalFile } from '../../lib/reader/localFiles'
import type { ReaderPage } from '../../types/reader'
import { ImageReader } from './ImageReader'

type Load = { status: 'loading' } | { status: 'ready'; pages: ReaderPage[] } | { status: 'error' }

/** BD / comics / scans importés en CBZ : même moteur d'images que MangaDex. */
export function ArchiveReader({ file }: { file: LocalFile }) {
  const t = useT()
  const [state, setState] = useState<Load>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const [opening] = useState(file.position)
  const save = useLocalPosition(file.id)

  useEffect(() => {
    let cancelled = false
    let release: (() => void) | undefined
    getFileBlob(file.id)
      .then((blob) => {
        if (!blob) throw new Error('missing')
        return openArchive(blob)
      })
      .then((archive) => {
        if (cancelled) {
          archive.release()
          return
        }
        release = archive.release
        setState(archive.pages.length > 0 ? { status: 'ready', pages: archive.pages } : { status: 'error' })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
      // Les images décompressées occupent la mémoire tant que leurs URL `blob:` vivent.
      release?.()
    }
  }, [file.id, tick])

  return (
    <ImageReader
      workId={`local:${file.id}`}
      title={file.title}
      chapterLabel={null}
      contentKey={file.id}
      pages={state.status === 'ready' ? state.pages : null}
      status={state.status}
      errorMessage={t.reader.errorFile}
      onRetry={() => {
        setState({ status: 'loading' })
        setTick((value) => value + 1)
      }}
      start={{ page: opening?.page ?? 0, offset: opening?.offset ?? 0 }}
      onPosition={({ page, offset, ratio }) => save({ page, offset, ratio })}
      onChapterEnd={() => undefined}
    />
  )
}
