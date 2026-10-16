import { useEffect, useState } from 'react'
import { Check, Loader2, Lock, X } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { canvasApi, type BrushShop as Shop } from '../../services/canvasApi'
import { useCanvasStore } from '../../store/useCanvasStore'
import { useUiStore } from '../../store/useUiStore'
import { BrushSwatch } from './StylePanel'

/** Les pinceaux : ceux de départ, ceux qu'on achète en Poussières, ceux que les « j'aime » débloquent. */
export function BrushShopPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [shop, setShop] = useState<Shop | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const notify = useUiStore((state) => state.notify)

  useEffect(() => {
    let alive = true
    canvasApi
      .brushes()
      .then((result) => alive && setShop(result))
      .catch((error: unknown) => notify(apiErrorMessage(error, t), 'nope'))
    return () => {
      alive = false
    }
  }, [notify, t])

  const buy = async (id: string) => {
    setBusy(id)
    try {
      setShop(await canvasApi.buyBrush(id))
      notify(t.canvas.brushShop.bought, 'like')
      useCanvasStore.getState().setStyle({ brush: id })
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(null)
    }
  }

  return (
    <aside className="glass pointer-events-auto flex max-h-[62vh] w-[20rem] flex-col rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.5)] max-md:w-full" aria-label={t.canvas.brushShop.title}>
      <header className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-2">
        <div>
          <h2 className="font-display text-lg text-cream">{t.canvas.brushShop.title}</h2>
          <p className="text-[11px] leading-snug text-mist">{t.canvas.brushShop.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {shop && <span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-semibold text-gold tabular-nums">{t.canvas.brushShop.balance(shop.balance)}</span>}
          <button type="button" onClick={onClose} aria-label={t.common.close} className="grid size-7 place-items-center rounded-full bg-white/[0.07] text-cream/70">
            <X size={14} aria-hidden />
          </button>
        </div>
      </header>
      <ul className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3">
        {!shop && <Loader2 className="mx-auto my-6 animate-spin text-glow" size={22} aria-hidden />}
        {shop?.brushes.map((brush) => (
          <li key={brush.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5">
            <span className="grid h-9 w-12 shrink-0 place-items-center rounded-lg bg-black/30">
              <BrushSwatch id={brush.id} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-cream">{t.canvas.brushes[brush.id] ?? brush.id}</span>
              <span className="block text-[10px] leading-snug text-mist">
                {brush.price === 0 ? t.canvas.brushShop.free : brush.owned ? (brush.byLikes ? t.canvas.brushShop.byLikes(brush.likes) : t.canvas.brushShop.owned) : brush.likes > 0 ? t.canvas.brushShop.or(brush.likes, shop.likesReceived) : ''}
              </span>
            </span>
            {brush.owned ? (
              <Check size={16} className="text-like" aria-label={t.canvas.brushShop.owned} />
            ) : (
              <button type="button" disabled={busy !== null || shop.balance < brush.price} onClick={() => void buy(brush.id)} className="flex h-8 items-center gap-1 rounded-full bg-gold px-3 text-xs font-bold text-void active:scale-95 disabled:opacity-40">
                {busy === brush.id ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Lock size={12} aria-hidden />}
                {t.canvas.brushShop.buy(brush.price)}
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  )
}
