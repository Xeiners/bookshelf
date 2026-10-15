import { useCallback, useEffect, useState } from 'react'
import { BadgePercent, Loader2, Square } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { vibrate } from '../../lib/haptics'
import { promotionsApi, type Promotion, type PromotionTarget } from '../../services/promotionsApi'
import { usePromotions } from '../../store/usePromotions'
import { useUiStore } from '../../store/useUiStore'

/** Prix habituels (cf. le serveur, qui fait foi) : pour proposer une baisse sensée. */
const REGULAR: Record<PromotionTarget, number> = { booster: 340, box: 450 }
const DURATIONS = [1, 6, 24, 48, 72, 168] as const

/**
 * Promotions : baisser le prix d'un booster ou d'une boîte mystère pour un temps. Tous les
 * comptes reçoivent une notification ; la boutique affiche le prix barré. Une nouvelle
 * promotion remplace celle en cours sur le même article ; on peut l'arrêter avant son terme.
 */
export function AdminPromotions() {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const [target, setTarget] = useState<PromotionTarget>('booster')
  const [price, setPrice] = useState(200)
  const [hours, setHours] = useState<number>(24)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [items, setItems] = useState<Promotion[] | null>(null)

  const reload = useCallback(() => {
    promotionsApi
      .list()
      .then(setItems)
      .catch(() => setItems([]))
  }, [])
  useEffect(() => reload(), [reload])

  const regular = REGULAR[target]
  const valid = Number.isInteger(price) && price >= 1 && price < regular

  const launch = async () => {
    if (!valid || sending) return
    setSending(true)
    try {
      const { notified } = await promotionsApi.create({ target, price, hours, message: message.trim() || null })
      vibrate([10, 40, 18])
      notify(t.admin.promos.launched(notified), 'like')
      setMessage('')
      reload()
      void usePromotions.getState().load(true)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setSending(false)
    }
  }

  const stop = async (id: string) => {
    try {
      await promotionsApi.end(id)
      reload()
      void usePromotions.getState().load(true)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <section className="glass flex flex-col gap-4 rounded-[1.5rem] p-4">
        <h2 className="flex items-center gap-2 font-display text-xl">
          <BadgePercent size={20} className="text-[#ff4d6d]" aria-hidden />
          {t.admin.promos.title}
        </h2>
        <p className="-mt-2 text-xs text-mist">{t.admin.promos.subtitle}</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t.admin.promos.item}>
          {(['booster', 'box'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={target === value}
              onClick={() => {
                setTarget(value)
                setPrice(Math.round(REGULAR[value] * 0.6))
              }}
              className={`rounded-2xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${target === value ? 'border-[#ff4d6d] bg-[#ff4d6d]/15 text-cream' : 'border-white/10 bg-white/[0.04] text-cream/70'}`}
            >
              {t.admin.promos.targets[value]}
              <span className="block text-[11px] font-normal text-mist">{t.admin.promos.regular(REGULAR[value])}</span>
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-cream/80">
          {t.admin.promos.price}
          <span className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={regular - 1}
              value={Number.isFinite(price) ? price : ''}
              onChange={(event) => setPrice(Math.floor(Number(event.target.value)))}
              className="h-11 w-32 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-base text-cream outline-none focus:border-[#ff4d6d]/70"
            />
            <span className="text-sm text-mist">✦</span>
            {valid && <span className="rounded-full bg-[#ff4d6d] px-2 py-0.5 text-[11px] font-black text-white">−{Math.round((1 - price / regular) * 100)} %</span>}
          </span>
          {!valid && <span className="text-[11px] font-normal text-nope">{t.admin.promos.invalid(regular)}</span>}
        </label>
        <div className="flex flex-col gap-1.5 text-xs font-semibold text-cream/80">
          {t.admin.promos.duration}
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
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, 140))}
          rows={2}
          placeholder={t.admin.promos.message}
          aria-label={t.admin.promos.message}
          className="resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-cream outline-none placeholder:text-mist/70 focus:border-[#ff4d6d]/60"
        />
        <button
          type="button"
          onClick={() => void launch()}
          disabled={!valid || sending}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold text-white disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #ff7a8f, #ff4d6d 55%, #c2185b)' }}
        >
          {sending ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <BadgePercent size={17} aria-hidden />}
          {t.admin.promos.launch}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">{t.admin.promos.history}</h3>
        {items === null ? (
          <Loader2 size={18} className="mx-auto animate-spin text-mist" aria-hidden />
        ) : items.length === 0 ? (
          <p className="px-1 text-sm text-mist">{t.admin.promos.none}</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="glass flex items-center gap-3 rounded-2xl px-3.5 py-3">
              <span className={`size-2.5 shrink-0 rounded-full ${item.active ? 'animate-pulse bg-[#ff4d6d]' : 'bg-white/20'}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {t.admin.promos.targets[item.target]} · <span className="text-mist line-through">{item.regular}</span> {item.price} ✦
                </span>
                <span className="block truncate text-[11px] text-mist">
                  {item.active ? t.admin.promos.until(new Date(item.endsAt).toLocaleString()) : t.admin.promos.over}
                  {item.message ? ` · ${item.message}` : ''}
                </span>
              </span>
              {item.active && (
                <button type="button" onClick={() => void stop(item.id)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3 text-xs font-semibold text-cream/85">
                  <Square size={12} aria-hidden />
                  {t.admin.promos.stop}
                </button>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  )
}
