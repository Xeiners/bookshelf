import { useRef, type ReactNode } from 'react'
import {
  ArrowLeft,
  BatteryCharging,
  BatteryMedium,
  ChevronLeft,
  ChevronRight,
  Columns2,
  List,
  Maximize,
  Minimize,
  Rows3,
  Settings2,
} from 'lucide-react'
import { useDeviceStatus, useFullscreen } from '../../hooks/reader/useReaderEnvironment'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import type { ReaderLayout } from '../../types/reader'
import { Pressable } from '../ui/Pressable'

export interface ReaderSlider {
  value: number
  max: number
  /** Texte lu par les lecteurs d'écran et affiché à droite (« Page 3 / 20 »). */
  valueText: string
  onChange: (value: number) => void
}

export interface ChapterStep {
  label: string
  go: () => void
}

interface ReaderControlsProps {
  visible: boolean
  title: string
  subtitle?: string | null
  onClose: () => void
  onOpenContents?: () => void
  contentsLabel?: string
  onOpenSettings: () => void
  slider?: ReaderSlider | null
  prev?: ChapterStep | null
  next?: ChapterStep | null
  /** Bascule webtoon ⇄ pages, en un tap. */
  layout?: { current: ReaderLayout; onToggle: () => void } | null
  /** Ligne d'information sous le curseur (temps restant, zoom…). */
  footnote?: ReactNode
  /** Boutons supplémentaires du pied de page (zoom du PDF…). */
  tools?: ReactNode
}

/**
 * Commandes du lecteur, en surimpression : en-tête (retour, titre, sommaire,
 * réglages) et pied de page (curseur, chapitres, mode). Elles glissent hors de
 * l'écran quand on lit : un tap au centre les rappelle.
 */
