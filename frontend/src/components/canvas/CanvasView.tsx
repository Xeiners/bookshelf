import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Lock, WifiOff } from 'lucide-react'
import { useT } from '../../i18n'
import { CanvasEngine } from '../../lib/canvas/engine'
import { getEngine, setEngine } from '../../lib/canvas/current'
import { isTouchDevice } from '../../lib/canvas/pointer'
import { useCanvasStore } from '../../store/useCanvasStore'
import { useUiStore } from '../../store/useUiStore'
import { ChevronLeft } from 'lucide-react'
import { BrushShopPanel } from './BrushShop'
import { ChatBar } from './ChatBar'
import { GalleryPanel } from './GalleryPanel'
import { ImagesPanel } from './ImagesPanel'
import { Minimap } from './Minimap'
import { ObjectPanel } from './ObjectPanel'
import { PeersPanel } from './PeersSheet'
import { QuickBar } from './QuickBar'
import { SeasonsPanel } from './SeasonsPanel'
import { StylePanel } from './StylePanel'
import { Toolbar } from './Toolbar'
import { ViewControls, type Panel } from './ViewControls'

/**
 * La Toile : un tableau presque infini, partagé en direct. Deux calques (le décor, puis ce qui
 * bouge : curseurs, aperçus, geste en cours) que pilote `CanvasEngine` ; tout autour, l'interface
 * (outils, style, vue, artistes en ligne, galerie, saisons, pinceaux), posée par-dessus sans jamais
 * gêner le dessin (`pointer-events-none` sauf sur les commandes).
 */
const DESKTOP = '(min-width: 768px)'
const subscribeDesktop = (notify: () => void) => {
  const query = window.matchMedia(DESKTOP)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}

/** Grand écran : outils à gauche, style à droite ; téléphone : tout en bas, sous le pouce. */
const useDesktop = () => useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => true)

