import { AlignCenter, AlignLeft, AlignRight, BringToFront, Copy, Lock, SendToBack, Trash2 } from 'lucide-react'
import { useT } from '../../i18n'
import { getEngine } from '../../lib/canvas/current'
import type { ToolId } from '../../lib/canvas/types'
import { useCanvasStore, type Style } from '../../store/useCanvasStore'
import { ColorPicker } from './ColorPicker'

/*
 * Le style : couleur du trait, remplissage, épaisseur, opacité, pointillés, coins, pinceau, texte.
 * N'apparaît que ce qui sert à l'outil (ou aux objets sélectionnés) ; avec l'outil Sélection, un
 * réglage change aussitôt les objets sélectionnés.
 */

type Section = 'ink' | 'fill' | 'width' | 'opacity' | 'dash' | 'radius' | 'brush' | 'text'

const SECTIONS: Partial<Record<ToolId, Section[]>> = {
  pen: ['brush', 'ink', 'width', 'opacity'],
  rect: ['ink', 'fill', 'width', 'opacity', 'dash', 'radius'],
  ellipse: ['ink', 'fill', 'width', 'opacity', 'dash'],
  line: ['ink', 'width', 'opacity', 'dash'],
  arrow: ['ink', 'width', 'opacity', 'dash'],
  polygon: ['ink', 'fill', 'width', 'opacity', 'dash'],
  bezier: ['ink', 'fill', 'width', 'opacity', 'dash'],
  text: ['text', 'ink', 'opacity'],
}

/** Ce que les objets sélectionnés permettent de régler. */
function sectionsOfSelection(types: readonly string[]): Section[] {
  const has = (...kinds: string[]) => types.some((type) => kinds.includes(type))
  const result: Section[] = []
  if (has('s', 'r', 'e', 'l', 'a', 'g', 'b', 'x', 'f')) result.push('ink')
  if (has('r', 'e', 'g', 'b', 'f')) result.push('fill')
  if (has('s', 'r', 'e', 'l', 'a', 'g', 'b')) result.push('width')
  if (has('s', 'r', 'e', 'l', 'a', 'g', 'b', 'x')) result.push('opacity')
  if (has('r', 'e', 'l', 'a', 'g', 'b')) result.push('dash')
  if (has('r')) result.push('radius')
  if (has('s')) result.push('brush')
  if (has('x')) result.push('text')
  return result
}

