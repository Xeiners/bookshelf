import { useT } from '../../i18n'
import { MAX_PACKS_AT_ONCE } from '../../lib/boosters'
import { vibrate } from '../../lib/haptics'

interface PackCountPickerProps {
  value: number
  /** Au-delà, les choix sont grisés (stock, solde). */
  max: number
  onChange: (count: number) => void
  label: string
}

/** Combien de boosters : de 1 à `MAX_PACKS_AT_ONCE`, en pastilles. */
export function PackCountPicker({ value, max, onChange, label }: PackCountPickerProps) {
  const t = useT()
  return (
    <div role="radiogroup" aria-label={label} className="flex justify-center gap-2">
      {Array.from({ length: MAX_PACKS_AT_ONCE }, (_, index) => {
        const count = index + 1
        const selected = count === value
        return (
          <button
            key={count}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t.boosters.count.option(count)}
            disabled={count > max}
            onClick={() => {
              vibrate(8)
              onChange(count)
            }}
            className={`grid size-11 place-items-center rounded-full border text-base font-bold tabular-nums transition-[transform,background-color,border-color,box-shadow] active:scale-95 disabled:opacity-30 disabled:active:scale-100 ${
              selected ? 'border-transparent text-[#2a1a02] shadow-[0_0_22px_rgba(255,196,107,0.55)]' : 'border-[#ffe39a]/25 bg-black/30 text-[#fff4c8]'
            }`}
            style={selected ? { background: 'linear-gradient(135deg, #fff0b0, #e0a82e 55%, #c8901c)' } : undefined}
          >
            {count}
          </button>
        )
      })}
    </div>
  )
}