export function ReaderControls({
  visible,
  title,
  subtitle,
  onClose,
  onOpenContents,
  contentsLabel,
  onOpenSettings,
  slider,
  prev,
  next,
  layout,
  footnote,
  tools,
}: ReaderControlsProps) {
  const t = useT()
  const fullscreen = useFullscreen()
  const headerRef = useRef<HTMLElement>(null)
  const footerRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      // `autoAlpha` : masquées, les commandes sortent aussi de l'ordre de tabulation.
      gsap.to(headerRef.current, { yPercent: visible ? 0 : -110, autoAlpha: visible ? 1 : 0, duration: 0.34, ease: visible ? EASE.swift : EASE.exit, overwrite: 'auto' })
      gsap.to(footerRef.current, { yPercent: visible ? 0 : 110, autoAlpha: visible ? 1 : 0, duration: 0.34, ease: visible ? EASE.swift : EASE.exit, overwrite: 'auto' })
    },
    { dependencies: [visible] },
  )

  // Pas de chapitres (fichier isolé, PDF) : pas de boutons de chapitre du tout.
  const chapterNav = prev !== undefined || next !== undefined
  const layoutTarget: ReaderLayout | null = layout ? (layout.current === 'webtoon' ? 'paged' : 'webtoon') : null

  return (
    <>
      <header
        ref={headerRef}
        className="pointer-events-auto absolute inset-x-0 top-0 z-20 border-b border-white/10 bg-black/90 pt-safe"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 pb-2.5 pt-1 md:pt-3">
          <Pressable
            onClick={onClose}
            aria-label={t.reader.close}
            className="grid size-10 shrink-0 place-items-center rounded-full text-cream/85 hover:bg-white/10"
          >
            <ArrowLeft size={20} />
          </Pressable>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-cream">{title}</p>
            {subtitle && <p className="truncate text-[11px] text-mist">{subtitle}</p>}
          </div>
          {fullscreen.supported && (
            <Pressable
              onClick={fullscreen.toggle}
              aria-label={fullscreen.active ? t.reader.exitFullscreen : t.reader.fullscreen}
              className="hidden size-10 shrink-0 place-items-center rounded-full text-cream/75 hover:bg-white/10 sm:grid"
            >
              {fullscreen.active ? <Minimize size={18} /> : <Maximize size={18} />}
            </Pressable>
          )}
          {onOpenContents && (
            <Pressable
              onClick={onOpenContents}
              aria-label={contentsLabel ?? t.reader.openChapters}
              className="grid size-10 shrink-0 place-items-center rounded-full text-cream/75 hover:bg-white/10"
            >
              <List size={19} />
            </Pressable>
          )}
          <Pressable
            onClick={onOpenSettings}
            aria-label={t.reader.settings}
            className="grid size-10 shrink-0 place-items-center rounded-full text-cream/75 hover:bg-white/10"
          >
            <Settings2 size={19} />
          </Pressable>
        </div>
      </header>

      <footer
        ref={footerRef}
        className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 border-t border-white/10 bg-black/90 pb-safe"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 pt-3">
          {slider && slider.max > 0 && (
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={slider.max}
                step={1}
                value={Math.min(slider.value, slider.max)}
                onChange={(event) => slider.onChange(Number(event.target.value))}
                aria-label={t.reader.progressLabel}
                aria-valuetext={slider.valueText}
                className="h-6 min-w-0 flex-1 cursor-pointer accent-gold"
              />
              <span className="shrink-0 text-[11px] text-mist tabular-nums">{slider.valueText}</span>
            </div>
          )}
          {footnote && <div className="text-center text-[11px] text-mist">{footnote}</div>}

          <div className={`flex items-center gap-2 ${chapterNav ? '' : 'justify-center'}`}>
            {chapterNav && (
              <Pressable
                onClick={() => prev?.go()}
                disabled={!prev}
                aria-label={prev?.label ?? t.reader.prevChapter}
                className="flex h-10 min-w-0 flex-1 items-center gap-1 rounded-full px-3 text-xs text-cream/80 hover:bg-white/10 disabled:opacity-30"
              >
                <ChevronLeft size={16} className="shrink-0" />
                <span className="truncate">{t.reader.prevChapter}</span>
              </Pressable>
            )}

            {tools}

            {layout && layoutTarget && (
              <Pressable
                onClick={layout.onToggle}
                aria-label={t.reader.switchLayout(t.reader.layouts[layoutTarget])}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-4 text-xs text-cream"
              >
                {layoutTarget === 'webtoon' ? <Rows3 size={15} /> : <Columns2 size={15} />}
                {t.reader.layouts[layoutTarget]}
              </Pressable>
            )}

            {chapterNav && (
              <Pressable
                onClick={() => next?.go()}
                disabled={!next}
                aria-label={next?.label ?? t.reader.nextChapter}
                className="flex h-10 min-w-0 flex-1 items-center justify-end gap-1 rounded-full px-3 text-xs text-cream/80 hover:bg-white/10 disabled:opacity-30"
              >
                <span className="truncate">{t.reader.nextChapter}</span>
                <ChevronRight size={16} className="shrink-0" />
              </Pressable>
            )}
          </div>
        </div>
      </footer>
    </>
  )
}

/** Heure et batterie, discrètes, quand les commandes sont masquées. */
export function ReaderStatus({ visible, tone = 'light' }: { visible: boolean; tone?: 'light' | 'dark' }) {
  const t = useT()
  const status = useDeviceStatus(t.locale, visible)
  if (!status) return null
  const BatteryIcon = status.charging ? BatteryCharging : BatteryMedium
  return (
    <div
      aria-hidden
      // Pastille à peine teintée : lisible sur une page blanche comme sur une page noire.
      className={`pointer-events-none absolute right-2 z-10 flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] tabular-nums ${
        tone === 'light' ? 'bg-black/45 text-white/70' : 'bg-white/45 text-black/60'
      }`}
      style={{ top: 'max(0.4rem, env(safe-area-inset-top))' }}
    >
      <span>{status.time}</span>
      {status.battery !== null && (
        <span className="flex items-center gap-0.5" title={t.reader.battery(status.battery)}>
          <BatteryIcon size={12} />
          {status.battery}
        </span>
      )}
    </div>
  )
}
