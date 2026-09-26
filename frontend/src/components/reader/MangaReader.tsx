import { useEffect, useMemo, useRef, useState } from 'react'
import { useReaderChrome } from '../../hooks/reader/useReaderUi'
import { useLanguage, useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { neighbours, readingOrder } from '../../lib/reader/navigation'
import { chapterNumber, COMPLETION_THRESHOLD, initialChapterId } from '../../lib/reader/progress'
import { resolveQuality } from '../../lib/reader/quality'
import { readerApi } from '../../services/readerApi'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useReaderStore } from '../../store/useReaderStore'
import type { Book } from '../../types/book'
import type { ChapterLanguage, ChapterList, ReaderChapter, ReaderPage, ReadingPosition, ViewPosition } from '../../types/reader'
import type { DrawerItem } from './ChapterDrawer'
import { ImageReader } from './ImageReader'
import { ReaderMessage } from './ReaderMessage'
import { Choice, SettingGroup } from './ReaderSettings'

/** Une position n'est écrite qu'une fois la page posée : pas de rafale pendant un défilement. */
const SAVE_DELAY_MS = 900
/** À partir de cet avancement, le chapitre suivant est préparé (pages + premières images). */
const PREPARE_NEXT_AT = 0.6

type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error' }

interface MangaReaderProps {
  book: Book
  /** Chapitre demandé explicitement (sinon : reprise de la dernière position). */
  chapterId?: string
}

/**
 * Lecteur MangaDex : liste des chapitres, pages via MangaDex At-Home (relayées
 * par l'API), et suivi automatique de la progression dans la bibliothèque —
 * position au pixel près, compteur de chapitres lus en fin de chapitre.
 */
