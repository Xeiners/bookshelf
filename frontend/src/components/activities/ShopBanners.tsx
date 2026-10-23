import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, Gift, Loader2, Send, Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import type { BoxKind } from '../../lib/runner/wardrobe'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { LIVE_SERIES, type CardSeries } from '../../services/cardsApi'
import type { Promotion } from '../../services/promotionsApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { promotionOf, usePromotions } from '../../store/usePromotions'
import { useRunnerWardrobe } from '../../store/useRunnerWardrobeStore'
import { useUiStore } from '../../store/useUiStore'
import { BoosterPackArt } from '../boosters/BoosterPackArt'

/*
 * La boutique, sous l'autel des boosters : deux bannières pour dépenser ses Poussières sans
 * quitter les activités. La première achète un booster (au choix de la série) et l'ouvre
 * aussitôt ; la seconde ouvre une boîte mystère de la garde-robe du Manga Runner — la
 * gratuite du jour, ou une payée — directement ici.
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

export function ShopBanners() {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const signedIn = useAuthStore((state) => state.user !== null)
  const openAuth = useUiStore((state) => state.openAuth)
  const notify = useUiStore((state) => state.notify)
  const overview = useDleStore((state) => state.overview)
  const buyBooster = useDleStore((state) => state.buyBooster)
  const wardrobe = useRunnerWardrobe((state) => state.view)
  const loadWardrobe = useRunnerWardrobe((state) => state.load)
  const [open, setOpen] = useState<'booster' | 'box' | null>(null)
  const [busy, setBusy] = useState<CardSeries | null>(null)
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
      gsap.fromTo('[data-shop-shine]', { xPercent: -180 }, { xPercent: 320, duration: 1.8, ease: 'power2.inOut', repeat: -1, repeatDelay: 2.4, stagger: 1.1 })
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

  const toggle = (which: 'booster' | 'box') => {
    vibrate(8)
    if (!signedIn) {
      openAuth()
      return
    }
    setOpen((current) => (current === which ? null : which))
  }

  const buy = async (series: CardSeries) => {
    if (boosterPrice !== null && balance < boosterPrice) {
      notify(t.activities.shop.short(boosterPrice - balance), 'nope')
      return
    }
    setBusy(series)
    try {
      await buyBooster(series)
      setOpen(null)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(null)
    }
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
      {/* Booster contre des Poussières. */}
      <section className="overflow-hidden rounded-[1.5rem] border border-[#ffc46b]/35" style={{ background: 'linear-gradient(110deg, #2a1a08 0%, #1a1020 55%, #2a0f22 100%)' }}>
        <button type="button" onClick={() => toggle('booster')} aria-expanded={open === 'booster'} className="relative flex w-full items-center gap-3 overflow-hidden p-3.5 text-left sm:gap-4 sm:p-4">
          <span data-shop-shine aria-hidden className="pointer-events-none absolute inset-y-0 w-16 -skew-x-12 bg-white/10 blur-sm" />
          <span data-shop-bob className="relative -my-2 shrink-0 will-change-transform" style={{ transform: 'rotate(-8deg)' }}>
            <BoosterPackArt width={46} series={3} lit />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10px] font-semibold tracking-[0.2em] text-[#ffc46b]/80 uppercase">{t.activities.shop.eyebrow}</span>
            <span className="block font-display text-lg leading-tight text-cream sm:text-xl">{t.activities.shop.boosterTitle}</span>
            <span className="hidden text-xs text-cream/60 sm:block">{t.activities.shop.boosterBody}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <PricePill price={boosterPrice} promo={boosterPromo} now={now} style={{ background: 'linear-gradient(135deg, #fff0a8, #ffc23a)' }} className="text-[#1a0b1f]" />
            <ChevronDown size={16} className={`text-cream/50 transition-transform ${open === 'booster' ? 'rotate-180' : ''}`} aria-hidden />
          </span>
        </button>
        {open === 'booster' && (
          <div className="grid gap-2 px-4 pb-4" style={{ gridTemplateColumns: `repeat(${LIVE_SERIES.length}, minmax(0, 1fr))` }} role="group" aria-label={t.boosters.choose.title}>
            {LIVE_SERIES.map((series) => (
              <button
                key={series}
                type="button"
                disabled={busy !== null}
                onClick={() => void buy(series)}
                className="flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.05] p-2.5 transition-transform active:scale-95 disabled:opacity-60"
              >
                <BoosterPackArt width={44} series={series} lit />
                <span className="text-xs font-bold text-cream">{t.boosters.seriesName(series)}</span>
                <span className="truncate text-[10px] text-cream/50">{t.boosters.seriesTagline[series]}</span>
                {busy === series && <Loader2 size={14} className="animate-spin text-cream/70" aria-hidden />}
              </button>
            ))}
            <p className="col-span-full text-center text-[11px] text-cream/50 tabular-nums">{t.activities.shop.balance(balance)}</p>
          </div>
        )}
      </section>

      {/* Boîte mystère de la garde-robe. */}
      <section
        className="overflow-hidden rounded-[1.5rem] border"
        style={{ borderColor: glowing ? '#ffd35c99' : '#b05cff55', background: 'linear-gradient(110deg, #2a1150 0%, #160a33 55%, #2d1238 100%)', boxShadow: glowing ? '0 0 30px -10px #ffc23a' : undefined }}
      >
        <button type="button" onClick={() => toggle('box')} aria-expanded={open === 'box'} className="relative flex w-full items-center gap-3 overflow-hidden p-3.5 text-left sm:gap-4 sm:p-4">
          <span data-shop-shine aria-hidden className="pointer-events-none absolute inset-y-0 w-16 -skew-x-12 bg-white/10 blur-sm" />
          <span data-shop-bob aria-hidden className="relative grid size-12 shrink-0 place-items-center will-change-transform">
            <span className="absolute inset-0 rounded-xl" style={{ background: 'linear-gradient(160deg, #5a24a8, #2a1150)', boxShadow: `0 0 18px -2px ${glowing ? '#ffd35c' : '#b05cff'}, inset 0 0 0 2px #ffc93c` }} />
            <span className="absolute inset-y-0 left-1/2 w-2 -translate-x-1/2 bg-[#ffc93c]" />
            <span className="absolute inset-x-0 top-[38%] h-2 bg-[#ffc93c]" />
            <span className="relative font-display text-xl text-[#ffe9a8] drop-shadow-[0_0_6px_#ffb300]">?</span>
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
