import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Loader2, Sparkles, X } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { partyName, splitMine } from '../../lib/trades'
import type { TradeCard, TradeOffer } from '../../services/tradesApi'
import { useNotificationStore } from '../../store/useNotificationStore'
import { useTradeStore } from '../../store/useTradeStore'
import { useUiStore } from '../../store/useUiStore'
import { CollectibleCard } from '../cards/CollectibleCard'
import { Sheet } from '../ui/Sheet'

/** Un tap arme « Annuler » ; sans confirmation dans ce délai, il se désarme. */
const CONFIRM_WINDOW_MS = 3500

/**
 * « Mes échanges » : mes offres ouvertes (annulables : le doublon redevient
 * libre), puis l'historique — offres échangées ou annulées, et celles des
 * autres que j'ai acceptées.
 */
export function MyTradesSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const copy = t.trades.mineSheet
  const mine = useTradeStore((state) => state.mine)
  const status = useTradeStore((state) => state.mineStatus)
  const loadMine = useTradeStore((state) => state.loadMine)
  const cancel = useTradeStore((state) => state.cancel)
  const notify = useUiStore((state) => state.notify)
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  // Échanges conclus pendant l'absence : marqués « Nouveau » le temps de cette visite, et leurs notifications lues.
  const [fresh] = useState(
    () =>
      new Set(
        useNotificationStore
          .getState()
          .items.flatMap((item) => (!item.read && item.type === 'trade_accepted' ? [item.data.offerId] : [])),
      ),
  )
  useEffect(() => {
    const store = useNotificationStore.getState()
    store.markRead(store.items.flatMap((item) => (item.type === 'trade_accepted' && fresh.has(item.data.offerId) ? [item.id] : [])))
  }, [fresh])

  const listRef = useRef<HTMLDivElement>(null)
  const loaded = mine !== null
  useGSAP(
    () => {
      if (!loaded) return
      gsap.fromTo('[data-trade-row]', { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.04, ease: EASE.glide, delay: 0.2 })
      gsap.fromTo('[data-trade-new]', { scale: 0 }, { scale: 1, duration: 0.5, ease: EASE.snap, delay: 0.5, stagger: 0.08 })
    },
    { scope: listRef, dependencies: [loaded] },
  )

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(null), CONFIRM_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  const onCancel = async (offer: TradeOffer) => {
    if (armed !== offer.id) {
      setArmed(offer.id)
      return
    }
    setArmed(null)
    setBusy(offer.id)
    try {
      await cancel(offer.id)
      notify(copy.cancelled, 'neutral')
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
      void loadMine()
    } finally {
      setBusy(null)
    }
  }

  const { open, history } = splitMine(mine ?? [])
  const date = (iso: string) => new Date(iso).toLocaleDateString(t.locale, { day: 'numeric', month: 'short' })

  return (
    <Sheet label={copy.title} title={copy.title} subtitle={copy.subtitle} onClose={onClose}>
      <div ref={listRef}>
      {!mine && status !== 'error' && (
        <div className="flex justify-center py-8 text-mist">
          <Loader2 size={20} className="animate-spin" aria-hidden />
        </div>
      )}
      {mine && open.length === 0 && history.length === 0 && <p className="py-8 text-center text-sm text-mist">{copy.empty}</p>}

      {open.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] tracking-[0.18em] text-mist uppercase">{copy.open}</h3>
          <ul className="flex flex-col gap-2">
            {open.map((offer) => (
              <TradeRow key={offer.id} gave={offer.offered} got={offer.requested} line={copy.waiting} when={date(offer.createdAt)}>
                <button
                  type="button"
                  onClick={() => void onCancel(offer)}
                  disabled={busy === offer.id}
                  className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold disabled:opacity-40 ${
                    armed === offer.id ? 'bg-nope text-void' : 'bg-cream/10 text-cream'
                  }`}
                >
                  {busy === offer.id ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <X size={13} aria-hidden />}
                  {armed === offer.id ? copy.confirmCancel : copy.cancel}
                </button>
              </TradeRow>
            ))}
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <section className={open.length > 0 ? 'mt-6' : ''}>
          <h3 className="mb-2 text-[11px] tracking-[0.18em] text-mist uppercase">{copy.history}</h3>
          <ul className="flex flex-col gap-2">
            {history.map((offer) => {
              // Ce que j'ai cédé à gauche, ce que j'ai reçu à droite.
              const mineOffer = offer.mine
              const line =
                offer.status === 'CANCELLED'
                  ? copy.cancelledStatus
                  : mineOffer
                    ? copy.completedWith(partyName(offer.acceptedBy, t.trades.anonymous))
                    : copy.acceptedFrom(partyName(offer.owner, t.trades.anonymous))
              return (
                <TradeRow
                  key={offer.id}
                  gave={mineOffer ? offer.offered : offer.requested}
                  got={mineOffer ? offer.requested : offer.offered}
                  line={line}
                  when={date(offer.updatedAt)}
                  muted={offer.status === 'CANCELLED'}
                  fresh={fresh.has(offer.id)}
                />
              )
            })}
          </ul>
        </section>
      )}
      </div>
    </Sheet>
  )
}

interface TradeRowProps {
  gave: TradeCard
  got: TradeCard
  line: string
  when: string
  muted?: boolean
  /** Conclu pendant l'absence (notification pas encore lue). */
  fresh?: boolean
  children?: ReactNode
}

function TradeRow({ gave, got, line, when, muted = false, fresh = false, children }: TradeRowProps) {
  const t = useT()
  return (
    <li
      data-trade-row
      className={`relative flex items-center gap-3 rounded-2xl border p-2.5 ${muted ? 'opacity-55' : ''} ${fresh ? 'border-like/40 bg-like/[0.06]' : 'border-white/8'}`}
    >
      {fresh && (
        <span data-trade-new className="absolute -top-2 right-3 inline-flex items-center gap-1 rounded-full bg-like px-2 py-0.5 text-[9.5px] font-bold text-void uppercase">
          <Sparkles size={9} aria-hidden />
          {t.trades.newDeal}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        <CollectibleCard card={gave} width={44} effects={false} />
        <ArrowRight size={14} className="text-cream/50" aria-hidden />
        <CollectibleCard card={got} width={44} effects={false} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-cream">
          {gave.name} → {got.name}
        </p>
        <p className="truncate text-[11px] text-mist">
          {line} · {when}
        </p>
      </div>
      {children}
    </li>
  )
}
