import { useState } from 'react'
import { useT } from '../../i18n'
import { HEX, PALETTE, hexToHsl, hslToHex, readableOn } from '../../lib/canvas/color'

/**
 * Sélecteur de couleur : une palette, les couleurs récentes, et un sélecteur libre (teinte,
 * saturation, clarté, code hexadécimal) pour les nuances que la palette n'a pas.
 */
export function ColorPicker({ value, recent, onChange }: { value: string; recent: readonly string[]; onChange: (color: string) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const hsl = hexToHsl(value)
  const hex = draft ?? value

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-6 gap-1.5" role="group" aria-label={t.canvas.style.palette}>
        {PALETTE.map((color) => (
          <Swatch key={color} color={color} active={color === value} onPick={onChange} />
        ))}
      </div>
      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t.canvas.style.recent}>
          <span className="text-[10px] tracking-wide text-mist uppercase">{t.canvas.style.recent}</span>
          {recent.map((color) => (
            <Swatch key={color} color={color} active={color === value} onPick={onChange} small />
          ))}
        </div>
      )}
      <button type="button" onClick={() => setOpen((state) => !state)} aria-expanded={open} className="flex items-center gap-2 text-left text-[11px] font-semibold text-cream/80">
        <span className="size-4 rounded-full border border-white/30" style={{ background: value }} aria-hidden />
        {t.canvas.style.custom}
      </button>
      {open && (
        <div className="flex flex-col gap-2 rounded-xl bg-white/[0.04] p-2.5">
          <Slider label={t.canvas.style.hue} min={0} max={360} value={hsl.h} track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" onChange={(h) => onChange(hslToHex({ ...hsl, h }))} />
          <Slider label={t.canvas.style.saturation} min={0} max={100} value={hsl.s} track={`linear-gradient(90deg,${hslToHex({ ...hsl, s: 0 })},${hslToHex({ ...hsl, s: 100 })})`} onChange={(s) => onChange(hslToHex({ ...hsl, s }))} />
          <Slider label={t.canvas.style.lightness} min={0} max={100} value={hsl.l} track={`linear-gradient(90deg,#000,${hslToHex({ ...hsl, l: 50 })},#fff)`} onChange={(l) => onChange(hslToHex({ ...hsl, l }))} />
          <label className="flex items-center gap-2 text-[11px] text-mist">
            {t.canvas.style.hex}
            <input
              value={hex}
              maxLength={7}
              spellCheck={false}
              onChange={(event) => {
                const next = event.target.value.startsWith('#') ? event.target.value : `#${event.target.value}`
                setDraft(next)
                if (HEX.test(next)) onChange(next.toLowerCase())
              }}
              onBlur={() => setDraft(null)}
              className="w-24 rounded-lg border border-white/15 bg-black/30 px-2 py-1 font-mono text-xs text-cream outline-none focus:border-glow"
              style={{ color: HEX.test(hex) ? undefined : '#ff5c7a' }}
            />
          </label>
        </div>
      )}
    </div>
  )
}

function Swatch({ color, active, onPick, small = false }: { color: string; active: boolean; onPick: (color: string) => void; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onPick(color)}
      aria-label={color}
      aria-pressed={active}
      className={`${small ? 'size-5' : 'aspect-square w-full'} rounded-full border transition-transform active:scale-90 ${active ? 'scale-110 border-white ring-2 ring-glow' : 'border-white/25'}`}
      style={{ background: color, boxShadow: active ? `0 0 0 2px ${readableOn(color) === '#ffffff' ? '#00000066' : '#ffffff66'} inset` : undefined }}
    />
  )
}

function Slider({ label, min, max, value, track, onChange }: { label: string; min: number; max: number; value: number; track: string; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-mist">
      <span className="w-14 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={1} value={Math.round(value)} onChange={(event) => onChange(Number(event.target.value))} className="canvas-range h-2 w-full" style={{ background: track }} />
    </label>
  )
}