export function CanvasView() {
  const t = useT()
  const desktop = useDesktop()
  const container = useRef<HTMLDivElement>(null)
  const base = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [gallerySeason, setGallerySeason] = useState<{ id: string; key: string } | null>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const openActivity = useUiStore((state) => state.openActivity)
  const status = useCanvasStore((state) => state.status)
  const me = useCanvasStore((state) => state.me)
  const notice = useCanvasStore((state) => state.notice)
  const tool = useCanvasStore((state) => state.tool)
  const hint = t.canvas.hints[tool]

  useEffect(() => {
    if (!container.current || !base.current || !overlay.current) return
    const engine = new CanvasEngine(container.current, base.current, overlay.current)
    setEngine(engine)
    // Pour les essais dans le navigateur (comme `__mangaRunner` du Runner), jamais en production.
    if (import.meta.env?.DEV) (window as unknown as { __canvasEngine?: CanvasEngine }).__canvasEngine = engine
    engine.start()
    return () => {
      engine.dispose()
      setEngine(null)
    }
  }, [])

  // Une notification mène à un cadre : la caméra y vole dès que la toile est prête.
  useEffect(() => {
    const target = useCanvasStore.getState().pendingTarget
    if (!target || status !== 'open') return
    useCanvasStore.setState({ pendingTarget: null })
    getEngine()?.flyTo(target.x, target.y, 0.7)
  }, [status])

  // Au doigt : un mot, une seule fois, sur la façon de dessiner et de déplacer la toile.
  useEffect(() => {
    if (status !== 'open' || !isTouchDevice()) return
    try {
      if (localStorage.getItem('bookshelf.canvas.touchHint')) return
      localStorage.setItem('bookshelf.canvas.touchHint', '1')
    } catch {
      return
    }
    useCanvasStore.getState().notify('touch_hint', 'info')
  }, [status])

  // Les avis (erreurs, informations) disparaissent seuls.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => useCanvasStore.setState((state) => (state.notice?.id === notice.id ? { notice: null } : {})), notice.code === 'touch_hint' ? 6500 : 4200)
    return () => clearTimeout(timer)
  }, [notice])

  const minutes = me ? Math.max(1, Math.ceil(me.waitMs / 60_000)) : 0
  const side = panel === 'peers' ? <PeersPanel onClose={() => setPanel(null)} /> : panel === 'gallery' ? <GalleryPanel season={gallerySeason} onClose={() => setPanel(null)} /> : panel === 'seasons' ? <SeasonsPanel onClose={() => setPanel(null)} onGallery={(season) => { setGallerySeason(season); setPanel('gallery') }} /> : panel === 'brushes' ? <BrushShopPanel onClose={() => setPanel(null)} /> : panel === 'images' ? <ImagesPanel onClose={() => setPanel(null)} /> : null

  // Portail sur `body` : les écrans des Activités glissent (transform), ce qui piégerait un `fixed`.
  return createPortal(
    <div className="fixed inset-0 z-[85] flex flex-col overflow-hidden bg-[#fbf8f2] select-none [-webkit-touch-callout:none]" data-canvas-root>
      <div ref={container} className="absolute inset-0 touch-none select-none">
        <canvas ref={base} className="absolute inset-0 size-full" aria-hidden />
        <canvas ref={overlay} tabIndex={0} className="absolute inset-0 size-full touch-none outline-none" aria-label={t.canvas.title} />
      </div>

      {/* Haut : retour, état, vue. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 px-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => openActivity('hub')} className="glass pointer-events-auto inline-flex h-9 items-center gap-1 rounded-full pr-3.5 pl-2 text-sm font-semibold text-cream shadow-[0_2px_12px_rgba(0,0,0,0.35)] active:scale-[0.97]">
            <ChevronLeft size={18} strokeWidth={2.5} aria-hidden />
            {t.canvas.back}
          </button>
          {status !== 'open' && (
            <span className="glass pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-gold">
              {status === 'connecting' ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <WifiOff size={13} aria-hidden />}
              {status === 'connecting' ? t.canvas.status.connecting : t.canvas.status.offline}
            </span>
          )}
        </div>
        <ViewControls panel={panel} onPanel={setPanel} />
      </div>

      {me && !me.draw && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] flex justify-center px-3 max-md:top-[max(6rem,calc(env(safe-area-inset-top)+5.5rem))]">
          <p className="glass pointer-events-auto flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-semibold text-gold shadow-lg">
            <Lock size={14} aria-hidden />
            {me.reason === 'banned' ? t.canvas.banned : t.canvas.young(minutes)}
          </p>
        </div>
      )}

      {notice && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(6rem,calc(env(safe-area-inset-top)+5.5rem))] flex justify-center px-3 max-md:top-[max(9rem,calc(env(safe-area-inset-top)+8.5rem))]" role="status" aria-live="polite">
          <p key={notice.id} className={`rounded-full px-4 py-2 text-xs font-semibold shadow-xl ${notice.kind === 'info' ? 'bg-glow text-white' : 'bg-nope text-white'}`}>
            {t.canvas.errors[notice.code] ?? t.canvas.errors.unknown}
          </p>
        </div>
      )}

      {desktop ? (
        <>
          {/* Gauche : outils. */}
          <div className="pointer-events-none absolute top-[max(3.75rem,calc(env(safe-area-inset-top)+3.25rem))] bottom-14 left-2.5 flex items-center">
            <Toolbar />
          </div>

          {/* Droite : objet choisi, puis panneau ou style. */}
          <div className="pointer-events-none absolute top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] right-2.5 bottom-24 flex w-[20.5rem] flex-col items-end gap-2.5 overflow-hidden">
            <ObjectPanel />
            {side ?? (
              <div className="flex min-h-0 flex-1 flex-col justify-start">
                <StylePanel onShop={() => setPanel('brushes')} />
              </div>
            )}
          </div>

          {/* Bas : indice de l'outil, bulle, mini-carte. */}
          <div className="pointer-events-none absolute right-2.5 bottom-2.5 left-[4.25rem] flex items-end justify-between gap-3">
            <p className="glass pointer-events-auto max-w-md rounded-2xl px-3.5 py-2 text-[11px] leading-snug text-cream/80">{hint}</p>
            <div className="ml-auto flex items-end gap-2">
              <ChatBar />
              <Minimap />
            </div>
          </div>
        </>
      ) : (
        /* Téléphone : tout en bas, à portée du pouce : bulle, panneau ou style, couleurs rapides, outils. */
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex justify-end">
            <ChatBar />
          </div>
          <ObjectPanel />
          {side ?? (styleOpen && <div className="max-h-[44svh] overflow-y-auto overscroll-contain rounded-2xl"><StylePanel onShop={() => setPanel('brushes')} /></div>)}
          {!side && !styleOpen && <QuickBar />}
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <Toolbar />
            </div>
            <button type="button" aria-pressed={styleOpen} onClick={() => setStyleOpen((state) => !state)} className={`glass pointer-events-auto grid h-14 shrink-0 place-items-center rounded-full px-4 text-xs font-bold ${styleOpen ? 'bg-glow text-white' : 'text-cream'}`}>
              <span className="flex items-center gap-1.5">
                <StyleDot />
                {t.canvas.style.open}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

/** La couleur d'encre courante, en pastille. */
function StyleDot() {
  const ink = useCanvasStore((state) => state.ink)
  return <span className="size-4 rounded-full border border-white/50" style={{ background: ink }} aria-hidden />
}
