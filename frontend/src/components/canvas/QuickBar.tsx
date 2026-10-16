import { Minus, Plus } from 'lucide-react'
import { useT } from '../../i18n'
import { getEngine } from '../../lib/canvas/current'
import { PALETTE } from '../../lib/canvas/color'
import type { ToolId } from '../../lib/canvas/types'
import { useCanvasStore } from '../../store/useCanvasStore'

/** Les outils qui dessinent avec une couleur et une épaisseur. */
const INKED: ToolId[] = ['pen', 'rect', 'ellipse', 'line', 'arrow', 'polygon', 'bezier', 'text']

/** Sur téléphone : de quoi changer de couleur et d'épaisseur d'un pouce, sans ouvrir le panneau de style. */
export function QuickBar() {
  const t = useT()
  const tool = useCanvasStore((state) => state.tool)
  const ink = useCanvasStore((state) => state.ink)
  const width = useCanvasStore((state) => state.width)
  const recent = useCanvasStore((state) => state.recent)
  const setStyle = useCanvasStore((state) => state.setStyle)
  const pushRecent = useCanvasStore((state) => state.pushRecent)
  const selected = useCanvasStore((state) => state.selection.length > 0)
  if (!INKED.includes(tool) && !(tool === 'select' && selected)) return null

  const colors = [...new Set([ink, ...recent, ...PALETTE.slice(0, 12)])].slice(0, 9)
  const pick = (color: string) => {
    pushRecent(color)
    setStyle({ ink: color })
    if (tool === 'select') getEngine()?.restyleSelection({ c: color })
  }
  const size = (delta: number) => {
    const next = Math.min(80, Math.max(0.5, width < 6 ? width + delta * 0.5 : width * (delta > 0 ? 1.25 : 0.8)))
    const rounded = Math.round(next * 2) / 2
    setStyle({ width: rounded })
    if (tool === 'select') getEngine()?.restyleSelection({ sw: rounded })
  }

  return (
    <div className="glass pointer-events-auto flex items-center gap-2 rounded-full px-2 py-1.5 shadow-[0_6px_20px_rgba(0,0,0,0.45)] md:hidden">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" role="group" aria-label={t.canvas.style.ink}>
        {colors.map((color) => (
          <button key={color} type="button" aria-label={color} aria-pressed={color === ink} onClick={() => pick(color)} className={`size-8 shrink-0 rounded-full border transition-transform active:scale-90 ${color === ink ? 'scale-110 border-white ring-2 ring-glow' : 'border-white/30'}`} style={{ background: color }} />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-l border-white/10 pl-2" role="group" aria-label={t.canvas.style.width}>
        <button type="button" aria-label={`${t.canvas.style.width} −`} onClick={() => size(-1)} className="grid size-8 place-items-center rounded-full bg-white/[0.08] text-cream active:scale-90">
          <Minus size={14} aria-hidden />
        </button>
        <span className="min-w-6 text-center font-mono text-[11px] text-cream tabular-nums">{width}</span>
        <button type="button" aria-label={`${t.canvas.style.width} +`} onClick={() => size(1)} className="grid size-8 place-items-center rounded-full bg-white/[0.08] text-cream active:scale-90">
          <Plus size={14} aria-hidden />
        </button>
      </div>
    </div>
  )
}
