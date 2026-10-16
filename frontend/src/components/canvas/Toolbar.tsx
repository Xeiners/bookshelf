import { ArrowUpRight, Brush, Circle, Eraser, Frame, Hand, Heart, Minus, MousePointer2, Pentagon, PenTool, Pipette, Redo2, Square, Type, Undo2, type LucideIcon } from 'lucide-react'
import { useT } from '../../i18n'
import { getEngine } from '../../lib/canvas/current'
import type { ToolId } from '../../lib/canvas/types'
import { vibrate } from '../../lib/haptics'
import { useCanvasStore } from '../../store/useCanvasStore'

const TOOLS: { id: ToolId; icon: LucideIcon; key: string }[] = [
  { id: 'select', icon: MousePointer2, key: 'V' },
  { id: 'hand', icon: Hand, key: 'H' },
  { id: 'pen', icon: Brush, key: 'B' },
  { id: 'eraser', icon: Eraser, key: 'E' },
  { id: 'rect', icon: Square, key: 'R' },
  { id: 'ellipse', icon: Circle, key: 'O' },
  { id: 'line', icon: Minus, key: 'L' },
  { id: 'arrow', icon: ArrowUpRight, key: 'A' },
  { id: 'polygon', icon: Pentagon, key: 'G' },
  { id: 'bezier', icon: PenTool, key: 'P' },
  { id: 'text', icon: Type, key: 'T' },
  { id: 'frame', icon: Frame, key: 'F' },
  { id: 'pick', icon: Pipette, key: 'I' },
  { id: 'heart', icon: Heart, key: 'K' },
]

/**
 * Les outils : une colonne à gauche sur ordinateur, une rangée qui défile en bas sur téléphone.
 * Annuler / rétablir en tête. Un outil actif est clairement allumé ; chacun a son raccourci.
 */
export function Toolbar() {
  const t = useT()
  const tool = useCanvasStore((state) => state.tool)
  const canUndo = useCanvasStore((state) => state.canUndo)
  const canRedo = useCanvasStore((state) => state.canRedo)
  const setTool = useCanvasStore((state) => state.setTool)

  return (
    <div role="toolbar" aria-label={t.canvas.toolbar} aria-orientation="vertical" className="glass no-scrollbar pointer-events-auto flex gap-1 rounded-2xl p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.45)] max-md:max-w-full max-md:overflow-x-auto max-md:rounded-full max-md:px-2 md:max-h-full md:flex-col md:overflow-y-auto md:rounded-3xl">
      <div className="flex gap-1 md:flex-col">
        <ActionButton label={t.canvas.history.undo} shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => getEngine()?.undo()}>
          <Undo2 size={18} aria-hidden />
        </ActionButton>
        <ActionButton label={t.canvas.history.redo} shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={() => getEngine()?.redo()}>
          <Redo2 size={18} aria-hidden />
        </ActionButton>
      </div>
      <span aria-hidden className="mx-0.5 w-px shrink-0 self-stretch bg-white/10 md:mx-0 md:my-0.5 md:h-px md:w-auto md:self-auto" />
      {TOOLS.map(({ id, icon: Icon, key }) => {
        const active = tool === id
        return (
          <button
            key={id}
            type="button"
            title={`${t.canvas.tools[id]} (${key})`}
            aria-label={t.canvas.tools[id]}
            aria-pressed={active}
            onClick={() => {
              vibrate(4)
              setTool(id)
            }}
            className={`grid size-9 shrink-0 place-items-center rounded-xl transition-colors active:scale-95 md:size-9 ${active ? 'bg-glow text-white shadow-[0_0_16px_-2px_rgba(124,92,255,0.9)]' : id === 'heart' ? 'text-nope/90 hover:bg-white/10' : 'text-cream/75 hover:bg-white/10'}`}
          >
            <Icon size={19} strokeWidth={active ? 2.4 : 2} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}

function ActionButton({ label, shortcut, disabled, onClick, children }: { label: string; shortcut: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={`${label} (${shortcut})`} aria-label={label} disabled={disabled} onClick={onClick} className="grid size-9 shrink-0 place-items-center rounded-xl text-cream/75 transition-colors hover:bg-white/10 active:scale-95 disabled:opacity-30">
      {children}
    </button>
  )
}
