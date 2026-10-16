import { DLE_CATEGORIES, DLE_MODES, DURATION_OPTIONS, GUESS_OPTIONS, type DleCategory, type DleMode, type RoomSettings, type RoomView } from '../../services/dleApi'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { modeLabel } from './dleStyle'
import { KindPicker } from './KindPicker'

/**
 * Les réglages de la partie : type, univers, formats, essais, durée. L'hôte choisit, les autres
 * voient. Dans la salle d'attente comme à la fin d'une partie : on change tout ce qu'on veut,
 * avec les mêmes joueurs, sans recréer de salon.
 */
export function RoomSettingsPanel({ room, isHost, settle }: { room: RoomView; isHost: boolean; settle: (settings: RoomSettings) => void | Promise<unknown> }) {
  const t = useT()
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      <KindPicker value={room.kind} disabled={!isHost} onChange={(kind) => void settle({ kind })} />
      <CategoryRow
        label={t.dle.room.settings.category}
        value={room.category}
        disabled={!isHost}
        labelOf={(category) => t.dle.categories[category].title}
        onChange={(category) => void settle({ category })}
      />
      <ModesRow
        label={t.dle.room.settings.modes}
        modes={room.modes}
        disabled={!isHost}
        labelOf={(mode) => modeLabel(t, room.category, mode)}
        onToggle={(mode) => {
          const next = room.modes.includes(mode) ? room.modes.filter((entry) => entry !== mode) : [...room.modes, mode]
          if (next.length > 0) void settle({ modes: DLE_MODES.filter((entry) => next.includes(entry)) })
        }}
      />
      <SettingRow
        label={t.dle.room.settings.guesses}
        options={GUESS_OPTIONS}
        value={room.maxGuesses}
        disabled={!isHost}
        format={(value) => (value === null ? t.dle.room.settings.unlimited : String(value))}
        onChange={(maxGuesses) => void settle({ maxGuesses })}
      />
      <SettingRow
        label={t.dle.room.settings.duration}
        options={DURATION_OPTIONS}
        value={room.roundSeconds}
        disabled={!isHost}
        format={(value) => t.dle.room.settings.minutes(value / 60)}
        onChange={(roundSeconds) => void settle({ roundSeconds })}
      />
    </div>
  )
}

/** L'univers de la partie : une rangée de pastilles défilante (lecture seule pour les autres joueurs). */
function CategoryRow({
  label,
  value,
  disabled,
  labelOf,
  onChange,
}: {
  label: string
  value: DleCategory
  disabled: boolean
  labelOf: (category: DleCategory) => string
  onChange: (category: DleCategory) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] font-semibold tracking-[0.12em] text-mist uppercase">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {DLE_CATEGORIES.map((category) => {
          const active = category === value
          return (
            <button
              key={category}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled && !active}
              onClick={() => {
                if (disabled || active) return
                vibrate(6)
                onChange(category)
              }}
              className={`h-9 rounded-full px-3.5 text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-35 ${active ? 'bg-cream text-void' : 'bg-white/[0.06] text-cream/80 hover:bg-white/[0.1]'} ${disabled ? 'cursor-default' : ''}`}
            >
              {labelOf(category)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Un réglage de l'hôte : une rangée de pastilles (lecture seule pour les autres joueurs). */
function SettingRow<V extends number | null>({
  label,
  options,
  value,
  disabled,
  format,
  onChange,
}: {
  label: string
  options: readonly V[]
  value: V
  disabled: boolean
  format: (value: V) => string
  onChange: (value: V) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] font-semibold tracking-[0.12em] text-mist uppercase">{label}</span>
      <div role="radiogroup" aria-label={label} className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
        {options.map((option) => {
          const active = option === value
          return (
            <button
              key={String(option)}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled && !active}
              onClick={() => {
                if (disabled || active) return
                vibrate(6)
                onChange(option)
              }}
              className={`h-9 shrink-0 rounded-full px-3.5 text-sm font-semibold tabular-nums transition-colors disabled:opacity-35 ${active ? 'bg-cream text-void' : 'bg-white/[0.06] text-cream/80 hover:bg-white/[0.1]'} ${disabled ? 'cursor-default' : ''}`}
            >
              {format(option)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Formats de la partie : un, ou les deux à la suite (numérotés dans leur ordre de passage). */
function ModesRow({
  label,
  modes,
  disabled,
  labelOf,
  onToggle,
}: {
  label: string
  modes: DleMode[]
  disabled: boolean
  labelOf: (mode: DleMode) => string
  onToggle: (mode: DleMode) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] font-semibold tracking-[0.12em] text-mist uppercase">{label}</span>
      <div role="group" aria-label={label} className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {DLE_MODES.map((mode) => {
          const active = modes.includes(mode)
          const order = modes.length > 1 ? modes.indexOf(mode) + 1 : 0
          return (
            <button
              key={mode}
              type="button"
              role="checkbox"
              aria-checked={active}
              disabled={disabled && !active}
              onClick={() => {
                if (disabled) return
                vibrate(6)
                onToggle(mode)
              }}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors disabled:opacity-35 ${active ? 'bg-cream text-void' : 'bg-white/[0.06] text-cream/80 hover:bg-white/[0.1]'} ${disabled ? 'cursor-default' : ''}`}
            >
              {order > 0 && <span className="grid size-5 place-items-center rounded-full bg-void text-[10px] font-black text-cream">{order}</span>}
              {labelOf(mode)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