export function MangaReader({ book, chapterId: requested }: MangaReaderProps) {
  const t = useT()
  const interfaceLanguage = useLanguage()
  const preferredLanguage = useReaderStore((state) => state.chapterLanguage)
  const setChapterLanguage = useReaderStore((state) => state.setChapterLanguage)
  const qualityPreference = useReaderStore((state) => state.quality)
  const setQuality = useReaderStore((state) => state.setQuality)
  const recordReading = useLibraryStore((state) => state.recordReading)
  const chaptersRead = useLibraryStore((state) => state.entries[book.id]?.chaptersRead ?? 0)

  // Position à l'ouverture seulement : la suite de la lecture ne doit pas la déplacer.
  const [opening] = useState(() => useLibraryStore.getState().entries[book.id]?.position ?? null)
  const language: ChapterLanguage = preferredLanguage ?? interfaceLanguage

  const [listTick, setListTick] = useState(0)
  const listKey = `${book.id}:${language}:${listTick}`
  const [loadedList, setList] = useState<Load<ChapterList> & { key: string }>({ status: 'loading', key: '' })
  // Autre langue, nouvel essai : on est en chargement tant que la réponse ne correspond pas.
  const list: Load<ChapterList> = loadedList.key === listKey ? loadedList : { status: 'loading' }
  /** Chapitres de la réponse précédente : retrouver le même numéro après un changement de langue. */
  const lastChapters = useRef<ReaderChapter[]>([])
  const [chapterId, setChapterId] = useState<string | null>(requested ?? null)
  const [startAtEnd, setStartAtEnd] = useState(false)
  const chapterRef = useRef<string | null>(chapterId)
  useEffect(() => {
    chapterRef.current = chapterId
  })

  /* ---- Liste des chapitres ------------------------------------------------ */

  useEffect(() => {
    const controller = new AbortController()
    readerApi
      .chapters(book.id, language, controller.signal)
      .then((data) => {
        setList({ status: 'ready', data, key: listKey })
        const before = lastChapters.current
        lastChapters.current = data.chapters
        // Chapitre encore valable dans cette langue ? Sinon, le même numéro, sinon la reprise.
        const currentId = chapterRef.current
        const all = data.chapters
        if (currentId && all.some((chapter) => chapter.id === currentId)) return
        const previous = currentId ? before.find((chapter) => chapter.id === currentId) : undefined
        const sameNumber = previous?.number ? all.find((chapter) => chapter.number === previous.number) : undefined
        setChapterId(sameNumber?.id ?? initialChapterId(readingOrder(all), opening, useLibraryStore.getState().entries[book.id]?.chaptersRead ?? 0))
      })
      .catch(() => {
        if (!controller.signal.aborted) setList({ status: 'error', key: listKey })
      })
    return () => controller.abort()
  }, [book.id, language, listKey, opening])

  const chapters = list.status === 'ready' ? list.data.chapters : EMPTY
  const current = useMemo(() => chapters.find((chapter) => chapter.id === chapterId), [chapters, chapterId])
  const order = useMemo(
    () => readingOrder(chapters, current?.groups.map((group) => group.id) ?? [], chapterId),
    [chapters, current, chapterId],
  )
  const { index, prev, next } = neighbours(order, chapterId)

  /* ---- Pages du chapitre ------------------------------------------------- */

  const quality = resolveQuality(qualityPreference)
  const [pages, setPages] = useState<Load<ReaderPage[]> & { key: string }>({ status: 'loading', key: '' })
  const [pagesTick, setPagesTick] = useState(0)
  const pagesKey = `${chapterId}:${quality}:${pagesTick}`

  useEffect(() => {
    if (!chapterId) return
    let cancelled = false
    readerApi
      .pages(chapterId, quality)
      .then((data) => {
        if (!cancelled) setPages({ status: 'ready', data, key: pagesKey })
      })
      .catch(() => {
        if (!cancelled) setPages({ status: 'error', key: pagesKey })
      })
    return () => {
      cancelled = true
    }
  }, [chapterId, quality, pagesKey])

  const pageState = pages.key === pagesKey ? pages : { status: 'loading' as const, key: pagesKey }

  /* ---- Chapitre suivant préparé en avance -------------------------------- */

  const [nextFirst, setNextFirst] = useState<string[]>([])
  const preparing = useRef<string | null>(null)
  const prepareNext = () => {
    if (!next || preparing.current === next.id) return
    preparing.current = next.id
    readerApi
      .pages(next.id, quality)
      .then((data) => setNextFirst(data.slice(0, 3).map((page) => page.url)))
      .catch(() => {
        preparing.current = null
      })
  }

  /* ---- Progression ------------------------------------------------------- */

  const pending = useRef<Omit<ReadingPosition, 'at'> | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const flush = () => {
    window.clearTimeout(timer.current)
    if (pending.current) recordReading(book, pending.current)
    pending.current = null
  }
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })
  // Quitter le lecteur, ou l'application en arrière-plan : la position part tout de suite.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushRef.current()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flushRef.current()
    }
  }, [])

  const onPosition = (position: ViewPosition & { pageCount: number }) => {
    if (!current) return
    pending.current = {
      chapterId: current.id,
      chapter: current.number,
      page: position.page,
      pageCount: position.pageCount,
      offset: Math.round(position.offset * 1000) / 1000,
      ratio: Math.round(position.ratio * 1000) / 1000,
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS)
    if (position.ratio >= PREPARE_NEXT_AT) prepareNext()
  }

  const onChapterEnd = () => {
    if (!current || pageState.status !== 'ready') return
    const pageCount = pageState.data.length
    window.clearTimeout(timer.current)
    pending.current = null
    recordReading(
      book,
      {
        chapterId: current.id,
        chapter: current.number,
        page: Math.max(0, pageCount - 1),
        pageCount: Math.max(1, pageCount),
        offset: 0,
        ratio: 1,
        },
      { number: current.number, orderIndex: Math.max(0, index) },
    )
    vibrate(12)
    prepareNext()
  }

  /* ---- Navigation entre chapitres ---------------------------------------- */

  const openChapter = (id: string, atEnd = false) => {
    flush()
    setStartAtEnd(atEnd)
    setChapterId(id)
  }

  const label = (chapter: ReaderChapter | undefined) =>
    !chapter ? null : chapter.number ? t.reader.chapter(chapter.number) : (chapter.title ?? t.reader.oneshot)

  const start = (() => {
    if (startAtEnd) return { page: 'end' as const, offset: 0 }
    if (opening && current && opening.chapterId === current.id && opening.ratio < COMPLETION_THRESHOLD) {
      return { page: opening.page, offset: opening.offset }
    }
    return { page: 0, offset: 0 }
  })()

  const items: DrawerItem[] = order.map((chapter) => {
    const number = chapterNumber(chapter.number)
    const detail = [chapter.volume ? t.reader.volume(chapter.volume) : null, chapter.number ? chapter.title : null, chapter.groups.map((group) => group.name).join(', ') || null]
      .filter(Boolean)
      .join(' · ')
    return {
      id: chapter.id,
      label: label(chapter) ?? '',
      detail,
      state: chapter.id === chapterId ? 'current' : number !== null && number <= chaptersRead ? 'read' : null,
    }
  })

  const credits = [
    current && current.groups.length > 0 ? t.reader.translatedBy(current.groups.map((group) => group.name).join(', ')) : null,
    t.reader.creditSource,
  ].filter((line): line is string => Boolean(line))

  const ui = useReaderChrome()

  // Liste indisponible ou vide : on le dit, sans laisser un écran noir.
  if (list.status !== 'ready' || !chapterId) {
    const empty = list.status === 'ready' && list.data.chapters.length === 0
    return (
      <div className="fixed inset-0 z-[100] bg-black text-cream">
        <ReaderMessage
          message={list.status === 'error' ? t.reader.errorChapters : empty ? t.reader.noChapters : t.reader.loading}
          busy={list.status === 'loading' || (list.status === 'ready' && !empty)}
          onRetry={list.status === 'error' ? () => setListTick((tick) => tick + 1) : undefined}
          onClose={ui.close}
        />
      </div>
    )
  }

  const available = list.data.available

  return (
    <ImageReader
      workId={book.id}
      kind={book.kind}
      title={book.title}
      chapterLabel={label(current)}
      contentKey={`${chapterId}:${quality}`}
      pages={pageState.status === 'ready' ? pageState.data : null}
      status={pageState.status}
      errorMessage={t.reader.errorPages}
      onRetry={() => setPagesTick((tick) => tick + 1)}
      start={start}
      onPosition={onPosition}
      onChapterEnd={onChapterEnd}
      prev={prev ? { label: `${t.reader.prevChapter} · ${label(prev)}`, go: () => openChapter(prev.id, true) } : null}
      next={next ? { label: `${t.reader.nextChapter} · ${label(next)}`, go: () => openChapter(next.id) } : null}
      contents={{
        items,
        onSelect: (id) => openChapter(id),
        header: (
          <Choice
            label={t.reader.language}
            value={list.data.language}
            onChange={setChapterLanguage}
            options={(['fr', 'en'] as const).map((value) => ({
              value,
              label: t.language.names[value],
              hint: t.reader.languageCount(available[value]),
              disabled: available[value] === 0,
            }))}
          />
        ),
        footer: t.reader.creditSource,
      }}
      settings={
        <SettingGroup label={t.reader.quality} hint={t.reader.qualityHint}>
          <Choice
            label={t.reader.quality}
            value={qualityPreference}
            onChange={setQuality}
            options={[
              { value: 'auto', label: t.reader.qualities.auto },
              { value: 'data', label: t.reader.qualities.data },
              { value: 'data-saver', label: t.reader.qualities['data-saver'] },
            ]}
          />
        </SettingGroup>
      }
      credits={credits}
      prefetchNext={nextFirst}
      notice={typeof navigator !== 'undefined' && !navigator.onLine ? t.reader.offlineHint : null}
    />
  )
}

const EMPTY: ReaderChapter[] = []

