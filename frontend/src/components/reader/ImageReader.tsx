import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePrefetch } from '../../hooks/reader/usePrefetch'
import { useReaderChrome } from '../../hooks/reader/useReaderUi'
import { useT } from '../../i18n'
import { keyAction } from '../../lib/reader/navigation'
import { defaultDirection, defaultLayout, useReaderStore } from '../../store/useReaderStore'
import type { BookKind } from '../../types/book'
import type { ReaderPage, ReaderViewController, ViewPosition } from '../../types/reader'
import { ChapterDrawer, type DrawerItem } from './ChapterDrawer'
import { ChapterEnd } from './ChapterEnd'
import { PagedView } from './PagedView'
import { ReaderControls, ReaderStatus, type ChapterStep } from './ReaderControls'
import { ReaderMessage } from './ReaderMessage'
import { Choice, ReaderSettings, SettingGroup } from './ReaderSettings'
import { WebtoonView } from './WebtoonView'

export interface ImageReaderProps {
  /** Clé des réglages par œuvre (mode, sens) : id MangaDex, ou `local:<id>`. */
  workId: string
  kind?: BookKind
  title: string
  /** Chapitre en cours (« Chapitre 12 »), `null` pour un fichier sans chapitres. */
  chapterLabel: string | null
  /** Identifie le contenu affiché : un nouveau chapitre remonte les vues à neuf. */
  contentKey: string
  pages: ReaderPage[] | null
  status: 'loading' | 'ready' | 'error'
  errorMessage?: string
  onRetry?: () => void
  /** Point de reprise dans ce contenu ; `end` : dernière page (retour arrière d'un chapitre). */
  start: { page: number | 'end'; offset: number }
  onPosition: (position: ViewPosition & { pageCount: number }) => void
  /** Fin du chapitre atteinte (dernière page, ou bas du défilement). */
  onChapterEnd: () => void
  prev?: ChapterStep | null
  next?: ChapterStep | null
  /** Sommaire (chapitres) ; absent pour un fichier isolé. */
  contents?: { items: DrawerItem[]; onSelect: (id: string) => void; header?: ReactNode; footer?: ReactNode } | null
  /** Réglages propres à la source (qualité, langue des chapitres). */
  settings?: ReactNode
  credits?: string[]
  /** URL à précharger après le chapitre en cours (début du chapitre suivant). */
  prefetchNext?: string[]
  /** Bandeau d'information (hors-ligne…). */
  notice?: string | null
}

/**
 * Moteur « images » : scans de manga, manhwa, webtoon, BD et comics, qu'ils
 * viennent de MangaDex ou d'une archive CBZ importée. Deux vues, basculables
 * en un tap : défilement vertical continu, ou pages (simple / double, RTL / LTR).
 */
