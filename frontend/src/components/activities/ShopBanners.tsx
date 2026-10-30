import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, Gift, Send, Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import type { BoxKind } from '../../lib/runner/wardrobe'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import type { Promotion } from '../../services/promotionsApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { promotionOf, usePromotions } from '../../store/usePromotions'
import { useRunnerWardrobe } from '../../store/useRunnerWardrobeStore'
import { useUiStore } from '../../store/useUiStore'
import { BoosterPackArt } from '../boosters/BoosterPackArt'
import { BuyBoostersSheet } from '../boosters/BuyBoostersSheet'
import { BuyLegendarySheet } from '../boosters/BuyLegendarySheet'
import { LEGENDARY_PACK_PRICE } from '../../lib/boosters'

/*
 * La boutique, sous l'autel des boosters : dépenser ses Poussières sans quitter les activités.
 * En vitrine, deux boosters côte à côte — le classique (de 1 à 6, rangés dans la réserve) et le
 * Légendaire (acheté et ouvert d'un coup) — puis la boîte mystère de la garde-robe du Manga
 * Runner : la gratuite du jour, ou une payée, ouverte directement ici.
 */

/** L'ouverture en 3D (Three.js, modèles) : chargée seulement quand on ouvre une boîte. */
const MysteryBox = lazy(() => import('../runner/MysteryBox').then((module) => ({ default: module.MysteryBox })))
const GiftBoxSheet = lazy(() => import('../runner/GiftBoxSheet').then((module) => ({ default: module.GiftBoxSheet })))

/**
 * Le prix d'un article ; en promotion, le prix habituel barré au-dessus, une étiquette
 * « −40 % » et le temps qui reste.
 */
function PricePill({ price, promo, now, className = '', style }: { price: number | null; promo: Promotion | null; now: number; className?: string; style?: CSSProperties }) {
  const t = useT()
  return (
    <span className="relative flex flex-col items-center">
      {promo && (
        <span className="absolute -top-3.5 -right-2 z-10 rotate-6 rounded-full bg-[#ff4d6d] px-1.5 py-0.5 text-[9px] font-black text-white shadow-[0_0_14px_rgba(255,77,109,0.7)]">
          −{Math.round((1 - promo.price / promo.regular) * 100)} %
        </span>
      )}
      <span className={`flex flex-col items-center rounded-full px-3 py-1.5 text-sm leading-none font-bold ${className}`} style={style}>
        {promo && <span className="text-[10px] font-semibold line-through opacity-60">{promo.regular} ✦</span>}
        <span>{price ?? '…'} ✦</span>
      </span>
      {promo && <span className="mt-1 text-[9px] font-semibold tracking-wide whitespace-nowrap text-[#ff8fa3] tabular-nums">{t.activities.shop.promoEnds(countdown(Date.parse(promo.endsAt) - now))}</span>}
    </span>
  )
}

const pad = (value: number) => String(value).padStart(2, '0')
function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
}

/**
 * Un article de la vitrine : une scène (le paquet sur un halo de sa couleur), son nom, ce qu'il
 * contient, et le prix en bas, comme un bouton. `prestige` : liseré et halo dorés.
 */
