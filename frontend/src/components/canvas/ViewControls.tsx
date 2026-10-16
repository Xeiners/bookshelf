import { CalendarDays, Download, Maximize, Palette, Trophy, Users, ZoomIn, ZoomOut } from 'lucide-react'
import { useT } from '../../i18n'
import { getEngine } from '../../lib/canvas/current'
import { useCanvasStore } from '../../store/useCanvasStore'
import { useUiStore } from '../../store/useUiStore'

export type Panel = 'peers' | 'gallery' | 'seasons' | 'brushes' | null

const round = 'glass grid size-9 place-items-center rounded-full text-cream/80 transition-colors hover:text-cream active:scale-95' // i18n-ignore : classes CSS

/** Zoom, vue d'ensemble, artistes en ligne, galerie, saisons, pinceaux, enregistrement. */
export function ViewControls({ panel, onPanel }: { panel: Panel; onPanel: (panel: Panel) => void }) {
  const t = useT()
  const zoom = useCanvasStore((state) => state.zoom)
  const mode = useCanvasStore((state) => state.mode)
  const peers = useCanvasStore((state) => Object.keys(state.peers).length)
  const notify = useUiStore((state) => state.notify)

  const save = async () => {
    const blob = await getEngine()?.exportPng()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `toile-${new Date().toISOString().slice(0, 10)}.png`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    notify(t.canvas.view.export, 'like')
  }

  const toggle = (name: Exclude<Panel, null>) => onPanel(panel === name ? null : name)

  return (
    <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
      <div className="glass flex items-center gap-0.5 rounded-full p-0.5">
        <button type="button" title={t.canvas.view.zoomOut} aria-label={t.canvas.view.zoomOut} onClick={() => getEngine()?.zoomBy(1 / 1.5)} className="grid size-8 place-items-center rounded-full text-cream/80 active:scale-95">
          <ZoomOut size={16} aria-hidden />
        </button>
        <button type="button" title={t.canvas.view.reset} onClick={() => getEngine()?.resetZoom()} className="min-w-[3.2rem] rounded-full px-1 text-center font-mono text-[11px] font-semibold text-cream tabular-nums">
          {t.canvas.view.zoom(zoom * 100)}
        </button>
        <button type="button" title={t.canvas.view.zoomIn} aria-label={t.canvas.view.zoomIn} onClick={() => getEngine()?.zoomBy(1.5)} className="grid size-8 place-items-center rounded-full text-cream/80 active:scale-95">
          <ZoomIn size={16} aria-hidden />
        </button>
      </div>
      <button type="button" title={t.canvas.view.fit} aria-label={t.canvas.view.fit} onClick={() => getEngine()?.fit()} className={round}>
        <Maximize size={16} aria-hidden />
      </button>
      <button type="button" title={t.canvas.peers.title} aria-label={t.canvas.peers.title} aria-pressed={panel === 'peers'} onClick={() => toggle('peers')} className={`${round} relative ${panel === 'peers' ? 'bg-glow text-white' : ''}`}>
        <Users size={16} aria-hidden />
        {peers > 0 && <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-like px-1 text-[9px] leading-4 font-bold text-void">{peers + 1}</span>}
      </button>
      <button type="button" title={t.canvas.gallery.title} aria-label={t.canvas.gallery.title} aria-pressed={panel === 'gallery'} onClick={() => toggle('gallery')} className={`${round} ${panel === 'gallery' ? 'bg-glow text-white' : ''}`}>
        <Trophy size={16} aria-hidden />
      </button>
      <button type="button" title={t.canvas.seasons.title} aria-label={t.canvas.seasons.title} aria-pressed={panel === 'seasons'} onClick={() => toggle('seasons')} className={`${round} ${panel === 'seasons' ? 'bg-glow text-white' : ''}`}>
        <CalendarDays size={16} aria-hidden />
      </button>
      <button type="button" title={t.canvas.brushShop.title} aria-label={t.canvas.brushShop.title} aria-pressed={panel === 'brushes'} onClick={() => toggle('brushes')} className={`${round} ${panel === 'brushes' ? 'bg-glow text-white' : ''}`}>
        <Palette size={16} aria-hidden />
      </button>
      <button type="button" title={t.canvas.view.export} aria-label={t.canvas.view.export} onClick={() => void save()} className={`${round} max-md:hidden`}>
        <Download size={16} aria-hidden />
      </button>
      {mode === 'tiles' && <span className="glass rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide text-gold uppercase">{t.canvas.view.tiles}</span>}
    </div>
  )
}
