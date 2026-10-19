import { useMemo, useState } from 'react'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import { RARITIES, RARITY_STYLE, type Rarity } from '../../lib/boosters'
import { vibrate } from '../../lib/haptics'
import { ApiError } from '../../services/api'
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

/** Convertir par raretés : on coche celles qu'on veut (les plus rares sont décochées d'office). */
export function ConvertDuplicatesSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const after = useAfterConversion()
  const [view] = useDuplicates()
  const [picked, setPicked] = useState<ReadonlySet<Rarity>>(new Set<Rarity>(['COMMON', 'RARE', 'EPIC']))
  const [busy, setBusy] = useState(false)

  // Hors favoris : ce que « Convertir » touche vraiment.
  const rows = useMemo(
    () =>
      RARITIES.map((rarity) => {
        const items = (view?.items ?? []).filter((item) => item.rarity === rarity && !item.isFavorite)
        return { rarity, copies: items.reduce((sum, item) => sum + item.extra, 0), value: view?.values[rarity] ?? 0 }
      }),
    [view],
  )
  const total = rows.reduce((sum, row) => (picked.has(row.rarity) ? sum + row.copies * row.value : sum), 0)
  const copies = rows.reduce((sum, row) => (picked.has(row.rarity) ? sum + row.copies : sum), 0)

  const toggle = (rarity: Rarity) =>
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(rarity)) next.delete(rarity)
      else next.add(rarity)
      return next
    })

  const convert = async (dismiss: () => void) => {
    if (copies === 0 || busy) return
    setBusy(true)
    try {
      after.done(await cardsApi.convert({ rarities: [...picked] }))
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
          disabled={copies === 0 || busy}
          onClick={() => void convert(dismiss)}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-cream text-sm font-semibold text-void transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />}
          {copies === 0 ? t.cards.convert.nothing : t.cards.convert.total(total)}
        </button>
      )}
    >
      {view === null ? (
        <div className="grid place-items-center py-8 text-mist">
          <Loader2 size={20} className="animate-spin" aria-hidden />
        </div>
      ) : rows.every((row) => row.copies === 0) ? (
        <p className="py-4 text-sm text-mist">{t.cards.convert.empty}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const on = picked.has(row.rarity)
            const disabled = row.copies === 0
            return (
              <button
                key={row.rarity}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={disabled}
                onClick={() => toggle(row.rarity)}
                className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors disabled:opacity-35 ${on && !disabled ? 'border-glow/60 bg-glow/10' : 'border-white/10 bg-white/[0.04]'}`}
              >
                <span className="grid size-5 shrink-0 place-items-center rounded-md border border-white/25" style={on && !disabled ? { background: RARITY_STYLE[row.rarity].color, borderColor: RARITY_STYLE[row.rarity].color } : undefined}>
                  {on && !disabled && <Check size={14} className="text-void" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold" style={{ color: RARITY_STYLE[row.rarity].color }}>
                    {t.cards.rarity[row.rarity]}
                  </span>
                  <span className="block text-xs text-mist">
                    {t.cards.convert.copies(row.copies)} · {t.cards.convert.each(row.value)}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-bold text-gold tabular-nums">+{row.copies * row.value} ✦</span>
              </button>
            )
          })}
          <p className="px-1 pt-1 text-xs text-nope/90">{t.cards.convert.warning}</p>
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
