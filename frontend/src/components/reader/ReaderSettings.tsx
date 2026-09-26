import type { ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useT } from '../../i18n'
import { useReaderStore } from '../../store/useReaderStore'
import { SidePanel } from './SidePanel'

interface ReaderSettingsProps {
  open: boolean
  onClose: () => void
  children?: ReactNode
}

/** Panneau « Réglages de lecture » : chaque moteur y met ses propres sections. */
export function ReaderSettings({ open, onClose, children }: ReaderSettingsProps) {
  const t = useT()
  const showStatus = useReaderStore((state) => state.showStatus)
  const toggleStatus = useReaderStore((state) => state.toggleStatus)
  return (
    <SidePanel open={open} title={t.reader.settings} onClose={onClose}>
      <div className="space-y-6 px-2 pt-1">
        {children}
        <SettingToggle label={t.reader.showStatus} checked={showStatus} onChange={toggleStatus} />
      </div>
    </SidePanel>
  )
}

export function SettingGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] tracking-[0.18em] text-mist uppercase">{label}</h3>
      {children}
      {hint && <p className="mt-1.5 text-[11px] leading-4 text-mist/80">{hint}</p>}
    </section>
  )
}

export interface ChoiceOption<T extends string> {
  value: T
  label: string
  hint?: string
  disabled?: boolean
}

/** Choix exclusif en boutons segmentés (radio accessible). */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: ChoiceOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-2xl bg-white/[0.05] p-1">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={`min-w-0 flex-1 rounded-xl px-2 py-2 text-xs transition-colors disabled:opacity-30 ${
              active ? 'bg-cream text-void' : 'text-cream/75 hover:bg-white/[0.06]'
            }`}
          >
            <span className="block truncate">{option.label}</span>
            {option.hint && (
              <span className={`block truncate text-[10px] ${active ? 'text-void/60' : 'text-mist'}`}>{option.hint}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Valeur réglable par pas (taille du texte, interlignage, marges). */
export function Stepper({
  value,
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel,
}: {
  value: string
  onDecrease: () => void
  onIncrease: () => void
  decreaseLabel: string
  increaseLabel: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-white/[0.05] p-1">
      <button
        type="button"
        onClick={onDecrease}
        aria-label={decreaseLabel}
        className="grid size-9 place-items-center rounded-xl text-cream/80 hover:bg-white/[0.08]"
      >
        <Minus size={16} />
      </button>
      <span className="flex-1 text-center text-sm text-cream tabular-nums">{value}</span>
      <button
        type="button"
        onClick={onIncrease}
        aria-label={increaseLabel}
        className="grid size-9 place-items-center rounded-xl text-cream/80 hover:bg-white/[0.08]"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}

export function SettingToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-cream/85">
      {label}
      <input type="checkbox" checked={checked} onChange={onChange} className="size-4 accent-gold" />
    </label>
  )
}
