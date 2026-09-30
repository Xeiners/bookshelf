import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ePub, { type Book as EpubBook, type Contents, type Location, type NavItem, type Rendition } from 'epubjs'
import { useThemeColor } from '../../hooks/reader/useReaderEnvironment'
import { useReaderChrome } from '../../hooks/reader/useReaderUi'
import { useT } from '../../i18n'
import { getLocations, saveLocations } from '../../lib/reader/db'
import { FONT_ORDER, FONT_STACKS, READER_STYLE_ID, THEMES, THEME_ORDER, fontFaceRules, readerCss } from '../../lib/reader/epubStyle'
import { keyAction, swipeAction, tapAction } from '../../lib/reader/navigation'
import type { TurnCorner, TurnDirection } from '../../lib/reader/pageTurn'
import { PageTurner } from '../../lib/reader/pageTurner'
import { countWords, remainingMinutes, virtualPage } from '../../lib/reader/progress'
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

const FONTS_STYLE_ID = 'bookshelf-reader-fonts'
/** Déplacement du doigt (px) à partir duquel la feuille se soulève et le suit. */
const GRAB_DISTANCE = 12
/** Doigt immobile depuis plus longtemps : il lâche la feuille sans élan. */
const STILL_MS = 100

/** Coin de la feuille à tirer : celui du haut si le doigt est dans la moitié haute de la page. */
function cornerAt(event: MouseEvent | Touch, view: Window | null, host: HTMLElement): TurnCorner {
  const frame = view?.frameElement
  const y = (frame?.getBoundingClientRect().top ?? 0) + event.clientY
  const box = host.getBoundingClientRect()
  return y < box.top + box.height / 2 ? 'top' : 'bottom'
}

/** Double page affichée : epub.js ne l'expose que par son gestionnaire de vues. */
function isSpread(rendition: Rendition | null): boolean {
  const manager = (rendition as unknown as { manager?: { layout?: { divisor?: number } } } | null)?.manager
  return manager?.layout?.divisor === 2
}

