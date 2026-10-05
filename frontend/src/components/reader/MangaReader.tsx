import { useEffect, useMemo, useRef, useState } from 'react'
import { useReaderChrome } from '../../hooks/reader/useReaderUi'
import { useLanguage, useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { neighbours, readingOrder } from '../../lib/reader/navigation'
import { chapterNumber, COMPLETION_THRESHOLD, initialChapterId } from '../../lib/reader/progress'
import { resolveQuality } from '../../lib/reader/quality'
import {
  applySourcePreference,
  chapterSources,
  creditedSources,
  ensureChapter,
  findChapter,
  isExtensionSource,
  isMultiSource,
  sourceOf,
  versionFrom,
} from '../../lib/reader/sources'
import { readerApi } from '../../services/readerApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import { useReaderStore } from '../../store/useReaderStore'
import { OfficialPlatforms } from '../book/OfficialPlatforms'
import type { Book } from '../../types/book'
import type { ChapterLanguage, ChapterList, ChapterPages, ReaderChapter, ReadingPosition, ViewPosition } from '../../types/reader'
import type { DrawerItem } from './ChapterDrawer'
import { ImageReader } from './ImageReader'
import { ReaderMessage } from './ReaderMessage'
import { Choice, SettingGroup } from './ReaderSettings'

/** Ouverture du lecteur : la position du compte est attendue au plus… (puis celle de l'appareil). */
const RESUME_SYNC_TIMEOUT_MS = 2500
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
 * Lecteur des œuvres du catalogue : liste des chapitres fusionnée par l'API
 * depuis toutes les sources (MangaDex, Consumet…), pages relayées par l'API,
 * bascule de source par chapitre, et suivi automatique de la progression
 * dans la bibliothèque — position au pixel près, compteur de chapitres lus.
 */
export function MangaReader({ book, chapterId: requested }: MangaReaderProps) {
  const t = useT()
  const interfaceLanguage = useLanguage()
  const preferredLanguage = useReaderStore((state) => state.chapterLanguage)
  const setChapterLanguage = useReaderStore((state) => state.setChapterLanguage)
  const qualityPreference = useReaderStore((state) => state.quality)
  const setQuality = useReaderStore((state) => state.setQuality)
  const preferredSource = useReaderStore((state) => state.sourceByWork[book.id] ?? null)
  const setSource = useReaderStore((state) => state.setSource)
  const recordReading = useLibraryStore((state) => state.recordReading)
  const chaptersRead = useLibraryStore((state) => state.entries[book.id]?.chaptersRead ?? 0)

  // Position à l'ouverture seulement : la suite de la lecture ne doit pas la déplacer.
  // D'abord celle du COMPTE (lue peut-être sur un autre appareil depuis) ; `undefined`
  // tant qu'on la cherche. Hors-ligne ou réseau trop lent : celle de l'appareil.
  const [opening, setOpening] = useState<ReadingPosition | null | undefined>(undefined)
  const notify = useUiStore((state) => state.notify)
  useEffect(() => {
    const local = useLibraryStore.getState().entries[book.id]?.position ?? null
    let done = false
    const settle = () => {
      if (done) return
      done = true
      const fresh = useLibraryStore.getState().entries[book.id]?.position ?? null
      setOpening(fresh)
      // Plus loin ailleurs : on le dit, la reprise ne surprend pas.
      if (fresh && (!local || fresh.at > local.at) && (fresh.chapterId !== local?.chapterId || fresh.page !== local?.page)) {
        notify(t.reader.resumedFromAccount, 'like')
      }
    }
    const timer = window.setTimeout(settle, RESUME_SYNC_TIMEOUT_MS)
    void useAuthStore
      .getState()
      .refreshLibrary()
      .finally(() => {
        window.clearTimeout(timer)
        settle()
      })
    return () => {
      done = true
      window.clearTimeout(timer)
    }
    // Une fois par ouverture du lecteur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])
  const openingRef = useRef(opening)
  useEffect(() => {
    openingRef.current = opening
  })
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

  /** Liste arrivée avant la position du compte : le choix du chapitre l'attend. */
  const awaitingResume = useRef<{ all: ReaderChapter[]; before: ReaderChapter[] } | null>(null)
  const pickChapter = (all: ReaderChapter[], before: ReaderChapter[], resume: ReadingPosition | null) => {
    // Chapitre encore valable dans cette langue ? Sinon, le même numéro, sinon la reprise.
    const currentId = chapterRef.current
    if (currentId && findChapter(all, currentId)) return
    const previous = currentId ? findChapter(before, currentId) : undefined
    const sameNumber = previous?.number ? all.find((chapter) => chapter.number === previous.number) : undefined
    // Reprise : la version exacte de la dernière position, même chez une autre source que la préférée.
    const resumeId = resume?.chapterId ?? null
    const preferred = useReaderStore.getState().sourceByWork[book.id] ?? null
    const resumeOrder = readingOrder(ensureChapter(applySourcePreference(all, preferred), resumeId), [], resumeId)
    setChapterId(sameNumber?.id ?? initialChapterId(resumeOrder, resume, useLibraryStore.getState().entries[book.id]?.chaptersRead ?? 0))
  }
  const pickRef = useRef(pickChapter)
  useEffect(() => {
    pickRef.current = pickChapter
  })

  useEffect(() => {
    const controller = new AbortController()
    readerApi
      .chapters(book.id, language, controller.signal)
      .then((data) => {
        setList({ status: 'ready', data, key: listKey })
        const before = lastChapters.current
        lastChapters.current = data.chapters
        const resume = openingRef.current
        if (resume === undefined) awaitingResume.current = { all: data.chapters, before }
        else pickRef.current(data.chapters, before, resume)
      })
      .catch(() => {
        if (!controller.signal.aborted) setList({ status: 'error', key: listKey })
      })
    return () => controller.abort()
  }, [book.id, language, listKey])

  // La position du compte est connue : le chapitre de reprise peut être choisi.
  useEffect(() => {
    const waiting = awaitingResume.current
    if (opening === undefined || !waiting) return
    awaitingResume.current = null
    pickRef.current(waiting.all, waiting.before, opening)
  }, [opening])

  // Source préférée appliquée, et chapitre ouvert gardé à sa place même s'il vient d'une autre source.
  // `list` est recréé à chaque rendu pendant le chargement ; ses chapitres, eux, sont stables.
  const listed = list.status === 'ready' ? list.data.chapters : EMPTY
  const chapters = useMemo(
    () => (listed === EMPTY ? EMPTY : ensureChapter(applySourcePreference(listed, preferredSource), chapterId)),
    [listed, preferredSource, chapterId],
  )
  const current = useMemo(() => chapters.find((chapter) => chapter.id === chapterId), [chapters, chapterId])
  /** Versions du chapitre chez les autres sources : l'API les essaie si la sienne ne répond pas. */
  const alternatesRef = useRef<string[]>([])
  useEffect(() => {
    alternatesRef.current = current?.alternates?.map((alt) => alt.id) ?? []
  })
  const order = useMemo(
    () => readingOrder(chapters, current?.groups.map((group) => group.id) ?? [], chapterId),
    [chapters, current, chapterId],
  )
  const { index, prev, next } = neighbours(order, chapterId)

  /* ---- Pages du chapitre ------------------------------------------------- */

  const quality = resolveQuality(qualityPreference)
  const [pages, setPages] = useState<Load<ChapterPages> & { key: string }>({ status: 'loading', key: '' })
  const [pagesTick, setPagesTick] = useState(0)
  const pagesKey = `${chapterId}:${quality}:${pagesTick}`

  useEffect(() => {
    if (!chapterId) return
    let cancelled = false
    readerApi
      .pages(chapterId, quality, alternatesRef.current)
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
      .pages(next.id, quality, next.alternates?.map((alt) => alt.id) ?? [])
      .then((data) => setNextFirst(data.pages.slice(0, 3).map((page) => page.url)))
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
    const pageCount = pageState.data.pages.length
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

  const sources = list.status === 'ready' ? list.data.sources : undefined
  // Badge de provenance : quand plusieurs sources se mêlent dans la liste, et toujours pour le site d'une extension.
  const showSource = isMultiSource(sources)
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
      badge: showSource || isExtensionSource(sourceOf(chapter)) ? sourceOf(chapter).name : null,
      extension: isExtensionSource(sourceOf(chapter)),
    }
  })

  const creditLine = t.reader.creditSource(new Intl.ListFormat(t.locale, { type: 'conjunction' }).format(creditedSources(sources, listed)))
  const credits = [
    current && current.groups.length > 0 ? t.reader.translatedBy(current.groups.map((group) => group.name).join(', ')) : null,
    creditLine,
  ].filter((line): line is string => Boolean(line))

  /** Bascule manuelle : ce chapitre chez une autre source, et cette source préférée pour la suite. */
  const versions = chapterSources(current)
  const switchSource = (sourceId: string) => {
    if (!current) return
    const target = versionFrom(current, sourceId)
    setSource(book.id, sourceId)
    if (target && target.id !== current.id) openChapter(target.id)
  }
  const sourcePicker =
    current && versions.length > 1
      ? {
          value: sourceOf(current).id,
          options: versions.map((source) => ({ value: source.id, label: source.name })),
          onChange: switchSource,
        }
      : null

  /** Page en erreur : le même chapitre chez la source suivante, en un tap depuis la page elle-même. */
  const nextSource = versions[1]
  const pageRecovery = nextSource ? { label: t.reader.trySource(nextSource.name), onSwitch: () => switchSource(nextSource.id) } : null

  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  // Nom du site qui a réellement servi (« Asura Scans », pas le fournisseur « Tachiyomi ») : lu dans la liste.
  const fallbackSource =
    pageState.status === 'ready' && pageState.data.fallback
      ? ((findChapter(listed, pageState.data.servedBy)?.source ?? pageState.data.source)?.name ?? null)
      : null
  const notice = offline ? t.reader.offlineHint : fallbackSource ? t.reader.sourceFallback(fallbackSource) : null

  const ui = useReaderChrome()

  // Liste indisponible ou vide : on le dit, sans laisser un écran noir.
  if (list.status !== 'ready' || !chapterId) {
    const empty = list.status === 'ready' && list.data.chapters.length === 0
    // Titre sous licence : pas de chapitre hébergé, mais des plateformes officielles où le lire.
    const official = empty ? (list.data.officialPlatforms ?? []) : []
    const emptyMessage = official.length > 0 ? t.reader.noChaptersLicensed : t.reader.noChapters
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto bg-black text-cream">
        <ReaderMessage
          message={list.status === 'error' ? t.reader.errorChapters : empty ? emptyMessage : t.reader.loading}
          busy={list.status === 'loading' || (list.status === 'ready' && !empty)}
          onRetry={list.status === 'error' ? () => setListTick((tick) => tick + 1) : undefined}
          onClose={ui.close}
        >
          {official.length > 0 && <OfficialPlatforms platforms={official} showHeading={false} />}
        </ReaderMessage>
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
      pages={pageState.status === 'ready' ? pageState.data.pages : null}
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
        footer: creditLine,
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
      notice={notice}
      sourcePicker={sourcePicker}
      pageRecovery={pageRecovery}
    />
  )
}

const EMPTY: ReaderChapter[] = []