function ProductCard({
  name,
  detail,
  tag,
  tint,
  art,
  price,
  promo,
  now,
  onClick,
  prestige = false,
}: {
  name: string
  detail: string
  tag: string
  tint: string
  art: ReactNode
  price: number | null
  promo: Promotion | null
  now: number
  onClick: () => void
  prestige?: boolean
}) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className="group relative isolate flex min-w-0 flex-col overflow-hidden rounded-[1.4rem] border text-left transition-transform duration-200 active:scale-[0.97]"
      style={{
        borderColor: prestige ? `${tint}80` : 'rgba(255,255,255,0.09)',
        background: `linear-gradient(180deg, ${tint}${prestige ? '24' : '14'} 0%, #100d17 55%, #0b0a10 100%)`,
        boxShadow: prestige ? `0 0 34px -16px ${tint}` : undefined,
      }}
    >
      {/* Scène : le paquet qui flotte sur un halo. */}
      <span aria-hidden className="relative grid h-[7.25rem] place-items-center">
        <span className="absolute size-28 rounded-full" style={{ background: `radial-gradient(closest-side, ${tint}${prestige ? '55' : '3a'}, transparent)` }} />
        <span data-shop-bob className="relative will-change-transform" style={{ transform: 'rotate(-7deg)' }}>
          {art}
        </span>
        <span
          className="absolute top-2.5 left-2.5 rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-[0.16em] uppercase"
          style={{ borderColor: `${tint}55`, background: 'rgba(0,0,0,0.45)', color: tint }}
        >
          {tag}
        </span>
        {promo && (
          <span className="absolute top-2.5 right-2.5 rounded-full bg-[#ff4d6d] px-1.5 py-0.5 text-[9px] font-black text-white">
            −{Math.round((1 - promo.price / promo.regular) * 100)} %
          </span>
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 pb-3">
        <span className="truncate font-display text-[17px] leading-tight text-cream">{name}</span>
        <span className="line-clamp-2 min-h-[2.4em] text-[11px] leading-[1.2] text-cream/55">{detail}</span>
        <span
          className="mt-2 flex h-10 items-center justify-center gap-1.5 rounded-full text-sm font-bold tabular-nums transition-[filter] group-hover:brightness-110"
          style={prestige ? { background: 'linear-gradient(135deg, #fff0a8, #ffc23a 55%, #ff9a3d)', color: '#2a1404' } : { background: 'rgba(255,255,255,0.08)', color: '#f7f5f0' }}
        >
          {promo && <span className="text-[11px] font-semibold line-through opacity-55">{promo.regular}</span>}
          {price === null ? '…' : price.toLocaleString()} ✦
        </span>
        {promo && <span className="mt-1 text-center text-[9px] font-semibold tracking-wide text-[#ff8fa3] tabular-nums">{t.activities.shop.promoEnds(countdown(Date.parse(promo.endsAt) - now))}</span>}
      </span>
    </button>
  )
}

