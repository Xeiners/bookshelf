import { useState } from 'react'
import { CalendarDays, Download, ImagePlus, Maximize, MoreHorizontal, Palette, Trophy, Users, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useT } from '../../i18n'
import { getEngine } from '../../lib/canvas/current'
import { useCanvasStore } from '../../store/useCanvasStore'
import { useUiStore } from '../../store/useUiStore'

export type Panel = 'peers' | 'gallery' | 'seasons' | 'brushes' | 'images' | null

const round = 'glass grid size-9 place-items-center rounded-full text-cream/80 transition-colors hover:text-cream active:scale-95' // i18n-ignore : classes CSS

/**
 * Zoom, vue d'ensemble, artistes en ligne, galerie, saisons, pinceaux, images, enregistrement.
 * Sur ordinateur : une rangée de boutons. Sur téléphone : le zoom, les artistes, et un menu « … »
 * qui range le reste (le haut de l'écran reste libre pour dessiner).
 */
export function ViewControls({ panel, onPanel }: { panel: Panel; onPanel: (panel: Panel) => void }) {
  const t = useT()
  const [menu, setMenu] = useState(false)
  const zoom = useCanvasStore((state) => state.zoom)
  const mode = useCanvasStore((state) => state.mode)
  const peers = useCanvasStore((state) => Object.keys(state.peers).length)
  const refs = useCanvasStore((state) => state.refs.length)
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

  const toggle = (name: Exclude<Panel, null>) => {
    setMenu(false)
    onPanel(panel === name ? null : name)
  }

  const items: { id: Exclude<Panel, null> | 'fit' | 'save'; label: string; icon: typeof Trophy; badge?: number }[] = [
    { id: 'images', label: t.canvas.images.title, icon: ImagePlus, badge: refs },
    { id: 'gallery', label: t.canvas.gallery.title, icon: Trophy },
    { id: 'seasons', label: t.canvas.seasons.title, icon: CalendarDays },
    { id: 'brushes', label: t.canvas.brushShop.title, icon: Palette },
    { id: 'fit', label: t.canvas.view.fit, icon: Maximize },
    { id: 'save', label: t.canvas.view.export, icon: Download },
  ]
  const run = (id: (typeof items)[number]['id']) => {
    if (id === 'fit') {
      setMenu(false)
      getEngine()?.fit()
    } else if (id === 'save') {
      setMenu(false)
      void save()
    } else toggle(id)
  }

  return (
    <div className="pointer-events-auto relative flex items-center justify-end gap-1.5">
      <div className="glass flex items-center gap-0.5 rounded-full p-0.5">
        <button type="button" title={t.canvas.view.zoomOut} aria-label={t.canvas.view.zoomOut} onClick={() => getEngine()?.zoomBy(1 / 1.5)} className="grid size-9 place-items-center rounded-full text-cream/80 active:scale-95 md:size-8">
          <ZoomOut size={16} aria-hidden />
        </button>
        <button type="button" title={t.canvas.view.reset} onClick={() => getEngine()?.resetZoom()} className="min-w-[3.2rem] rounded-full px-1 text-center font-mono text-[11px] font-semibold text-cream tabular-nums">
          {t.canvas.view.zoom(zoom * 100)}
        </button>
        <button type="button" title={t.canvas.view.zoomIn} aria-label={t.canvas.view.zoomIn} onClick={() => getEngine()?.zoomBy(1.5)} className="grid size-9 place-items-center rounded-full text-cream/80 active:scale-95 md:size-8">
          <ZoomIn size={16} aria-hidden />
        </button>
      </div>
      <button type="button" title={t.canvas.peers.title} aria-label={t.canvas.peers.title} aria-pressed={panel === 'peers'} onClick={() => toggle('peers')} className={`${round} relative ${panel === 'peers' ? 'bg-glow text-white' : ''}`}>
        <Users size={16} aria-hidden />
        {peers > 0 && <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-like px-1 text-[9px] leading-4 font-bold text-void">{peers + 1}</span>}
      </button>

      {/* Ordinateur : tout à plat. */}
      <div className="flex items-center gap-1.5 max-md:hidden">
        {items.map(({ id, label, icon: Icon, badge }) => {
          const active = id === panel
          return (
            <button key={id} type="button" title={label} aria-label={label} aria-pressed={id === 'fit' || id === 'save' ? undefined : active} onClick={() => run(id)} className={`${round} relative ${active ? 'bg-glow text-white' : ''}`}>
              <Icon size={16} aria-hidden />
              {badge ? <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-gold px-1 text-[9px] leading-4 font-bold text-void">{badge}</span> : null}
            </button>
          )
        })}
        {mode === 'tiles' && <span className="glass rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide text-gold uppercase">{t.canvas.view.tiles}</span>}
      </div>

      {/* Téléphone : un menu. */}
      <button type="button" title={t.canvas.view.more} aria-label={t.canvas.view.more} aria-expanded={menu} onClick={() => setMenu((state) => !state)} className={`${round} md:hidden ${menu ? 'bg-glow text-white' : ''}`}>
        {menu ? <X size={17} aria-hidden /> : <MoreHorizontal size={17} aria-hidden />}
      </button>
      {menu && (
        <div role="menu" aria-label={t.canvas.view.more} className="glass absolute top-11 right-0 z-10 grid w-60 grid-cols-2 gap-1.5 rounded-2xl p-2 shadow-[0_10px_30px_rgba(0,0,0,0.55)] md:hidden">
          {items.map(({ id, label, icon: Icon, badge }) => (
            <button key={id} type="button" role="menuitem" onClick={() => run(id)} className="relative flex min-h-12 items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2 text-left text-[12px] leading-tight font-semibold text-cream/90 active:scale-95">
              <Icon size={16} className="shrink-0" aria-hidden />
              {label}
              {badge ? <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-gold px-1 text-[9px] leading-4 font-bold text-void">{badge}</span> : null}
            </button>
          ))}
        </div>
      )}
      {mode === 'tiles' && <span className="glass absolute top-11 right-0 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide text-gold uppercase md:hidden">{t.canvas.view.tiles}</span>}
    </div>
  )
}