export function StylePanel({ onShop }: { onShop: () => void }) {
  const t = useT()
  const state = useCanvasStore()
  const { tool, selection, setStyle, pushRecent } = state
  const engine = getEngine()
  const editable = selection.filter((id) => {
    const object = engine?.scene.get(id)
    return object && (object.owner === state.me?.userId || state.me?.admin)
  })
  const types = editable.map((id) => engine!.scene.get(id)!.data.t)
  const bySelection = tool === 'select' && editable.length > 0
  const sections = bySelection ? sectionsOfSelection(types) : (SECTIONS[tool] ?? [])
  if (sections.length === 0 && editable.length === 0) return null

  /** Règle un style : valeur par défaut, et — avec la Sélection — objets sélectionnés. */
  const apply = (patch: Partial<Style>, objects: Record<string, unknown> = {}) => {
    setStyle(patch)
    if (bySelection) engine?.restyleSelection(objects)
  }
  const pickInk = (color: string) => {
    pushRecent(color)
    apply({ ink: color }, { c: color })
  }
  const pickFill = (color: string) => {
    pushRecent(color)
    apply({ fill: color, fillOn: true }, { f: color })
  }

  const has = (section: Section) => sections.includes(section)

  return (
    <div className="glass pointer-events-auto flex max-h-full w-[15.5rem] flex-col gap-3 overflow-y-auto overscroll-contain rounded-3xl p-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.45)] no-scrollbar max-md:w-full max-md:rounded-2xl">
      {has('brush') && (
        <Block title={t.canvas.style.brush}>
          <BrushPicker onShop={onShop} apply={apply} />
        </Block>
      )}
      {has('ink') && (
        <Block title={t.canvas.style.ink}>
          <ColorPicker value={state.ink} recent={state.recent} onChange={pickInk} />
        </Block>
      )}
      {has('fill') && (
        <Block
          title={t.canvas.style.fill}
          aside={
            <label className="flex items-center gap-1.5 text-[10px] text-mist">
              <input type="checkbox" checked={state.fillOn} onChange={(event) => apply({ fillOn: event.target.checked }, { f: event.target.checked ? state.fill : null })} className="accent-glow" />
              {t.canvas.style.fill}
            </label>
          }
        >
          {state.fillOn ? <ColorPicker value={state.fill} recent={state.recent} onChange={pickFill} /> : <p className="text-[11px] text-mist">{t.canvas.style.noFill}</p>}
        </Block>
      )}
      {has('width') && <Range label={t.canvas.style.width} min={0.5} max={tool === 'pen' || types.includes('s') ? 80 : 40} step={0.5} value={state.width} format={(value) => `${value}`} onChange={(width) => apply({ width }, { sw: width })} />}
      {has('opacity') && <Range label={t.canvas.style.opacity} min={0.1} max={1} step={0.05} value={state.opacity} format={(value) => `${Math.round(value * 100)} %`} onChange={(opacity) => apply({ opacity }, { a: opacity })} />}
      {has('dash') && (
        <Block title={t.canvas.style.dash}>
          <div className="flex gap-1.5">
            {t.canvas.style.dashes.map((label, index) => (
              <button key={label} type="button" aria-pressed={state.dash === index} onClick={() => apply({ dash: index as 0 | 1 | 2 }, { d: index })} className={`flex-1 rounded-lg px-1 py-1.5 text-[10px] font-semibold ${state.dash === index ? 'bg-glow text-white' : 'bg-white/[0.06] text-cream/70'}`}>
                {label}
              </button>
            ))}
          </div>
        </Block>
      )}
      {has('radius') && <Range label={t.canvas.style.radius} min={0} max={80} step={1} value={state.radius} format={(value) => `${value}`} onChange={(radius) => apply({ radius }, { k: radius })} />}
      {has('text') && (
        <Block title={t.canvas.style.fontSize}>
          <Range label="" min={10} max={200} step={1} value={state.fontSize} format={(value) => `${value}`} onChange={(fontSize) => apply({ fontSize }, { s: fontSize })} />
          <div className="mt-2 flex gap-1.5">
            <button type="button" aria-pressed={state.bold} aria-label={t.canvas.style.bold} onClick={() => apply({ bold: !state.bold }, { bd: state.bold ? 0 : 1 })} className={`grid h-8 w-9 place-items-center rounded-lg text-sm font-black ${state.bold ? 'bg-glow text-white' : 'bg-white/[0.06] text-cream/70'}`}>
              B
            </button>
            {([AlignLeft, AlignCenter, AlignRight] as const).map((Icon, index) => (
              <button key={index} type="button" aria-pressed={state.align === index} aria-label={t.canvas.style.align[index]} onClick={() => apply({ align: index as 0 | 1 | 2 }, { al: index })} className={`grid h-8 flex-1 place-items-center rounded-lg ${state.align === index ? 'bg-glow text-white' : 'bg-white/[0.06] text-cream/70'}`}>
                <Icon size={15} aria-hidden />
              </button>
            ))}
          </div>
        </Block>
      )}
      {editable.length > 0 && <SelectionActions count={editable.length} />}
    </div>
  )
}