function applyCss(contents: Contents, css: string) {
  const document = contents.document
  let style = document.getElementById(READER_STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = READER_STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = css
  if (document.documentElement.dataset.bookshelfGestures !== 'protected') {
    document.documentElement.dataset.bookshelfGestures = 'protected'
    const preventNativeMenu = (event: Event) => event.preventDefault()
    document.addEventListener('contextmenu', preventNativeMenu)
    document.addEventListener('selectstart', preventNativeMenu)
  }
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
  const pageTurn = useReaderStore((state) => state.pageTurn)
  const setPageTurn = useReaderStore((state) => state.setPageTurn)
  const theme = THEMES[text.theme] ?? THEMES.dark
  useThemeColor(theme.background)

  const stageRef = useRef<HTMLDivElement>(null)
  const pageClipRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const turnerRef = useRef<PageTurner | null>(null)
  /** Dernière position affichée : la page qui tourne sait s'il reste une page, et si elle est dans le chapitre. */
  const locationRef = useRef<Location | null>(null)
  /** Feuille tenue au doigt : la position n'est rapportée qu'une fois la page décidée. */
  const holdRef = useRef<{ holding: boolean; held: Location | null; report: ((location: Location) => void) | null }>({
    holding: false,
    held: null,
    report: null,
  })
  const [phase, setPhase] = useState<Phase>('loading')
  const [tick, setTick] = useState(0)
  const [toc, setToc] = useState<{ item: NavItem; depth: number }[]>([])
  const [location, setLocation] = useState<Location | null>(null)
  const [locationsReady, setLocationsReady] = useState(false)
  const [absolutePage, setAbsolutePage] = useState<{ page: number; total: number } | null>(null)
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

  /* ---- Page qui tourne --------------------------------------------------- */

  useEffect(() => {
    const stage = stageRef.current
    const pageClip = pageClipRef.current
    const page = pageRef.current
    const host = hostRef.current
    if (!stage || !pageClip || !page || !host) return
    const hold = holdRef.current
    const turner = new PageTurner({
      stage,
      page,
      pageClip,
      host,
      navigate: (direction) => {
        const rendition = renditionRef.current
        if (!rendition) return Promise.resolve()
        return direction === 'next' ? rendition.next() : rendition.prev()
      },
      canTurn: (direction) => {
        const location = locationRef.current
        return !!location && !(direction === 'next' ? location.atEnd : location.atStart)
      },
      staysInChapter: (direction) => {
        const location = locationRef.current
        if (!location) return false
        return direction === 'next'
          ? location.end.displayed.page < location.end.displayed.total
          : location.start.displayed.page > 1
      },
      isSpread: () => isSpread(renditionRef.current),
      onHoldChange: (holding) => {
        hold.holding = holding
        // Page décidée (tournée, ou retombée à sa place) : sa position part enfin.
        const held = hold.held
        hold.held = null
        if (!holding && held) hold.report?.(held)
      },
    })
    turnerRef.current = turner
    return () => {
      turner.destroy()
      turnerRef.current = null
    }
  }, [])

  useEffect(() => {
    turnerRef.current?.setTheme(theme)
  }, [theme])

  useEffect(() => {
    turnerRef.current?.setEnabled(pageTurn === 'book')
  }, [pageTurn])

  /* ---- Ouverture du livre ------------------------------------------------ */

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let book: EpubBook | null = null
    latest.current.locationsReady = false
    setAbsolutePage(null)

    /** Tap, flèche, swipe : la page tourne comme une feuille (ou d'un coup, selon le réglage). */
    const turnPage = (direction: TurnDirection, corner: TurnCorner = 'bottom') => {
      const turner = turnerRef.current
      const rendition = renditionRef.current
      if (turner) turner.turn(direction, corner)
      else if (rendition) void (direction === 'next' ? rendition.next() : rendition.prev())
    }

    const report = (next: Location) => {
      const percentage = next.start.percentage
      // epubjs renvoie bien un index numérique, malgré une déclaration TypeScript historique erronée (`Location`).
      const locationIndex = book && latest.current.locationsReady
        ? Number(book.locations.locationFromCfi(next.start.cfi) as unknown)
        : Number.NaN
      setAbsolutePage(book ? virtualPage(locationIndex, book.locations.length()) : null)
      latest.current.onPosition({
        cfi: next.start.cfi,
        ratio: latest.current.locationsReady && Number.isFinite(percentage) ? percentage : null,
      })
    }
    const hold = holdRef.current
    hold.report = report

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
        locationRef.current = next
        // Nouvelle page, peut-être nouveau chapitre ou nouvelle mise en page : la copie suit.
        turnerRef.current?.invalidate()
        // Feuille tenue au doigt : la page n'est pas encore décidée.
        if (hold.holding) hold.held = next
        else report(next)
      })
      rendition.on('rendered', (section: { index: number }, view: { contents?: Contents }) => {
        const body = view.contents?.document.body
        if (body) setWords((current) => ({ ...current, [section.index]: countWords(body.textContent ?? '') }))
        turnerRef.current?.invalidate()
      })

      // Tap : tiers gauche / droit pour tourner la page, centre pour les commandes.
      rendition.on('click', (event: MouseEvent) => {
        if ((event.target as Element | null)?.closest?.('a')) return
        const frame = (event.view as Window | null)?.frameElement
        const box = host.getBoundingClientRect()
        if (!frame) return
        const x = frame.getBoundingClientRect().left + event.clientX - box.left
        const action = tapAction(x, box.width, latest.current.direction)
        if (action === 'menu') latest.current.ui.toggleControls()
        else turnPage(action, cornerAt(event, event.view as Window | null, host))
      })

      // Geste dans l'iframe (`screenX` est commun aux deux documents) : la feuille suit le doigt.
      let touch: {
        x: number
        y: number
        corner: TurnCorner
        time: number
        grabbed: boolean
        tried: boolean
        lastX: number
        lastTime: number
        velocity: number
      } | null = null
      rendition.on('touchstart', (event: TouchEvent) => {
        ;(event.view as Window | null)?.getSelection()?.removeAllRanges()
        const point = event.changedTouches[0]
        const now = performance.now()
        touch = point
          ? {
              x: point.screenX,
              y: point.screenY,
              corner: cornerAt(point, event.view as Window | null, host),
              time: now,
              grabbed: false,
              tried: false,
              lastX: point.screenX,
              lastTime: now,
              velocity: 0,
            }
          : null
      })
      rendition.on('touchmove', (event: TouchEvent) => {
        const point = event.changedTouches[0]
        if (!touch || !point) return
        const now = performance.now()
        // Vitesse récente (lissée) : c'est l'élan au lâcher qui compte, pas la moyenne du geste.
        const step = ((point.screenX - touch.lastX) / Math.max(1, now - touch.lastTime)) * 1000
        touch.velocity = touch.velocity * 0.4 + step * 0.6
        touch.lastX = point.screenX
        touch.lastTime = now
        const dx = point.screenX - touch.x
        if (!touch.tried && Math.abs(dx) > GRAB_DISTANCE) {
          touch.tried = true
          // Sens occidental : pousser la page vers la gauche avance.
          touch.grabbed = turnerRef.current?.grab(dx < 0 ? 'next' : 'prev', touch.corner) ?? false
          if (touch.grabbed) latest.current.ui.hideControls()
        }
        if (touch.grabbed) turnerRef.current?.drag(dx, point.screenY - touch.y)
      })
      rendition.on('touchend', (event: TouchEvent) => {
        const point = event.changedTouches[0]
        const start = touch
        touch = null
        if (!point || !start) return
        const now = performance.now()
        if (start.grabbed) {
          turnerRef.current?.release(now - start.lastTime > STILL_MS ? 0 : start.velocity)
          return
        }
        // Feuille qui ne pouvait pas suivre le doigt (chapitre voisin…) : un swipe classique la tourne.
        const dx = point.screenX - start.x
        const velocity = (dx / Math.max(1, now - start.time)) * 1000
        const action = swipeAction(dx, latest.current.direction, velocity)
        if (!action) return
        latest.current.ui.hideControls()
        turnPage(action, start.corner)
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
        locationRef.current = current
        // Le pourcentage est enfin connu : la position courante le porte.
        report(current)
      }
    }

    const handleKey = (event: KeyboardEvent, cancelable = true) => {
      if (latest.current.ui.panel) return
      const action = keyAction(event.key, latest.current.direction, event.shiftKey)
      if (!action || !renditionRef.current) return
      if (cancelable) event.preventDefault()
      turnPage(action)
    }
    const onWindowKey = (event: KeyboardEvent) => handleKey(event)
    window.addEventListener('keydown', onWindowKey)

    open().catch(() => {
      if (!cancelled) setPhase('error')
    })

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onWindowKey)
      // Livre refermé : la feuille en l'air et les copies du chapitre ne valent plus.
      turnerRef.current?.reset()
      hold.holding = false
      hold.held = null
      hold.report = null
      locationRef.current = null
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
    turnerRef.current?.invalidate()
  }, [text, fontFaces])

  // Marges et taille d'écran : epub.js doit recalculer sa pagination.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (box && box.width > 0 && box.height > 0) {
        turnerRef.current?.finish()
        renditionRef.current?.resize(box.width, box.height)
        turnerRef.current?.invalidate()
      }
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  /* ---- Affichage --------------------------------------------------------- */

  const start = location?.start
  const sectionWords = start ? (words[start.index] ?? 0) : 0
  const minutes = start ? remainingMinutes(sectionWords, start.displayed.page, start.displayed.total) : 0
  const ratio = locationsReady && start && Number.isFinite(start.percentage) ? start.percentage : null
  const pageLabel = absolutePage ? t.reader.pageOf(absolutePage.page, absolutePage.total) : null

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
  /** Saut (sommaire, curseur, chapitre voisin) : une feuille encore en l'air se pose d'abord. */
  const jumpTo = (target: string) => {
    turnerRef.current?.finish()
    void renditionRef.current?.display(target)
  }
  const goSection = (step: 1 | -1) => {
    const book = bookRef.current
    if (!book || !start) return
    const section = book.spine.get(start.index + step) as { href?: string } | undefined
    if (section?.href) jumpTo(section.href)
  }

  const timeLeft = sectionWords > 0 ? t.reader.text.minutesLeft(minutes) : null
  // Commandes affichées : le curseur donne déjà le pourcentage, seul le temps restant s'ajoute.
  const controlsNote = phase !== 'ready' ? null : (timeLeft ?? (absolutePage === null ? t.reader.text.locating : null))
  // Commandes masquées : une ligne discrète, temps restant et page virtuelle absolue.
  const readingNote = [timeLeft, pageLabel].filter(Boolean).join(' · ')

  return (
    <div
      className="fixed inset-0 z-[100] select-none [-webkit-touch-callout:none]"
      onContextMenu={(event) => event.preventDefault()}
      style={{ background: theme.background, color: theme.color }}
    >
      {/* Scène de la page qui tourne : la vraie page, et les calques posés par `PageTurner`. */}
      <div ref={stageRef} className="absolute inset-0 overflow-hidden">
        {/* Cadre de découpe de la vraie page : elle se déplie quand on revient en arrière. */}
        <div ref={pageClipRef} className="absolute inset-0">
          <div ref={pageRef} className="absolute inset-0" style={{ background: theme.background }}>
            <div
              ref={hostRef}
              className="absolute top-[max(2rem,env(safe-area-inset-top))] bottom-10"
              style={{ left: text.margin, right: text.margin }}
            />
          </div>
        </div>
      </div>

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
        <ReadingProgressBar ratio={ratio} color={theme.link} label={pageLabel ?? t.reader.text.locating} />
      )}

      <ReaderStatus visible={showStatus && !ui.controls} tone={theme.dark ? 'light' : 'dark'} />

      <ReaderControls
        visible={ui.controls}
        title={source.title}
        subtitle={[currentTitle, pageLabel].filter(Boolean).join(' · ')}
        onClose={ui.close}
        onOpenContents={toc.length > 0 ? () => ui.setPanel('contents') : undefined}
        contentsLabel={t.reader.contents}
        onOpenSettings={() => ui.setPanel('settings')}
        slider={
          absolutePage !== null
            ? {
                value: absolutePage.page - 1,
                max: absolutePage.total - 1,
                valueText: pageLabel!,
                onChange: (value) => {
                  const cfi = bookRef.current?.locations.cfiFromLocation(value)
                  if (cfi) jumpTo(cfi)
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
          jumpTo(href)
        }}
        onClose={() => ui.setPanel(null)}
      />

      <ReaderSettings open={ui.panel === 'settings'} onClose={() => ui.setPanel(null)}>
        <SettingGroup label={t.reader.text.pageTurn} hint={t.reader.text.pageTurnHint}>
          <Choice
            label={t.reader.text.pageTurn}
            value={pageTurn}
            onChange={setPageTurn}
            options={(['book', 'instant'] as const).map((value) => ({ value, label: t.reader.text.pageTurns[value] }))}
          />
        </SettingGroup>
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
