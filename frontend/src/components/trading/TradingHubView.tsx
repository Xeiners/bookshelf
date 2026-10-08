import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, ArrowUp, Handshake, Loader2, Plus, RefreshCw, Repeat2, Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { RARITIES, RARITY_STYLE } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { flaggedOffers } from '../../lib/notifications'
import { partyName, sortMarket, type MarketSort } from '../../lib/trades'
import { ApiError } from '../../services/api'
import type { TradeOffer, TradeResult } from '../../services/tradesApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useNotificationStore } from '../../store/useNotificationStore'
import { useTradeStore } from '../../store/useTradeStore'
import { useUiStore } from '../../store/useUiStore'
import { CardBack } from '../cards/CardBack'
import { CollectibleCard } from '../cards/CollectibleCard'
import { CreateTradeSheet } from './CreateTradeSheet'
import { MyTradesSheet } from './MyTradesSheet'
import { TradeSwapAnimation } from './TradeSwapAnimation'

/** Un tap arme le bouton « Échanger » ; sans confirmation dans ce délai, il se désarme. */
const CONFIRM_WINDOW_MS = 3500
/** Rafraîchissement du marché affiché, page visible. */
const REFRESH_MS = 20_000
const GAP = 16

const columnsFor = (width: number) => (width >= 1000 ? 3 : width >= 620 ? 2 : 1)

/**
 * Le Marché : les offres d'échange des autres collectionneurs. Chaque offre :
 * la carte proposée (ce que tu reçois) ⇄ la carte demandée (ce que tu
 * donnes). « Échanger » ne s'active que si tu as un exemplaire libre de la
 * carte demandée ; un second tap confirme, une jauge montre le temps qu'il
 * reste pour le faire. Le marché se rafraîchit seul : les nouvelles offres
 * attendent derrière une pastille, une offre prise entre-temps est marquée
 * « Partie » à sa place. Échange conclu : animation, album rechargé.
 */
