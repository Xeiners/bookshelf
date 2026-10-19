import { useMemo, useState } from 'react'
import { Check, Heart, Loader2, Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import { RARITY_STYLE, type Rarity } from '../../lib/boosters'
import { vibrate } from '../../lib/haptics'
import { ApiError } from '../../services/api'
import { useCollection } from '../../hooks/useCollection'
import { useDuplicates } from '../../hooks/useDuplicates'
import { cardsApi, type ConversionResult } from '../../services/cardsApi'
import { useBoosterStore } from '../../store/useBoosterStore'
import { useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { Sheet } from '../ui/Sheet'

/** Après une conversion : le solde, l'album et le message. */
function useAfterConversion() {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const collectionChanged = useBoosterStore((state) => state.collectionChanged)
  return {
    done: (result: ConversionResult) => {
      useDleStore.getState().setStardust(result.balance)
      collectionChanged()
      vibrate([10, 40, 18])
      notify(t.cards.convert.done(result.gained, result.copies), 'like')
    },
    failed: (error: unknown) => {
      const code = error instanceof ApiError ? error.code : null
      notify(code === 'duplicates_changed' || code === 'not_enough_duplicates' ? t.cards.convert.changed : t.cards.convert.error, 'nope')
    },
  }
}

type Convertible = Exclude<Rarity, 'MYTHIC'>
const CONVERTIBLE: Convertible[] = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY']

/**
 * Convertir ses doublons : chaque carte à doublons est listée, toutes cochées d'office (sauf les
 * favoris) ; on décoche celles à garder, par carte ou par rareté. « Convertir » ne touche que les cartes cochées.
 */
export function ConvertDuplicatesSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const after = useAfterConversion()
  const [view] = useDuplicates()
  const { data } = useCollection()
  /** Cartes décochées par le joueur, et favoris qu'il a cochés lui-même. */
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [on, setOn] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const groups = useMemo(() => {
    const cards = new Map((data?.cards ?? []).map((card) => [card.id, card]))
    return CONVERTIBLE.map((rarity) => ({
      rarity,
      rows: (view?.items ?? [])
        .filter((item) => item.rarity === rarity)
        .map((item) => ({ ...item, card: cards.get(item.cardId) }))
        .sort((a, b) => (a.card?.number ?? 0) - (b.card?.number ?? 0)),
    })).filter((group) => group.rows.length > 0)
  }, [view, data])

  const checked = (item: { cardId: string; isFavorite: boolean }) => (item.isFavorite ? on.has(item.cardId) : !off.has(item.cardId))
  const all = groups.flatMap((group) => group.rows)
  const picked = all.filter(checked)
  const total = picked.reduce((sum, item) => sum + item.value, 0)
  const copies = picked.reduce((sum, item) => sum + item.extra, 0)

  const set = (items: typeof all, value: boolean) => {
    const nextOff = new Set(off)
    const nextOn = new Set(on)
    for (const item of items) {
      if (item.isFavorite) {
        if (value) nextOn.add(item.cardId)
        else nextOn.delete(item.cardId)
      } else if (value) nextOff.delete(item.cardId)
      else nextOff.add(item.cardId)
    }
    setOff(nextOff)
    setOn(nextOn)
  }

  const convert = async (dismiss: () => void) => {
    if (picked.length === 0 || busy) return
    setBusy(true)
    try {
      after.done(await cardsApi.convert({ items: picked.map((item) => ({ cardId: item.cardId, copies: item.extra })) }))
      dismiss()
    } catch (error) {
      after.failed(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      label={t.cards.convert.title}
      title={t.cards.convert.title}
      subtitle={t.cards.convert.subtitle}
      onClose={onClose}
      footer={(dismiss) => (
        <button
          type="button"
          disabled={picked.length === 0 || busy}
          onClick={() => void convert(dismiss)}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-cream text-sm font-semibold text-void transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />}
          {picked.length === 0 ? t.cards.convert.nothing : t.cards.convert.total(picked.length, total)}
        </button>
      )}
    >
      {view === null ? (
        <div className="grid place-items-center py-8 text-mist">
          <Loader2 size={20} className="animate-spin" aria-hidden />
        </div>
      ) : all.length === 0 ? (
        <p className="py-4 text-sm text-mist">{t.cards.convert.empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 text-xs text-mist">
            <span>{t.cards.convert.selected(picked.length, all.length, copies)}</span>
            <span className="flex gap-1.5">
              <button type="button" onClick={() => set(all, true)} className="rounded-full bg-white/[0.07] px-3 py-1.5 font-semibold text-cream">
                {t.cards.convert.selectAll}
              </button>
              <button type="button" onClick={() => set(all, false)} className="rounded-full bg-white/[0.07] px-3 py-1.5 font-semibold text-cream">
                {t.cards.convert.selectNone}
              </button>
            </span>
          </div>
          {groups.map((group) => {
            const style = RARITY_STYLE[group.rarity]
            const allOn = group.rows.every(checked)
            return (
              <section key={group.rarity} aria-label={t.cards.rarity[group.rarity]} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-semibold" style={{ color: style.color }}>
                    {t.cards.rarity[group.rarity]} <span className="font-normal text-mist">· {t.cards.convert.each(view.values[group.rarity] ?? 0)}</span>
                  </h3>
                  <button type="button" onClick={() => set(group.rows, !allOn)} className="rounded-full px-2.5 py-1 text-xs font-semibold text-cream/80 hover:bg-white/[0.07]">
                    {allOn ? t.cards.convert.noneOf : t.cards.convert.allOf}
                  </button>
                </div>
                {group.rows.map((item) => {
                  const on = checked(item)
                  const name = item.card?.name || item.card?.title || item.cardId
                  return (
                    <button
                      key={item.cardId}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => set([item], !on)}
                      className={`flex items-center gap-3 rounded-2xl border px-2.5 py-2 text-left transition-colors ${on ? 'border-glow/50 bg-glow/10' : 'border-white/10 bg-white/[0.03] opacity-70'}`}
                    >
                      <span className="grid size-5 shrink-0 place-items-center rounded-md border border-white/25" style={on ? { background: style.color, borderColor: style.color } : undefined}>
                        {on && <Check size={14} className="text-void" aria-hidden />}
                      </span>
                      {item.card && <img src={item.card.imageUrl} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded-md bg-ink object-cover" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 text-sm font-semibold text-cream">
                          <span className="truncate">{name}</span>
                          {item.isFavorite && <Heart size={12} className="shrink-0 fill-nope text-nope" aria-label={t.cards.convert.favorite} />}
                        </span>
                        <span className="block text-xs text-mist">{t.cards.convert.copies(item.extra)}</span>
                      </span>
                      <span className="shrink-0 text-sm font-bold text-gold tabular-nums">+{item.value} ✦</span>
                    </button>
                  )
                })}
              </section>
            )
          })}
          <p className="px-1 text-xs text-nope/90">{t.cards.convert.warning}</p>
        </div>
      )}
    </Sheet>
  )
}

/** Convertir les doublons d'UNE carte : on choisit combien, de 1 au maximum libre. */
export function ConvertCardSheet({ card, free, value, onClose, onDone }: { card: { id: string; title: string }; free: number; value: number; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const after = useAfterConversion()
  const [copies, setCopies] = useState(1)
  const [busy, setBusy] = useState(false)

  const convert = async (dismiss: () => void) => {
    if (busy) return
    setBusy(true)
    try {
      after.done(await cardsApi.convert({ cardId: card.id, copies }))
      onDone()
      dismiss()
    } catch (error) {
      after.failed(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      label={t.cards.convert.oneTitle}
      title={t.cards.convert.oneTitle}
      subtitle={t.cards.convert.oneSubtitle(card.title, free)}
      onClose={onClose}
      footer={(dismiss) => (
        <button
          type="button"
          disabled={busy}
          onClick={() => void convert(dismiss)}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-cream text-sm font-semibold text-void transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />}
          {t.cards.convert.oneButton(copies, copies * value)}
        </button>
      )}
    >
      <div className="flex flex-col gap-3">
        {free > 1 && (
          <input
            type="range"
            min={1}
            max={free}
            value={copies}
            onChange={(event) => setCopies(Number(event.target.value))}
            aria-label={t.cards.convert.copies(copies)}
            className="w-full accent-[#ffc46b]"
          />
        )}
        <p className="text-center text-sm text-cream/80">
          {t.cards.convert.copies(copies)} · {t.cards.convert.each(value)}
        </p>
        <p className="text-xs text-nope/90">{t.cards.convert.warning}</p>
      </div>
    </Sheet>
  )
}