export function ImageReader(props: ImageReaderProps) {
  const {
    workId,
    kind,
    title,
    chapterLabel,
    contentKey,
    pages,
    status,
    errorMessage,
    onRetry,
    start,
    onPosition,
    onChapterEnd,
    prev,
    next,
    contents,
    settings,
    credits,
    prefetchNext,
    notice,
  } = props
  const t = useT()
  const ui = useReaderChrome()

  const layout = useReaderStore((state) => state.layoutByWork[workId] ?? defaultLayout(kind))
  const direction = useReaderStore((state) => state.directionByWork[workId] ?? defaultDirection(kind))
  const spread = useReaderStore((state) => state.spread)
  const showStatus = useReaderStore((state) => state.showStatus)
  const setLayout = useReaderStore((state) => state.setLayout)
  const setDirection = useReaderStore((state) => state.setDirection)
  const setSpread = useReaderStore((state) => state.setSpread)

  const controller = useRef<ReaderViewController | null>(null)
  const pageCount = pages?.length ?? 0
  const startPage = start.page === 'end' ? Math.max(0, pageCount - 1) : start.page
  const [current, setCurrent] = useState<{ key: string; page: number }>({ key: contentKey, page: startPage })
  // Nouveau chapitre : la page courante repart du point de reprise (état dérivé d'une prop).
  if (current.key !== contentKey) setCurrent({ key: contentKey, page: startPage })
  const [ended, setEnded] = useState<string | null>(null)

  usePrefetch(pages ?? [], current.page, prefetchNext)

  const report = (position: ViewPosition) => {
    setCurrent((previous) => (previous.page === position.page && previous.key === contentKey ? previous : { key: contentKey, page: position.page }))
    onPosition({ ...position, pageCount })
  }

  const reachEnd = () => {
    if (ended === contentKey) return
    setEnded(contentKey)
    onChapterEnd()
  }

  // Clavier : sens de lecture en mode pages, haut / bas en défilement.
  const keyRef = useRef({ panel: ui.panel, layout, direction })
  useEffect(() => {
    keyRef.current = { panel: ui.panel, layout, direction }
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = keyRef.current
      if (state.panel || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return
      const action = keyAction(event.key, state.layout === 'webtoon' ? 'ltr' : state.direction, event.shiftKey)
      if (!action) return
      // En défilement, ← / → n'ont pas de sens : seuls ↑ ↓, Espace et Page ↑↓ défilent.
      if (state.layout === 'webtoon' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return
      event.preventDefault()
      controller.current?.step(action === 'next' ? 1 : -1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const toggleLayout = () => setLayout(workId, layout === 'webtoon' ? 'paged' : 'webtoon')
  const hasEnded = ended === contentKey

  const body = (() => {
    if (status === 'error') {
      return <ReaderMessage message={errorMessage ?? t.reader.errorPages} onRetry={onRetry} onClose={ui.close} />
    }
    if (status === 'loading' || !pages) return <ReaderMessage message={t.reader.loading} busy />
    const end = <ChapterEnd label={chapterLabel} next={next ?? null} credits={credits} />
    if (layout === 'webtoon') {
      return (
        <WebtoonView
          key={`${contentKey}:webtoon`}
          pages={pages}
          // Page courante (et non celle d'ouverture) : basculer de mode ne fait pas perdre sa place.
          start={{ page: current.page, offset: current.page === startPage && start.page !== 'end' ? start.offset : 0 }}
          controllerRef={controller}
          onPosition={report}
          onEnd={reachEnd}
          onMenu={ui.toggleControls}
          onInteract={ui.hideControls}
          end={end}
        />
      )
    }
    return (
      <PagedView
        key={`${contentKey}:paged`}
        pages={pages}
        direction={direction}
        spreadMode={spread}
        startPage={current.page}
        controllerRef={controller}
        onPosition={report}
        onEnd={reachEnd}
        onMenu={ui.toggleControls}
        onInteract={ui.hideControls}
        onBeyondEnd={() => next?.go()}
        onBeforeStart={() => prev?.go()}
        overlay={hasEnded && !ui.controls ? <ChapterEnd label={chapterLabel} next={next ?? null} variant="floating" /> : null}
      />
    )
  })()

  const subtitle = [chapterLabel, pageCount > 0 ? t.reader.pageOf(Math.min(current.page + 1, pageCount), pageCount) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="fixed inset-0 z-[100] bg-black text-cream" data-reader>
      <div className="absolute inset-0">{body}</div>

      {notice && (
        <p className="pointer-events-none absolute inset-x-0 top-[max(2rem,env(safe-area-inset-top))] z-10 text-center text-[11px] text-gold/80">
          {notice}
        </p>
      )}

      <ReaderStatus visible={showStatus && !ui.controls} />

      <ReaderControls
        visible={ui.controls}
        title={title}
        subtitle={subtitle}
        onClose={ui.close}
        onOpenContents={contents ? () => ui.setPanel('contents') : undefined}
        onOpenSettings={() => ui.setPanel('settings')}
        slider={
          pageCount > 1
            ? {
                value: current.page,
                max: pageCount - 1,
                valueText: t.reader.pageOf(current.page + 1, pageCount),
                onChange: (value) => controller.current?.goTo(value),
              }
            : null
        }
        prev={prev}
        next={next}
        layout={{ current: layout, onToggle: toggleLayout }}
      />

      {contents && (
        <ChapterDrawer
          open={ui.panel === 'contents'}
          title={t.reader.chapters}
          items={contents.items}
          onSelect={(id) => {
            ui.setPanel(null)
            contents.onSelect(id)
          }}
          onClose={() => ui.setPanel(null)}
          header={contents.header}
          footer={contents.footer}
        />
      )}

      <ReaderSettings open={ui.panel === 'settings'} onClose={() => ui.setPanel(null)}>
        <SettingGroup label={t.reader.layout}>
          <Choice
            label={t.reader.layout}
            value={layout}
            onChange={(value) => setLayout(workId, value)}
            options={[
              { value: 'webtoon', label: t.reader.layouts.webtoon },
              { value: 'paged', label: t.reader.layouts.paged },
            ]}
          />
        </SettingGroup>
        {layout === 'paged' && (
          <>
            <SettingGroup label={t.reader.direction}>
              <Choice
                label={t.reader.direction}
                value={direction}
                onChange={(value) => setDirection(workId, value)}
                options={[
                  { value: 'rtl', label: t.reader.directions.rtl, hint: t.reader.directionHints.rtl },
                  { value: 'ltr', label: t.reader.directions.ltr, hint: t.reader.directionHints.ltr },
                ]}
              />
            </SettingGroup>
            <SettingGroup label={t.reader.spread} hint={t.reader.spreadHint}>
              <Choice
                label={t.reader.spread}
                value={spread}
                onChange={setSpread}
                options={[
                  { value: 'auto', label: t.reader.spreads.auto },
                  { value: 'single', label: t.reader.spreads.single },
                  { value: 'double', label: t.reader.spreads.double },
                ]}
              />
            </SettingGroup>
          </>
        )}
        {settings}
      </ReaderSettings>
    </div>
  )
}