export function TradingHubView() {
  const t = useT()
  const signedIn = useAuthStore((state) => state.user !== null)
  const openAuth = useUiStore((state) => state.openAuth)
  const notify = useUiStore((state) => state.notify)
  const query = useTradeStore((state) => state.query)
  const market = useTradeStore((state) => state.market)
  const status = useTradeStore((state) => state.marketStatus)
  const incoming = useTradeStore((state) => state.incoming)
  const gone = useTradeStore((state) => state.gone)
  const mine = useTradeStore((state) => state.mine)
  const sheet = useTradeStore((state) => state.sheet)
  const focusOfferId = useTradeStore((state) => state.focusOfferId)
  const setQuery = useTradeStore((state) => state.setQuery)
  const loadMarket = useTradeStore((state) => state.loadMarket)
  const loadMine = useTradeStore((state) => state.loadMine)
  const refresh = useTradeStore((state) => state.refresh)
  const showIncoming = useTradeStore((state) => state.showIncoming)
  const accept = useTradeStore((state) => state.accept)
  const openSheet = useTradeStore((state) => state.openSheet)
  const focusOffer = useTradeStore((state) => state.focusOffer)
  const notifications = useNotificationStore((state) => state.items)

  const [sort, setSort] = useState<MarketSort>('best')
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [swap, setSwap] = useState<TradeResult | null>(null)

  useEffect(() => {
    if (!signedIn) return
    // Venu d'une notification, le marché est déjà demandé (filtres remis à zéro).
    if (useTradeStore.getState().marketStatus !== 'loading') void loadMarket()
    void loadMine()
  }, [signedIn, loadMarket, loadMine])

  // En direct : le marché affiché se rafraîchit tant que la page est visible.
  useEffect(() => {
    if (!signedIn) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [signedIn, refresh])

  // Bouton armé : il se désarme seul, pour qu'un tap distrait ne conclue rien plus tard.
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(null), CONFIRM_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [listWidth, setListWidth] = useState(0)
  useEffect(() => {
    const node = listRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setListWidth(Math.floor(entry?.contentRect.width ?? 0)))
    observer.observe(node)
    return () => observer.disconnect()
    // La grille n'existe qu'une fois connecté.
  }, [signedIn])
  const columns = columnsFor(listWidth)
  const tileWidth = listWidth > 0 ? (listWidth - GAP * (columns - 1)) / columns : 0
  // Deux cartes et l'orbe d'échange dans la tuile (marges comprises).
  const cardWidth = Math.floor(Math.min(150, Math.max(90, (tileWidth - 32 - 52) / 2)))

  const sorted = useMemo(() => sortMarket(market ?? [], sort), [market, sort])
  const flagged = useMemo(() => flaggedOffers(notifications), [notifications])
  const goneSet = useMemo(() => new Set(gone), [gone])
  const fillable = (market ?? []).filter((offer) => offer.canAccept && !goneSet.has(offer.id)).length

  // Offres qui arrivent : cascade (transform / opacity), seulement pour celles jamais montrées.
  const animated = useRef(new Set<string>())
  const offersKey = sorted.map((offer) => offer.id).join('|')
  useGSAP(
    () => {
      const fresh = gsap.utils.toArray<HTMLElement>('[data-offer]').filter((node) => !animated.current.has(node.dataset.offer ?? ''))
      if (fresh.length === 0) return
      for (const node of fresh) animated.current.add(node.dataset.offer ?? '')
      gsap.fromTo(fresh, { y: 18, autoAlpha: 0, scale: 0.97 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.55, stagger: 0.05, ease: EASE.glide })
    },
    { scope: listRef, dependencies: [offersKey, tileWidth > 0] },
  )

  // Venu d'une notification : l'offre est amenée au centre et s'illumine.
  useEffect(() => {
    if (!focusOfferId || !market || status === 'loading' || tileWidth === 0) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-offer="${CSS.escape(focusOfferId)}"]`)
    if (!node) {
      // Prise entre-temps : on le dit, plutôt qu'un marché sans explication.
      notify(t.notifications.tradeMatch.gone, 'neutral')
      focusOffer(null)
      return
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = window.setTimeout(() => focusOffer(null), 2600)
    return () => window.clearTimeout(timer)
  }, [focusOfferId, market, status, tileWidth, focusOffer, notify, t])

  const onTrade = async (offer: TradeOffer) => {
    if (armed !== offer.id) {
      vibrate(6)
      setArmed(offer.id)
      return
    }
    setArmed(null)
    setBusy(offer.id)
    try {
      setSwap(await accept(offer))
      vibrate([12, 40, 18])
      // Une alerte qui annonçait cette offre n'a plus lieu d'être « nouvelle ».
      const related = useNotificationStore.getState().items.filter((item) => item.type === 'trade_match' && item.data.offerId === offer.id)
      useNotificationStore.getState().markRead(related.map((item) => item.id))
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
      // Offre partie entre-temps : le marché affiché n'est plus à jour.
      if (error instanceof ApiError && (error.code === 'offer_closed' || error.code === 'offer_unavailable')) void refresh()
    } finally {
      setBusy(null)
    }
  }

  const onShowIncoming = () => {
    vibrate(6)
    showIncoming()
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openOffers = (mine ?? []).filter((offer) => offer.mine && offer.status === 'OPEN').length
  const unreadDeals = notifications.filter((item) => !item.read && item.type === 'trade_accepted').length
  const filtered = query.rarity !== 'all' || query.series !== 'all' || query.fillable

  if (!signedIn) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
        <FloatingBacks />
        <p className="max-w-sm text-sm text-cream/80">{t.trades.guest}</p>
        <button type="button" onClick={openAuth} className="rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-void">
          {t.trades.guestCta}
        </button>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="no-scrollbar relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-10">
      <IncomingPill count={incoming.length} onShow={onShowIncoming} />

      <MarketHero
        offers={market ? market.length - gone.length : null}
        fillable={fillable}
        openOffers={openOffers}
        unreadDeals={unreadDeals}
        refreshing={status === 'loading'}
        onRefresh={() => {
          vibrate(6)
          void loadMarket()
        }}
        onCreate={() => openSheet('create')}
        onMine={() => openSheet('mine')}
      />

      {/* Filtres et ordre */}
      <div role="group" aria-label={t.trades.filters.label} className="mt-4 flex flex-col gap-3">
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5" role="radiogroup" aria-label={t.cards.filters.rarity}>
          {(['all', ...RARITIES] as const).map((rarity) => {
            const active = query.rarity === rarity
            const color = rarity === 'all' ? '#f7f5f0' : RARITY_STYLE[rarity].color
            return (
              <button
                key={rarity}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  vibrate(5)
                  setQuery({ rarity })
                }}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-300 ${active ? 'text-void' : 'text-cream/80'}`}
                style={{
                  borderColor: `color-mix(in oklab, ${color} 55%, transparent)`,
                  background: active ? color : 'transparent',
                  boxShadow: active ? `0 6px 20px -8px ${color}` : 'none',
                }}
              >
                {rarity === 'all' ? t.cards.filters.all : t.cards.rarity[rarity]}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmented
            label={t.trades.sort.label}
            value={sort}
            options={[
              { value: 'best', label: t.trades.sort.best },
              { value: 'recent', label: t.trades.sort.recent },
            ]}
            onChange={setSort}
          />
          <Segmented
            label={t.cards.filters.series}
            value={query.series}
            options={[
              { value: 'all', label: t.cards.filters.all },
              { value: 1, label: t.cards.filters.seriesName(1) },
              { value: 2, label: t.cards.filters.seriesName(2) },
              { value: 3, label: t.cards.filters.seriesName(3) },
            ]}
            onChange={(series) => setQuery({ series })}
          />
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-cream/80">
            <input
              type="checkbox"
              checked={query.fillable}
              onChange={(event) => setQuery({ fillable: event.target.checked })}
              className="size-4 accent-gold"
            />
            {t.trades.filters.fillable}
          </label>
        </div>
      </div>

      {/* Offres */}
      <div ref={listRef} className="mt-5">
        {status === 'error' && !market && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-mist">{t.trades.error}</p>
            <button type="button" onClick={() => void loadMarket()} className="rounded-full bg-cream/10 px-4 py-2 text-xs font-semibold text-cream">
              {t.trades.retry}
            </button>
          </div>
        )}
        {!market && status !== 'error' && tileWidth > 0 && <SkeletonGrid columns={columns} />}
        {market && market.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <FloatingBacks />
            <p className="text-sm text-cream/80">{filtered ? t.trades.emptyFiltered : t.trades.empty}</p>
            {!filtered && <p className="max-w-xs text-xs leading-5 text-mist">{t.trades.emptyHint}</p>}
            {!filtered && (
              <button
                type="button"
                onClick={() => openSheet('create')}
                className="inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-semibold text-void"
              >
                <Plus size={14} aria-hidden />
                {t.trades.create}
              </button>
            )}
          </div>
        )}
        {market && market.length > 0 && tileWidth > 0 && (
          <ul className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP }}>
            {sorted.map((offer) => (
              <OfferTile
                key={offer.id}
                offer={offer}
                cardWidth={cardWidth}
                armed={armed === offer.id}
                busy={busy === offer.id}
                gone={goneSet.has(offer.id)}
                flagged={flagged.has(offer.id)}
                focused={focusOfferId === offer.id}
                onTrade={() => void onTrade(offer)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Portail : `<main>` est transformé par GSAP et piégerait les feuilles sous la barre de navigation. */}
      {sheet === 'create' && createPortal(<CreateTradeSheet onClose={() => openSheet(null)} />, document.body)}
      {sheet === 'mine' && createPortal(<MyTradesSheet onClose={() => openSheet(null)} />, document.body)}
      {swap && <TradeSwapAnimation given={swap.given} received={swap.received} onDone={() => setSwap(null)} />}
    </div>
  )
}

/* ---- En-tête ------------------------------------------------------------------------------ */

interface MarketHeroProps {
  offers: number | null
  fillable: number
  openOffers: number
  unreadDeals: number
  refreshing: boolean
  onRefresh: () => void
  onCreate: () => void
  onMine: () => void
}

/**
 * En-tête du Marché : présentation, compteurs en direct (pastille qui bat),
 * actions. Deux dos de cartes se croisent lentement dans le coin, en boucle —
 * transform seulement, rien à repeindre.
 */
function MarketHero({ offers, fillable, openOffers, unreadDeals, refreshing, onRefresh, onCreate, onMine }: MarketHeroProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.fromTo('[data-live-ring]', { scale: 1, autoAlpha: 0.7 }, { scale: 2.6, autoAlpha: 0, duration: 1.6, ease: 'power1.out', repeat: -1 })
      // Les deux cartes échangent leur place, puis reviennent : un échange sans fin.
      const swap = gsap.timeline({ repeat: -1, yoyo: true, repeatDelay: 1.4, defaults: { duration: 1.6, ease: 'power2.inOut' } })
      swap
        .to('[data-hero-card="a"]', { x: 34, y: 6, rotation: 10, rotationY: 180, transformPerspective: 600 }, 0)
        .to('[data-hero-card="b"]', { x: -34, y: -6, rotation: -12, rotationY: -180, transformPerspective: 600 }, 0)
    },
    { scope: rootRef },
  )

  useGSAP(
    () => {
      if (!refreshing) return
      gsap.to('[data-refresh-icon]', { rotation: '+=360', duration: 0.8, ease: 'power2.inOut', repeat: -1 })
    },
    { scope: rootRef, dependencies: [refreshing], revertOnUpdate: true },
  )

  return (
    <div
      ref={rootRef}
      // `shrink-0` : en `overflow-hidden`, un enfant flex n'a plus de hauteur minimale et se ferait écraser.
      className="relative shrink-0 overflow-hidden rounded-3xl border border-[#ffe39a]/20 p-5"
      style={{ background: 'radial-gradient(120% 140% at 100% 0%, rgba(255,196,107,0.14), transparent 55%), radial-gradient(90% 120% at 0% 100%, rgba(124,92,255,0.16), transparent 60%), #0c0b12' }}
    >
      {/* Dos de cartes qui s'échangent, en décor (coin supérieur droit). */}
      <div aria-hidden className="pointer-events-none absolute top-3 right-4 hidden h-24 w-28 sm:block">
        <span data-hero-card="a" className="absolute top-2 left-0 -rotate-6 will-change-transform">
          <CardBack width={46} animated={false} />
        </span>
        <span data-hero-card="b" className="absolute top-0 right-0 rotate-6 will-change-transform">
          <CardBack width={46} animated={false} />
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-0 sm:pr-32">
        <span className="relative grid size-2 place-items-center">
          <span data-live-ring aria-hidden className="absolute inset-0 rounded-full bg-like will-change-transform" />
          <span className="relative size-2 rounded-full bg-like" />
        </span>
        <p className="text-[10px] tracking-[0.22em] text-like/90 uppercase">{t.trades.live}</p>
        <span className="text-[10px] tracking-[0.22em] text-gold/70 uppercase">{t.trades.eyebrow}</span>
      </div>
      <h2 className="mt-2 flex items-center gap-2 font-display text-3xl text-cream md:text-4xl">
        <Handshake size={26} className="text-gold" aria-hidden />
        {t.trades.title}
      </h2>
      <p className="mt-1 max-w-md text-sm text-cream/65">{t.trades.body}</p>
      <p className="mt-2 h-4 text-xs text-mist tabular-nums">{offers === null ? '' : t.trades.stats(offers, fillable)}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-semibold text-void shadow-[0_8px_24px_-10px_var(--color-gold)]"
        >
          <Plus size={14} aria-hidden />
          {t.trades.create}
        </button>
        <button
          type="button"
          onClick={onMine}
          className="relative inline-flex items-center gap-1.5 rounded-full bg-cream/10 px-4 py-2 text-xs font-semibold text-cream"
        >
          <Repeat2 size={14} aria-hidden />
          {openOffers > 0 ? t.trades.mineCount(openOffers) : t.trades.mine}
          {unreadDeals > 0 && (
            <span aria-hidden className="absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-nope px-1 text-[10px] font-bold text-white">
              {unreadDeals}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          aria-label={t.trades.refresh}
          title={t.trades.refresh}
          className="ml-auto grid size-9 place-items-center rounded-full bg-cream/[0.06] text-cream/70"
        >
          <span data-refresh-icon className="grid">
            <RefreshCw size={15} />
          </span>
        </button>
      </div>
    </div>
  )
}

/* ---- Pastille « nouvelles offres » --------------------------------------------------------- */

/** Collée en haut du défilement ; elle tombe quand des offres attendent, et remonte une fois affichées. */
function IncomingPill({ count, onShow }: { count: number; onShow: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const shown = count > 0
  const [label, setLabel] = useState(count)
  if (shown && label !== count) setLabel(count)

  const placed = useRef(false)
  useGSAP(
    () => {
      // Premier rendu : posée hors champ sans animation.
      if (!placed.current) {
        placed.current = true
        if (!shown) {
          gsap.set(ref.current, { yPercent: -160, autoAlpha: 0 })
          return
        }
      }
      gsap.to(ref.current, shown ? { yPercent: 0, autoAlpha: 1, duration: 0.55, ease: EASE.snap } : { yPercent: -160, autoAlpha: 0, duration: 0.3, ease: EASE.exit })
    },
    { dependencies: [shown] },
  )

  return (
    <div className="pointer-events-none sticky top-2 z-20 h-0">
      <div ref={ref} className="invisible flex justify-center will-change-transform">
        <button
          type="button"
          onClick={onShow}
          tabIndex={shown ? 0 : -1}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-glow px-4 py-2 text-xs font-semibold text-white shadow-[0_10px_30px_-10px_var(--color-glow)]"
        >
          <ArrowUp size={14} aria-hidden />
          {t.trades.incoming(label)}
        </button>
      </div>
    </div>
  )
}

/* ---- Tuile d'offre ------------------------------------------------------------------------ */

interface OfferTileProps {
  offer: TradeOffer
  cardWidth: number
  armed: boolean
  busy: boolean
  /** Prise ou annulée depuis l'affichage. */
  gone: boolean
  /** Signalée par une notification non lue. */
  flagged: boolean
  /** Ouverte depuis une notification : mise en lumière. */
  focused: boolean
  onTrade: () => void
}

function OfferTile({ offer, cardWidth, armed, busy, gone, flagged, focused, onTrade }: OfferTileProps) {
  const t = useT()
  const openPublicProfile = useUiStore((state) => state.openPublicProfile)
  const rootRef = useRef<HTMLLIElement>(null)
  const color = RARITY_STYLE[offer.offered.rarity].color
  const ready = offer.canAccept && !gone
  const forYou = flagged || (ready && !offer.ownsOffered)
  const label = busy ? t.trades.accepting : armed ? t.trades.confirm : offer.canAccept ? t.trades.accept : t.trades.requestedMissing

  // Armé : l'orbe tourne, la jauge du temps restant pour confirmer se vide.
  useGSAP(
    () => {
      if (!armed) return
      gsap.to('[data-tile-orb-icon]', { rotation: 360, duration: 1.1, ease: 'none', repeat: -1 })
      gsap.fromTo('[data-tile-countdown]', { scaleX: 1 }, { scaleX: 0, duration: CONFIRM_WINDOW_MS / 1000, ease: 'none' })
      gsap.fromTo('[data-tile-get]', { y: 0 }, { y: -6, duration: 0.35, ease: EASE.snap })
    },
    { scope: rootRef, dependencies: [armed], revertOnUpdate: true },
  )

  // Partie : le tampon s'écrase sur la tuile.
  useGSAP(
    () => {
      if (!gone) return
      gsap.fromTo('[data-tile-stamp]', { scale: 1.8, autoAlpha: 0, rotation: -18 }, { scale: 1, autoAlpha: 1, rotation: -8, duration: 0.45, ease: EASE.snap })
    },
    { scope: rootRef, dependencies: [gone] },
  )

  // Venue d'une notification : trois pulsations d'or autour de la tuile.
  useGSAP(
    () => {
      if (!focused) return
      gsap.fromTo('[data-tile-focus]', { autoAlpha: 0, scale: 0.97 }, { autoAlpha: 1, scale: 1.015, duration: 0.45, ease: 'sine.inOut', repeat: 5, yoyo: true, delay: 0.35 })
    },
    { scope: rootRef, dependencies: [focused], revertOnUpdate: true },
  )

  const { contextSafe } = useGSAP({ scope: rootRef })
  /** Survol (souris) : les deux cartes s'écartent en pivotant l'une vers l'autre, l'orbe fait un demi-tour. */
  const lean = (on: boolean) =>
    contextSafe(() => {
      if (!window.matchMedia('(hover: hover)').matches || gone) return
      const settings = { duration: 0.5, ease: EASE.swift, transformPerspective: 700, overwrite: 'auto' as const }
      gsap.to('[data-tile-get]', { ...settings, x: on ? -5 : 0, rotationY: on ? 12 : 0 })
      gsap.to('[data-tile-give]', { ...settings, x: on ? 5 : 0, rotationY: on ? -12 : 0 })
      gsap.to('[data-tile-orb]', { ...settings, rotation: on ? 180 : 0, scale: on ? 1.1 : 1 })
    })()

  return (
    <li
      ref={rootRef}
      data-offer={offer.id}
      onPointerEnter={() => lean(true)}
      onPointerLeave={() => lean(false)}
      className="relative flex flex-col rounded-3xl border p-4 transition-[border-color,box-shadow,opacity] duration-500"
      style={{
        background: ready ? `linear-gradient(180deg, color-mix(in oklab, ${color} 7%, #121219), #101017)` : '#111118',
        borderColor: ready ? `color-mix(in oklab, ${color} 45%, transparent)` : 'rgb(255 255 255 / 0.08)',
        boxShadow: ready ? `0 18px 40px -24px ${color}` : 'none',
        opacity: gone ? 0.55 : 1,
      }}
      aria-label={t.trades.offerAria(offer.offered.name, offer.requested.name)}
    >
      {/* Mise en lumière (venue d'une notification) : un anneau d'or qui pulse. */}
      <span data-tile-focus aria-hidden className="pointer-events-none invisible absolute -inset-1 rounded-[1.75rem] border-2 border-gold shadow-[0_0_28px_-6px_var(--color-gold)]" />

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => openPublicProfile(offer.owner.id)}
          className="min-w-0 truncate text-left text-[11px] text-mist underline-offset-2 hover:text-cream hover:underline"
        >
          {t.trades.offerBy(partyName(offer.owner, t.trades.anonymous))}
        </button>
        <span className="flex shrink-0 items-center gap-1.5">
          {forYou && !gone && (
            <span className="inline-flex items-center gap-1 rounded-full bg-like/15 px-2 py-0.5 text-[10px] font-semibold text-like">
              <Sparkles size={10} aria-hidden />
              {t.trades.forYou}
            </span>
          )}
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}>
            {t.cards.rarity[offer.offered.rarity]}
          </span>
        </span>
      </div>

      <div className="relative mt-3 flex items-start justify-center gap-2.5">
        <figure className="flex min-w-0 flex-col items-center gap-2">
          <figcaption className="text-[10px] tracking-[0.16em] text-like uppercase">{t.trades.youGet}</figcaption>
          <div data-tile-get className="will-change-transform">
            {/* Sans effets holo : une aura animée par tuile, sur cent offres, ferait ramer le marché. */}
            <CollectibleCard card={offer.offered} width={cardWidth} effects={false} />
          </div>
          <span className={`text-[10px] ${offer.ownsOffered ? 'text-mist' : 'text-gold'}`}>
            {offer.ownsOffered ? t.trades.alreadyOwned : t.trades.newForYou}
          </span>
        </figure>
        <span
          data-tile-orb
          aria-hidden
          className="mt-[38%] grid size-10 shrink-0 place-items-center rounded-full border will-change-transform"
          style={{
            borderColor: `color-mix(in oklab, ${armed ? 'var(--color-like)' : color} 60%, transparent)`,
            background: armed ? 'color-mix(in oklab, var(--color-like) 18%, #0b0b12)' : '#0b0b12',
            boxShadow: `0 0 18px -6px ${armed ? 'var(--color-like)' : color}`,
          }}
        >
          <span data-tile-orb-icon className={`grid ${armed ? 'text-like' : 'text-cream/70'}`}>
            <ArrowLeftRight size={17} />
          </span>
        </span>
        <figure className="flex min-w-0 flex-col items-center gap-2">
          <figcaption className="text-[10px] tracking-[0.16em] text-nope uppercase">{t.trades.youGive}</figcaption>
          <div data-tile-give className="will-change-transform">
            <CollectibleCard card={offer.requested} width={cardWidth} effects={false} />
          </div>
          <span className={`max-w-full truncate text-[10px] ${offer.canAccept ? 'text-mist' : 'text-nope/80'}`}>
            {offer.canAccept ? offer.requested.name : t.trades.requestedMissing}
          </span>
        </figure>

        {/* Tampon « Partie » : un autre collectionneur a été plus rapide. */}
        {gone && (
          <span
            data-tile-stamp
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border-[3px] border-nope px-4 py-1 font-display text-3xl tracking-wide text-nope uppercase"
            style={{ background: 'rgb(11 11 18 / 0.85)' }}
          >
            {t.trades.gone}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onTrade}
        disabled={!offer.canAccept || busy || gone}
        className={`relative mt-4 flex h-11 items-center justify-center gap-1.5 overflow-hidden rounded-full text-sm font-semibold transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-40 ${
          armed ? 'bg-like text-void' : 'bg-gold text-void'
        }`}
      >
        {/* Temps restant pour confirmer : une bande claire qui se retire. */}
        {armed && <span data-tile-countdown aria-hidden className="absolute inset-0 origin-left bg-white/30 will-change-transform" />}
        <span className="relative inline-flex items-center gap-1.5">
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ArrowLeftRight size={15} aria-hidden />}
          {label}
        </span>
      </button>
      <p className={`mt-1.5 h-3.5 text-center text-[10.5px] ${gone ? 'text-nope/80' : 'text-like/80'}`} aria-live="polite">
        {gone ? t.trades.goneHint : armed ? t.trades.confirmHint : ''}
      </p>
    </li>
  )
}

