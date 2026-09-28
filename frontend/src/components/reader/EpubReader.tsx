import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ePub, { type Book as EpubBook, type Contents, type Location, type NavItem, type Rendition } from 'epubjs'
import { useThemeColor } from '../../hooks/reader/useReaderEnvironment'
import { useReaderChrome } from '../../hooks/reader/useReaderUi'
import { useT } from '../../i18n'
import { getLocations, saveLocations } from '../../lib/reader/db'
import { FONT_ORDER, FONT_STACKS, THEMES, THEME_ORDER, fontFaceRules, readerCss } from '../../lib/reader/epubStyle'
import { keyAction, swipeAction, tapAction } from '../../lib/reader/navigation'
import { countWords, remainingMinutes } from '../../lib/reader/progress'
import { TEXT_LIMITS, useReaderStore } from '../../store/useReaderStore'
import { ChapterDrawer, type DrawerItem } from './ChapterDrawer'
import { EMBEDDED_FONTS } from './epubFonts'
import { ReaderControls, ReaderStatus } from './ReaderControls'
import { ReaderMessage } from './ReaderMessage'
import { Choice, ReaderSettings, SettingGroup, Stepper } from './ReaderSettings'
import { ReadingProgressBar } from './ReadingProgressBar'

/** Ce que lit le moteur texte : un fichier de l'appareil ou un roman du compte. */
export interface EpubSource {
  title: string
  /** Contenu du fichier (lu une fois, à l'ouverture). */
  load: () => Promise<Blob | undefined>
  /** Où reprendre ; `null` : au début. */
  initialCfi: string | null
  /** Clé IndexedDB des positions précalculées de ce livre. */
  locationsKey: string
  /**
   * Page posée. `ratio` (0 → 1) vaut `null` tant que les positions du livre
   * ne sont pas calculées : l'avancement réel est alors inconnu.
   */
  onPosition: (position: { cfi: string; ratio: number | null }) => void
  /** Information discrète en bas d'écran (hors-ligne, synchronisation…). */
  notice?: ReactNode
}

/** Caractères par position epub.js : partie de la clé du cache (changer l'un invalide l'autre). */
const CHARS_PER_LOCATION = 1600

const STYLE_ID = 'bookshelf-reader-style'
const FONTS_STYLE_ID = 'bookshelf-reader-fonts'