function Block({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Range({ label, min, max, step, value, format, onChange }: { label: string; min: number; max: number; step: number; value: number; format: (value: number) => string; onChange: (value: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      {label && (
        <span className="flex items-center justify-between text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
          {label}
          <span className="font-mono text-[11px] tracking-normal text-cream normal-case">{format(value)}</span>
        </span>
      )}
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label || format(value)} onChange={(event) => onChange(Number(event.target.value))} className="canvas-range h-2 w-full bg-white/15" />
    </label>
  )
}

function BrushPicker({ onShop, apply }: { onShop: () => void; apply: (patch: Partial<Style>, objects?: Record<string, unknown>) => void }) {
  const t = useT()
  const brush = useCanvasStore((state) => state.brush)
  const unlocked = useCanvasStore((state) => state.brushes)
  const limits = useCanvasStore((state) => state.limits)
  const admin = useCanvasStore((state) => state.me?.admin ?? false)
  const list = limits?.brushes ?? []
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {list.map((entry) => {
        const open = entry.price === 0 || unlocked.includes(entry.id) || admin
        return (
          <button
            key={entry.id}
            type="button"
            aria-pressed={brush === entry.id}
            onClick={() => (open ? apply({ brush: entry.id }, { b: entry.id }) : onShop())}
            className={`relative flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold ${brush === entry.id && open ? 'bg-glow text-white' : 'bg-white/[0.06] text-cream/80'} ${open ? '' : 'opacity-70'}`}
          >
            <BrushSwatch id={entry.id} />
            <span className="truncate">{t.canvas.brushes[entry.id] ?? entry.id}</span>
            {!open && <Lock size={11} className="absolute top-1 right-1 text-gold" aria-label={t.canvas.brushShop.locked} />}
          </button>
        )
      })}
    </div>
  )
}

/** Un petit trait d'essai de chaque pinceau (aperçu stylisé, pas le vrai rendu). */
export function BrushSwatch({ id }: { id: string }) {
  const style: Record<string, React.CSSProperties> = {
    pen: { height: 3, borderRadius: 3, background: '#f7f5f0' },
    marker: { height: 6, borderRadius: 6, background: '#f7f5f0' },
    highlighter: { height: 9, borderRadius: 2, background: 'rgba(255,230,109,0.7)' },
    ink: { height: 6, borderRadius: '60% 4px 4px 60%', background: '#f7f5f0', clipPath: 'polygon(0 50%, 25% 0, 100% 35%, 100% 65%, 25% 100%)' },
    pencil: { height: 4, borderRadius: 2, background: 'repeating-linear-gradient(90deg,#d4d4dc 0 3px,#8b8b99 3px 4px)' },
    neon: { height: 5, borderRadius: 5, background: '#fff', boxShadow: '0 0 8px 2px #2bc3ff' },
    tone: { height: 8, borderRadius: 3, backgroundImage: 'radial-gradient(#f7f5f0 1.2px, transparent 1.5px)', backgroundSize: '4px 4px' },
    sparkle: { height: 3, borderRadius: 3, background: '#ffc233', boxShadow: '0 -4px 0 -1px #ffe66d, 6px 4px 0 -1px #ffe66d' },
  }
  return <span aria-hidden className="w-6 shrink-0" style={style[id] ?? style.pen} />
}

function SelectionActions({ count }: { count: number }) {
  const t = useT()
  const engine = getEngine()
  const button = 'grid h-9 flex-1 place-items-center rounded-lg bg-white/[0.06] text-cream/80 transition-colors hover:bg-white/10 active:scale-95' // i18n-ignore : classes CSS
  return (
    <section className="flex flex-col gap-1.5 border-t border-white/10 pt-2.5">
      <h3 className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">{t.canvas.selection.count(count)}</h3>
      <div className="flex gap-1.5">
        <button type="button" title={t.canvas.selection.front} aria-label={t.canvas.selection.front} onClick={() => engine?.restack('front')} className={button}>
          <BringToFront size={16} aria-hidden />
        </button>
        <button type="button" title={t.canvas.selection.back} aria-label={t.canvas.selection.back} onClick={() => engine?.restack('back')} className={button}>
          <SendToBack size={16} aria-hidden />
        </button>
        <button type="button" title={`${t.canvas.selection.duplicate} (Ctrl+D)`} aria-label={t.canvas.selection.duplicate} onClick={() => engine?.duplicateSelection()} className={button}>
          <Copy size={16} aria-hidden />
        </button>
        <button type="button" title={`${t.canvas.selection.delete} (${t.canvas.shortcuts.delete})`} aria-label={t.canvas.selection.delete} onClick={() => engine?.deleteSelection()} className={`${button} text-nope`}>
          <Trash2 size={16} aria-hidden />
        </button>
      </div>
    </section>
  )
}
