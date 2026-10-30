import { useCallback, useEffect, useState } from 'react'
import { Loader2, Minus, PartyPopper, Plus, Square } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { vibrate } from '../../lib/haptics'
import { EVENT_MAX, EVENT_MESSAGE_MAX, EVENT_TITLE_MAX, eventsApi, type AdminTeamEvent } from '../../services/eventsApi'
import { useEventsStore } from '../../store/useEventsStore'
import { useUiStore } from '../../store/useUiStore'

const DURATIONS = [24, 48, 72, 168, 336] as const
/** Pas du réglage des Poussières. */
const STARDUST_STEP = 50

/**
 * Événements de l'équipe : un titre, un mot et des cadeaux (packs Légendaire, boosters,
 * Poussières). Chaque compte qui se connecte pendant l'événement les découvre dans une fenêtre
 * et les récupère, une fois. On peut l'arrêter avant son terme.
 */
export function AdminEvents() {
  const t = useT()
  const copy = t.admin.events
  const notify = useUiStore((state) => state.notify)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [legendaryPacks, setLegendaryPacks] = useState(1)
  const [boosters, setBoosters] = useState(2)
  const [stardust, setStardust] = useState(0)
  const [hours, setHours] = useState<number>(48)
  const [sending, setSending] = useState(false)
  const [items, setItems] = useState<AdminTeamEvent[] | null>(null)

  const reload = useCallback(() => {
    eventsApi
      .list()
      .then(setItems)
      .catch(() => setItems([]))
  }, [])
  useEffect(() => reload(), [reload])

  const hasGift = legendaryPacks + boosters + stardust > 0
  const valid = hasGift && title.trim().length > 0 && message.trim().length > 0

  const launch = async () => {
    if (!valid || sending) return
    setSending(true)
    try {
      await eventsApi.create({ title: title.trim(), message: message.trim(), legendaryPacks, boosters, stardust, hours })
      vibrate([10, 40, 18])
      notify(copy.launched, 'like')
      setTitle('')
      setMessage('')
      reload()
      // L'administrateur aussi a droit aux cadeaux : sa fenêtre s'ouvre comme chez tout le monde.
      void useEventsStore.getState().load()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setSending(false)
    }
  }

  const stop = async (id: string) => {
    try {
      await eventsApi.end(id)
      reload()
      void useEventsStore.getState().load()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <section className="glass flex flex-col gap-4 rounded-[1.5rem] p-4">
        <h2 className="flex items-center gap-2 font-display text-xl">
          <PartyPopper size={20} className="text-[#ffc46b]" aria-hidden />
          {copy.title}
        </h2>
        <p className="-mt-2 text-xs text-mist">{copy.subtitle}</p>

        <label className="flex flex-col gap-1.5 text-xs font-semibold text-cream/80">
          {copy.name}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value.slice(0, EVENT_TITLE_MAX))}
            placeholder={copy.namePlaceholder}
            className="h-11 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-base text-cream outline-none placeholder:text-mist/60 focus:border-[#ffc46b]/70"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-cream/80">
          {copy.message}
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, EVENT_MESSAGE_MAX))}
            rows={4}
            placeholder={copy.messagePlaceholder}
            className="resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm font-normal text-cream outline-none placeholder:text-mist/60 focus:border-[#ffc46b]/60"
          />
          <span className="self-end text-[10px] font-normal text-mist">
            {message.length}/{EVENT_MESSAGE_MAX}
          </span>
        </label>

        <div className="flex flex-col gap-2 text-xs font-semibold text-cream/80">
          {copy.gifts}
          <Stepper label={copy.legendaryPacks} value={legendaryPacks} max={EVENT_MAX.legendaryPacks} onChange={setLegendaryPacks} tint="#ffc46b" />
          <Stepper label={copy.boosters} value={boosters} max={EVENT_MAX.boosters} onChange={setBoosters} tint="#9b8cff" />
          <Stepper label={`${copy.stardust} ✦`} value={stardust} max={EVENT_MAX.stardust} step={STARDUST_STEP} onChange={setStardust} tint="#7fd8ff" />
          {!hasGift && <span className="text-[11px] font-normal text-nope">{copy.empty}</span>}
        </div>

        <div className="flex flex-col gap-1.5 text-xs font-semibold text-cream/80">
          {copy.duration}
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={hours === value}
                onClick={() => setHours(value)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${hours === value ? 'bg-cream text-void' : 'bg-white/[0.06] text-cream/75'}`}
              >
                {t.admin.promos.hours(value)}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void launch()}
          disabled={!valid || sending}
          className="btn-cta inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold disabled:opacity-40"
        >
          {sending ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <PartyPopper size={17} aria-hidden />}
          {copy.launch}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">{copy.history}</h3>
        {items === null ? (
          <Loader2 size={18} className="mx-auto animate-spin text-mist" aria-hidden />
        ) : items.length === 0 ? (
          <p className="px-1 text-sm text-mist">{copy.none}</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="glass flex items-center gap-3 rounded-2xl px-3.5 py-3">
              <span className={`size-2.5 shrink-0 rounded-full ${item.active ? 'animate-pulse bg-[#ffc46b]' : 'bg-white/20'}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{item.title}</span>
                <span className="block truncate text-[11px] text-mist">
                  {[
                    item.legendaryPacks > 0 && `${item.legendaryPacks} × ${copy.legendaryPacks}`,
                    item.boosters > 0 && `${item.boosters} × ${copy.boosters}`,
                    item.stardust > 0 && `${item.stardust} ✦`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="block truncate text-[11px] text-mist">
                  {item.active ? copy.until(new Date(item.endsAt).toLocaleString()) : copy.over} · {copy.claims(item.claims)}
                </span>
              </span>
              {item.active && (
                <button type="button" onClick={() => void stop(item.id)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 text-xs font-semibold text-cream/85">
                  <Square size={12} aria-hidden />
                  {copy.stop}
                </button>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  )
}

/** Un cadeau et sa quantité, avec − et +. */
function Stepper({ label, value, max, step = 1, tint, onChange }: { label: string; value: number; max: number; step?: number; tint: string; onChange: (value: number) => void }) {
  const set = (next: number) => onChange(Math.min(max, Math.max(0, next)))
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] py-1.5 pr-1.5 pl-3.5">
      <span className="size-2 shrink-0 rounded-full" style={{ background: tint }} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-cream/85">{label}</span>
      <button type="button" onClick={() => set(value - step)} disabled={value <= 0} aria-label={`− ${label}`} className="grid size-9 place-items-center rounded-full bg-white/[0.06] text-cream disabled:opacity-30">
        <Minus size={15} />
      </button>
      <span className="w-12 text-center font-display text-lg tabular-nums" style={{ color: value > 0 ? tint : undefined }}>
        {value}
      </span>
      <button type="button" onClick={() => set(value + step)} disabled={value >= max} aria-label={`+ ${label}`} className="grid size-9 place-items-center rounded-full bg-white/[0.06] text-cream disabled:opacity-30">
        <Plus size={15} />
      </button>
    </div>
  )
}