function applyCss(contents: Contents, css: string) {
  const document = contents.document
  let style = document.getElementById(STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = css
}

/** Sommaire aplati, avec la profondeur de chaque entrée. */
function flattenToc(items: NavItem[], depth = 0): { item: NavItem; depth: number }[] {
  return items.flatMap((item) => [{ item, depth }, ...flattenToc(item.subitems ?? [], depth + 1)])
}

const baseHref = (href: string) => href.split('#')[0] ?? href

type Phase = 'loading' | 'ready' | 'error'

/**
 * Mode texte : romans et web novels au format EPUB (epub.js), en pages
 * refondues selon l'écran. Typographie réglable (six polices dont une adaptée
 * à la dyslexie, taille, interlignage, marges), cinq thèmes (sombre, OLED,
 * sépia…), sommaire, barre de progression, temps de lecture restant.
 */
export function EpubReader({ source }: { source: EpubSource }) {
  const t = useT()
  const ui = useReaderChrome()
  const text = useReaderStore((state) => state.text)
  const setText = useReaderStore((state) => state.setText)
  const showStatus = useReaderStore((state) => state.showStatus)
  const theme = THEMES[text.theme] ?? THEMES.dark
  useThemeColor(theme.background)

  const hostRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [tick, setTick] = useState(0)
  const [toc, setToc] = useState<{ item: NavItem; depth: number }[]>([])
  const [location, setLocation] = useState<Location | null>(null)
  const [locationsReady, setLocationsReady] = useState(false)
  const [words, setWords] = useState<Record<number, number>>({})
  // Figés à l'ouverture : la position de reprise ne doit pas rouvrir le livre à chaque page.
  const [opening] = useState(() => ({ cfi: source.initialCfi, load: source.load, locationsKey: `${source.locationsKey}:${CHARS_PER_LOCATION}` }))

  const fontFaces = useMemo(() => fontFaceRules(EMBEDDED_FONTS, window.location.href), [])
  const cssRef = useRef(readerCss(text, fontFaces))
  const latest = useRef({ ui, onPosition: source.onPosition, direction: 'ltr' as const, locationsReady: false })
  useEffect(() => {
    latest.current = { ...latest.current, ui, onPosition: source.onPosition }
  })

  // Polices aussi dans le document principal : les réglages les montrent en aperçu.
  useEffect(() => {
    const style = document.createElement('style')
    style.id = FONTS_STYLE_ID
    style.textContent = fontFaces
    document.head.appendChild(style)
    return () => style.remove()
  }, [fontFaces])

  /* ---- Ouverture du livre ------------------------------------------------ */

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let book: EpubBook | null = null
    latest.current.locationsReady = false

    const report = (next: Location) => {
      const percentage = next.start.percentage
      latest.current.onPosition({
        cfi: next.start.cfi,
        ratio: latest.current.locationsReady && Number.isFinite(percentage) ? percentage : null,
      })
    }

    const open = async () => {
      const blob = await opening.load()
      if (!blob) throw new Error('missing')
      book = ePub(await blob.arrayBuffer())
      bookRef.current = book
      await book.opened
      if (cancelled) return

      // Positions déjà calculées lors d'une lecture précédente : curseur et % tout de suite.
      const savedLocations = await getLocations(opening.locationsKey).catch(() => undefined)
      if (cancelled) return
      if (savedLocations) {
        try {
          book.locations.load(savedLocations)
          latest.current.locationsReady = true
          setLocationsReady(true)
        } catch {
          // Copie illisible : recalculée plus bas.
        }
      }

      const rendition = book.renderTo(host, {
        width: '100%',
        height: '100%',
        flow: 'paginated',
        spread: 'auto',
        minSpreadWidth: 900,
        // Jamais de script venu du fichier : l'iframe reste en bac à sable.
        allowScriptedContent: false,
      })
      renditionRef.current = rendition

      rendition.hooks.content.register((contents: Contents) => applyCss(contents, cssRef.current))

      rendition.on('relocated', (next: Location) => {
        setLocation(next)
        report(next)
      })
      rendition.on('rendered', (section: { index: number }, view: { contents?: Contents }) => {
        const body = view.contents?.document.body
        if (body) setWords((current) => ({ ...current, [section.index]: countWords(body.textContent ?? '') }))
      })

      // Tap : tiers gauche / droit pour tourner la page, centre pour les commandes.
      rendition.on('click', (event: MouseEvent) => {
        const selection = (event.view as Window | null)?.getSelection()
        if (selection && !selection.isCollapsed) return
        if ((event.target as Element | null)?.closest?.('a')) return
        const frame = (event.view as Window | null)?.frameElement
        const box = host.getBoundingClientRect()
        if (!frame) return
        const x = frame.getBoundingClientRect().left + event.clientX - box.left
        const action = tapAction(x, box.width, latest.current.direction)
        if (action === 'menu') latest.current.ui.toggleControls()
        else void (action === 'next' ? rendition.next() : rendition.prev())
      })

      // Swipe dans l'iframe : `screenX` est commun aux deux documents.
      let touchStart: { x: number; time: number } | null = null
      rendition.on('touchstart', (event: TouchEvent) => {
        const touch = event.changedTouches[0]
        touchStart = touch ? { x: touch.screenX, time: performance.now() } : null
      })
      rendition.on('touchend', (event: TouchEvent) => {
        const touch = event.changedTouches[0]
        if (!touch || !touchStart) return
        const dx = touch.screenX - touchStart.x
        const velocity = (dx / Math.max(1, performance.now() - touchStart.time)) * 1000
        touchStart = null
        const action = swipeAction(dx, latest.current.direction, velocity)
        if (!action) return
        latest.current.ui.hideControls()
        void (action === 'next' ? rendition.next() : rendition.prev())
      })
      // Touches frappées dans le livre (focus dans l'iframe) : epub.js les relaie
      // depuis un écouteur passif, `preventDefault` y est impossible et inutile.
      rendition.on('keydown', (event: KeyboardEvent) => handleKey(event, false))

      const navigation = await book.loaded.navigation
      if (!cancelled) setToc(flattenToc(navigation.toc))

      // Position illisible (livre remplacé, CFI d'une autre édition) : on repart du début.
      await rendition.display(opening.cfi || undefined).catch(() => rendition.display())
      if (cancelled) return
      setPhase('ready')
      if (latest.current.locationsReady) return

      // Positions globales (curseur, pourcentage) : calcul coûteux, lancé après l'affichage, gardé ensuite.
      await book.locations.generate(CHARS_PER_LOCATION)
      if (cancelled) return
      latest.current.locationsReady = true
      setLocationsReady(true)
      void saveLocations(opening.locationsKey, book.locations.save()).catch(() => {})
      const current = rendition.currentLocation() as unknown as Location | undefined
      if (current?.start) {
        setLocation({ ...current })
        // Le pourcentage est enfin connu : la position courante le porte.
        report(current)
      }
    }

    const handleKey = (event: KeyboardEvent, cancelable = true) => {
      if (latest.current.ui.panel) return
      const action = keyAction(event.key, latest.current.direction, event.shiftKey)
      const rendition = renditionRef.current
      if (!action || !rendition) return
      if (cancelable) event.preventDefault()
      void (action === 'next' ? rendition.next() : rendition.prev())
    }
    const onWindowKey = (event: KeyboardEvent) => handleKey(event)
    window.addEventListener('keydown', onWindowKey)

    open().catch(() => {
      if (!cancelled) setPhase('error')
    })

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onWindowKey)
      renditionRef.current?.destroy()
      renditionRef.current = null
      book?.destroy()
      bookRef.current = null
    }
  }, [opening, tick])

  /* ---- Réglages appliqués à chaud ---------------------------------------- */

  useEffect(() => {
    cssRef.current = readerCss(text, fontFaces)
    const rendition = renditionRef.current
    if (!rendition) return
    for (const contents of rendition.getContents() as unknown as Contents[]) applyCss(contents, cssRef.current)
  }, [text, fontFaces])

  // Marges et taille d'écran : epub.js doit recalculer sa pagination.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (box && box.width > 0 && box.height > 0) renditionRef.current?.resize(box.width, box.height)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  /* ---- Affichage --------------------------------------------------------- */

  const start = location?.start
  const sectionWords = start ? (words[start.index] ?? 0) : 0
  const minutes = start ? remainingMinutes(sectionWords, start.displayed.page, start.displayed.total) : 0
  const ratio = locationsReady && start && Number.isFinite(start.percentage) ? start.percentage : null
  const percent = ratio === null ? null : Math.round(ratio * 100)

  const currentHref = start ? baseHref(start.href) : null
  const items: DrawerItem[] = useMemo(() => {
    // L'entrée active : la dernière du sommaire qui pointe sur le chapitre affiché.
    const activeIndex = currentHref ? toc.map(({ item }) => baseHref(item.href)).lastIndexOf(currentHref) : -1
    return toc.map(({ item, depth }, index) => ({
      id: `${index}:${item.href}`,
      label: item.label.trim(),
      depth,
      state: index === activeIndex ? 'current' : null,
    }))
  }, [toc, currentHref])

  const currentTitle = items.find((item) => item.state === 'current')?.label ?? null
  const goSection = (step: 1 | -1) => {
    const book = bookRef.current
    if (!book || !start) return
    const section = book.spine.get(start.index + step) as { href?: string } | undefined
    if (section?.href) void renditionRef.current?.display(section.href)
  }

  const timeLeft = sectionWords > 0 ? t.reader.text.minutesLeft(minutes) : null
  // Commandes affichées : le curseur donne déjà le pourcentage, seul le temps restant s'ajoute.
  const controlsNote = phase !== 'ready' ? null : (timeLeft ?? (percent === null ? t.reader.text.locating : null))
  // Commandes masquées : une ligne discrète, temps restant et pourcentage.
  const readingNote = [timeLeft, percent !== null ? t.reader.percent(percent) : null].filter(Boolean).join(' · ')

  return (
    <div className="fixed inset-0 z-[100]" style={{ background: theme.background, color: theme.color }}>
      <div
        ref={hostRef}
        className="absolute top-[max(2rem,env(safe-area-inset-top))] bottom-10"
        style={{ left: text.margin, right: text.margin }}
      />

      {phase !== 'ready' && (
        <div className="absolute inset-0 bg-black">
          <ReaderMessage
            message={phase === 'error' ? t.reader.errorFile : t.reader.opening}
            busy={phase === 'loading'}
            onRetry={phase === 'error' ? () => {
              setPhase('loading')
              setTick((value) => value + 1)
            } : undefined}
            onClose={ui.close}
          />
        </div>
      )}

      {phase === 'ready' && !ui.controls && (readingNote || source.notice) && (
        <p className="pointer-events-none absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-center gap-1.5 px-4 text-center text-[10px] opacity-50">
          {source.notice}
          {source.notice && readingNote && <span aria-hidden>·</span>}
          {readingNote}
        </p>
      )}

      {phase === 'ready' && ratio !== null && (
        <ReadingProgressBar ratio={ratio} color={theme.link} label={t.reader.text.progressLabel(Math.round(ratio * 100))} />
      )}

      <ReaderStatus visible={showStatus && !ui.controls} tone={theme.dark ? 'light' : 'dark'} />

      <ReaderControls
        visible={ui.controls}
        title={source.title}
        subtitle={currentTitle}
        onClose={ui.close}
        onOpenContents={toc.length > 0 ? () => ui.setPanel('contents') : undefined}
        contentsLabel={t.reader.contents}
        onOpenSettings={() => ui.setPanel('settings')}
        slider={
          ratio !== null
            ? {
                value: Math.round(ratio * 1000),
                max: 1000,
                valueText: t.reader.percent(Math.round(ratio * 100)),
                onChange: (value) => {
                  const cfi = bookRef.current?.locations.cfiFromPercentage(value / 1000)
                  if (cfi) void renditionRef.current?.display(cfi)
                },
              }
            : null
        }
        prev={start && start.index > 0 ? { label: t.reader.prevChapter, go: () => goSection(-1) } : null}
        next={start && !location?.atEnd ? { label: t.reader.nextChapter, go: () => goSection(1) } : null}
        footnote={controlsNote}
      />

      <ChapterDrawer
        open={ui.panel === 'contents'}
        title={t.reader.contents}
        items={items}
        onSelect={(id) => {
          ui.setPanel(null)
          const href = id.slice(id.indexOf(':') + 1)
          void renditionRef.current?.display(href)
        }}
        onClose={() => ui.setPanel(null)}
      />

      <ReaderSettings open={ui.panel === 'settings'} onClose={() => ui.setPanel(null)}>
        <SettingGroup label={t.reader.text.theme}>
          <Choice
            label={t.reader.text.theme}
            value={text.theme}
            onChange={(value) => setText({ theme: value })}
            options={THEME_ORDER.map((value) => ({ value, label: t.reader.text.themes[value], swatch: THEMES[value].background }))}
          />
        </SettingGroup>
        <SettingGroup label={t.reader.text.font}>
          <Choice
            label={t.reader.text.font}
            value={text.font}
            columns={3}
            onChange={(value) => setText({ font: value })}
            options={FONT_ORDER.map((value) => ({ value, label: t.reader.text.fonts[value], fontFamily: FONT_STACKS[value] }))}
          />
        </SettingGroup>
        <SettingGroup label={t.reader.text.fontSize}>
          <Stepper
            value={t.reader.percent(text.fontSize)}
            onDecrease={() => setText({ fontSize: text.fontSize - TEXT_LIMITS.fontSize.step })}
            onIncrease={() => setText({ fontSize: text.fontSize + TEXT_LIMITS.fontSize.step })}
            decreaseLabel={t.reader.text.smaller}
            increaseLabel={t.reader.text.larger}
          />
        </SettingGroup>
        <SettingGroup label={t.reader.text.lineHeight}>
          <Stepper
            value={text.lineHeight.toFixed(1)}
            onDecrease={() => setText({ lineHeight: text.lineHeight - TEXT_LIMITS.lineHeight.step })}
            onIncrease={() => setText({ lineHeight: text.lineHeight + TEXT_LIMITS.lineHeight.step })}
            decreaseLabel={t.reader.text.tighter}
            increaseLabel={t.reader.text.looser}
          />
        </SettingGroup>
        <SettingGroup label={t.reader.text.margins}>
          <Stepper
            value={String(text.margin)}
            onDecrease={() => setText({ margin: text.margin - TEXT_LIMITS.margin.step })}
            onIncrease={() => setText({ margin: text.margin + TEXT_LIMITS.margin.step })}
            decreaseLabel={t.reader.text.narrower}
            increaseLabel={t.reader.text.wider}
          />
        </SettingGroup>
      </ReaderSettings>
    </div>
  )
}