export function ShopBanners() {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const signedIn = useAuthStore((state) => state.user !== null)
  const openAuth = useUiStore((state) => state.openAuth)
  const notify = useUiStore((state) => state.notify)
  const overview = useDleStore((state) => state.overview)
  const wardrobe = useRunnerWardrobe((state) => state.view)
  const loadWardrobe = useRunnerWardrobe((state) => state.load)
  const [open, setOpen] = useState<'box' | null>(null)
  /** Feuille d'achat des boosters ouverte. */
  const [buying, setBuying] = useState(false)
  /** Feuille du Booster Légendaire ouverte. */
  const [buyingLegendary, setBuyingLegendary] = useState(false)
  const [box, setBox] = useState<{ kind: BoxKind; key: number } | null>(null)
  const [gifting, setGifting] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const promotions = usePromotions((state) => state.items)
  useEffect(() => {
    void usePromotions.getState().load()
  }, [])

  useEffect(() => {
    if (signedIn) void loadWardrobe()
  }, [signedIn, loadWardrobe])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.to('[data-shop-bob]', { y: -3, rotation: -4, duration: 0.9, ease: 'sine.inOut', repeat: -1, yoyo: true, stagger: 0.4 })
    },
    { scope: ref },
  )

  const balance = overview?.stardust ?? wardrobe?.balance ?? 0
  // Promotions en cours : prix réduit, prix habituel barré, et la fin.
  const boosterPromo = promotionOf(promotions, 'booster', now)
  const boxPromo = promotionOf(promotions, 'box', now)
  const boosterPrice = boosterPromo?.price ?? overview?.boosterPrice ?? null
  const boxPrice = boxPromo?.price ?? wardrobe?.price ?? null
  const freeAt = wardrobe?.freeAt ? Date.parse(wardrobe.freeAt) : null
  const freeReady = wardrobe !== null && (freeAt === null || freeAt <= now)
  const gifts = wardrobe?.gifts ?? 0
  const glowing = freeReady || gifts > 0

  const buyBoosters = () => {
    vibrate(8)
    if (!signedIn) {
      openAuth()
      return
    }
    if (boosterPrice === null) return
    if (balance < boosterPrice) {
      notify(t.activities.shop.short(boosterPrice - balance), 'nope')
      return
    }
    setBuying(true)
  }

  const buyLegendary = () => {
    vibrate(8)
    if (!signedIn) {
      openAuth()
      return
    }
    if (balance < LEGENDARY_PACK_PRICE) {
      notify(t.activities.shop.short(LEGENDARY_PACK_PRICE - balance), 'nope')
      return
    }
    setBuyingLegendary(true)
  }

  const toggle = (which: 'box') => {
    vibrate(8)
    if (!signedIn) {
      openAuth()
      return
    }
    setOpen((current) => (current === which ? null : which))
  }

  const openBox = (kind: BoxKind) => {
    if (kind === 'paid' && boxPrice !== null && balance < boxPrice) {
      notify(t.activities.shop.short(boxPrice - balance), 'nope')
      return
    }
    vibrate(12)
    setOpen(null)
    setBox({ kind, key: Date.now() })
  }

  return (
    <div ref={ref} className="flex shrink-0 flex-col gap-3">
      {/* En-tête : la boutique et le solde, pour savoir d'un coup d'œil ce qu'on peut s'offrir. */}
      <div className="flex items-center justify-between gap-3 px-1">
        <h3 className="font-display text-xl leading-none text-cream">{t.activities.shop.title}</h3>
        {signedIn && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-[#ffe39a]/25 bg-black/40 px-2.5 py-1 text-xs font-bold text-[#fff4c8] tabular-nums"
            aria-label={t.activities.shop.balance(balance)}
          >
            {balance.toLocaleString()} <span className="text-gold">✦</span>
          </span>
        )}
      </div>

      {/* Les boosters, en vitrine : le classique (de 1 à 6, dans la réserve) et le Légendaire (acheté et ouvert d'un coup). */}
      <div className="grid grid-cols-2 gap-2.5">
        <ProductCard
          name={t.activities.shop.boosterName}
          detail={t.activities.shop.boosterShort}
          tag={t.activities.shop.boosterTag}
          tint="#9b8cff"
          art={<BoosterPackArt width={54} series={3} lit />}
          price={boosterPrice}
          promo={boosterPromo}
          now={now}
          onClick={buyBoosters}
        />
        <ProductCard
          name={t.activities.shop.legendaryTitle}
          detail={t.activities.shop.legendaryShort}
          tag={t.activities.shop.legendaryTag}
          tint="#ffc46b"
          art={<BoosterPackArt width={54} series={3} lit halo="LEGENDARY" />}
          price={LEGENDARY_PACK_PRICE}
          promo={null}
          now={now}
          onClick={buyLegendary}
          prestige
        />
      </div>
      {buying && boosterPrice !== null && <BuyBoostersSheet price={boosterPrice} balance={balance} onClose={() => setBuying(false)} />}
      {buyingLegendary && <BuyLegendarySheet balance={balance} onClose={() => setBuyingLegendary(false)} />}

      {/* Boîte mystère de la garde-robe. */}
      <section
        className="overflow-hidden rounded-[1.4rem] border"
        // Même surface sombre que la vitrine des boosters, teintée du violet de la garde-robe.
        style={{ borderColor: glowing ? '#ffd35c99' : 'rgba(255,255,255,0.09)', background: 'linear-gradient(110deg, #b05cff26 0%, #100d17 55%, #0b0a10 100%)', boxShadow: glowing ? '0 0 30px -12px #ffc23a' : undefined }}
      >
        <button type="button" onClick={() => toggle('box')} aria-expanded={open === 'box'} className="relative flex w-full items-center gap-3 overflow-hidden p-3.5 text-left sm:gap-4 sm:p-4">
          <span data-shop-bob aria-hidden className="relative grid size-12 shrink-0 place-items-center will-change-transform">
            <span className="absolute inset-0 rounded-xl" style={{ background: 'linear-gradient(160deg, #5a24a8, #2a1150)', boxShadow: `0 0 18px -2px ${glowing ? '#ffd35c' : '#b05cff'}, inset 0 0 0 2px #ffc93c` }} />
            <span className="absolute inset-y-0 left-1/2 w-2 -translate-x-1/2 bg-[#ffc93c]" />
            <span className="absolute inset-x-0 top-[38%] h-2 bg-[#ffc93c]" />
            <span className="relative font-display text-xl text-[#ffe9a8]">?</span>
            {glowing && <span className="absolute -top-1 -right-1 size-3 animate-ping rounded-full bg-like" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10px] font-semibold tracking-[0.2em] text-[#dcb2ff]/80 uppercase">{t.activities.shop.boxEyebrow}</span>
            <span className="block font-display text-lg leading-tight text-cream sm:text-xl">{t.runner.wardrobe.box.title}</span>
            <span className={`block text-xs tabular-nums ${glowing ? 'font-bold text-gold' : 'text-cream/60'}`}>
              {gifts > 0 ? t.runner.wardrobe.box.gifted(gifts) : freeReady ? t.runner.wardrobe.box.freeReady : freeAt ? t.runner.wardrobe.box.freeIn(countdown(freeAt - now)) : t.activities.shop.boxBody}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <PricePill price={boxPrice} promo={boxPromo} now={now} className="border border-[#b05cff]/60 bg-[#b05cff]/25 text-cream" />
            <ChevronDown size={16} className={`text-cream/50 transition-transform ${open === 'box' ? 'rotate-180' : ''}`} aria-hidden />
          </span>
        </button>
        {open === 'box' && (
          <div className="grid grid-cols-2 gap-2 px-4 pb-4">
            <button
              type="button"
              onClick={() => openBox('free')}
              disabled={!freeReady}
              className="inline-flex h-12 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] font-bold text-void disabled:bg-white/[0.06] disabled:text-cream/50"
              style={freeReady ? { background: 'linear-gradient(135deg, #fff0a8, #ffc23a 55%, #ff8a3d)' } : undefined}
            >
              <Gift size={15} aria-hidden />
              {freeReady ? t.runner.wardrobe.box.free : t.runner.wardrobe.box.freeIn(countdown((freeAt ?? now) - now))}
            </button>
            <button type="button" onClick={() => openBox('paid')} className="inline-flex h-12 items-center justify-center gap-1.5 rounded-full border border-[#b05cff]/60 bg-[#b05cff]/20 text-sm font-bold text-cream">
              <Sparkles size={15} aria-hidden />
              {t.runner.wardrobe.box.buy(boxPrice ?? 0)}
            </button>
            {gifts > 0 && (
              <button
                type="button"
                onClick={() => openBox('gift')}
                className="col-span-2 inline-flex h-12 items-center justify-center gap-1.5 rounded-full text-sm font-bold text-void"
                style={{ background: 'linear-gradient(135deg, #ffd1f0, #ff6fb5 60%, #b05cff)', boxShadow: '0 0 24px -4px #ff6fb5' }}
              >
                <Gift size={15} aria-hidden />
                {t.runner.wardrobe.box.gifted(gifts)}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                vibrate(8)
                setOpen(null)
                setGifting(true)
              }}
              className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] text-[13px] font-semibold text-cream/85"
            >
              <Send size={14} aria-hidden />
              {t.runner.wardrobe.gift.open}
            </button>
            <p className="col-span-2 text-center text-[11px] text-cream/50 tabular-nums">{t.activities.shop.balance(balance)}</p>
          </div>
        )}
      </section>
      {box && (
        <Suspense fallback={null}>
          <MysteryBox key={box.key} request={box.key} kind={box.kind} assets={null} onClose={() => setBox(null)} onAgain={(kind) => setBox({ kind, key: Date.now() })} />
        </Suspense>
      )}
      {gifting && (
        <Suspense fallback={null}>
          <GiftBoxSheet onClose={() => setGifting(false)} />
        </Suspense>
      )}
    </div>
  )
}