/* ---- Petits éléments ------------------------------------------------------------------------ */

interface SegmentedProps<V extends string | number> {
  label: string
  value: V
  options: { value: V; label: string }[]
  onChange: (value: V) => void
}

/** Choix exclusif en capsule ; la pastille active glisse d'une option à l'autre (GSAP, sans mesure au rendu). */
function Segmented<V extends string | number>({ label, value, options, onChange }: SegmentedProps<V>) {
  const ref = useRef<HTMLDivElement>(null)
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  const placed = useRef(false)
  // Les libellés changent avec la langue : la pastille se recale sur leur nouvelle largeur.
  const labels = options.map((option) => option.label).join('|')

  useGSAP(
    () => {
      const target = ref.current?.querySelectorAll<HTMLElement>('[data-seg]')[index]
      if (!target) return
      // Premier placement immédiat ; ensuite, la pastille glisse.
      const duration = placed.current ? 0.4 : 0
      placed.current = true
      gsap.to('[data-seg-thumb]', { x: target.offsetLeft - 4, width: target.offsetWidth, duration, ease: 'power3.out', overwrite: 'auto' })
    },
    { scope: ref, dependencies: [index, labels] },
  )

  return (
    <div ref={ref} role="radiogroup" aria-label={label} className="glass relative flex rounded-full p-1">
      <span data-seg-thumb aria-hidden className="absolute inset-y-1 left-1 w-0 rounded-full bg-glow will-change-transform" />
      {options.map((option) => (
        <button
          key={String(option.value)}
          data-seg
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => {
            if (option.value === value) return
            vibrate(5)
            onChange(option.value)
          }}
          className={`relative z-10 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-300 ${option.value === value ? 'text-white' : 'text-cream/75'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Chargement : des tuiles fantômes, parcourues d'un reflet. */
function SkeletonGrid({ columns }: { columns: number }) {
  return (
    <ul aria-hidden className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP }}>
      {Array.from({ length: columns * 2 }, (_, index) => (
        <li key={index} className="relative h-64 overflow-hidden rounded-3xl border border-white/8 bg-[#111118]">
          <div className="flex h-full items-center justify-center gap-6 px-6">
            <span className="aspect-[63/88] w-1/3 rounded-lg bg-white/[0.04]" />
            <span className="size-10 rounded-full bg-white/[0.04]" />
            <span className="aspect-[63/88] w-1/3 rounded-lg bg-white/[0.04]" />
          </div>
          <span className="absolute inset-y-0 left-0 w-1/2 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
        </li>
      ))}
    </ul>
  )
}

/** Trois dos de cartes en éventail qui flottent (invité, marché vide). */
function FloatingBacks() {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.to('[data-float]', { y: -8, duration: 1.8, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: { each: 0.35, from: 'center' } })
    },
    { scope: ref },
  )
  return (
    <div ref={ref} aria-hidden className="relative flex h-28 w-40 items-end justify-center">
      {[-14, 0, 14].map((angle, index) => (
        // Pose fixe sur l'enveloppe, flottement (GSAP) sur l'enfant : aucune des deux n'écrase l'autre.
        <span
          key={angle}
          className="absolute bottom-0"
          style={{ transform: `translateX(${(index - 1) * 34}px) rotate(${angle}deg)`, zIndex: index === 1 ? 2 : 1 }}
        >
          <span data-float className="block will-change-transform">
            <CardBack width={58} animated={false} />
          </span>
        </span>
      ))}
    </div>
  )
}
