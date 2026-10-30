import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Crown, Footprints, Gift, Lock, Send, Shirt, Sparkles, Sword, X } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { ITEM_INFO, RARITIES, RARITY_COLORS, WARDROBE_ITEMS, WARDROBE_SLOTS, type BoxKind, type Outfit, type WardrobeItemId, type WardrobeSlot } from '../../lib/runner/wardrobe'
import { useAuthStore } from '../../store/useAuthStore'
import { useRunnerWardrobe } from '../../store/useRunnerWardrobeStore'
import { useUiStore } from '../../store/useUiStore'
import { StardustBadge } from '../dle/StardustBadge'
import type { RunnerAssets } from './assets'
import { GiftBoxSheet } from './GiftBoxSheet'
import { HeroPreview } from './HeroPreview'
import { MysteryBox } from './MysteryBox'
import { useItemIcons } from './wardrobeIcons'

/*
 * La garde-robe de l'aventurier : le coureur en vitrine, habillé de ce qu'on essaie (même les
 * pièces pas encore gagnées : on voit ce qu'on pourrait porter), cinq rayons de cinq pièces
 * aux couleurs de leur rareté, et la boîte mystère — gratuite toutes les 24 h (compte à
 * rebours), ou contre des Poussières, avec sa jauge de légendaire garantie.
 */

/** Pantalon (lucide n'en a pas) : même trait que les autres pictogrammes. */
function Trousers({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3h12l1 18h-5l-2-11-2 11H5z" />
      <path d="M6 7h12" />
    </svg>
  )
}

const SLOT_ICONS: Record<WardrobeSlot, ReactNode> = {
  hat: <Crown size={18} aria-hidden />,
  top: <Shirt size={18} aria-hidden />,
  accessory: <Sword size={18} aria-hidden />,
  bottom: <Trousers />,
  shoes: <Footprints size={18} aria-hidden />,
}

const pad = (value: number) => String(value).padStart(2, '0')
function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
}

/** L'heure, toutes les secondes (compte à rebours de la boîte gratuite). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function Wardrobe({ assets, onClose, openBox = false }: { assets: RunnerAssets | null; onClose: () => void; openBox?: boolean }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const signedIn = useAuthStore((state) => state.user !== null)
  const notify = useUiStore((state) => state.notify)
  const view = useRunnerWardrobe((state) => state.view)
  const outfit = useRunnerWardrobe((state) => state.outfit)
  const equip = useRunnerWardrobe((state) => state.equip)
  const load = useRunnerWardrobe((state) => state.load)
  const icons = useItemIcons()
  const now = useNow()
  const [slot, setSlot] = useState<WardrobeSlot>('hat')
  /** Essayage : la tenue montrée en vitrine (pièces verrouillées comprises). */
  const [trying, setTrying] = useState<Outfit | null>(null)
  const [box, setBox] = useState<{ kind: BoxKind; key: number } | null>(null)
  const [gifting, setGifting] = useState(false)
  const [autoOpened, setAutoOpened] = useState(false)

  useEffect(() => {
    if (signedIn) void load()
  }, [signedIn, load])

  const owned = view?.owned ?? {}
  const ownedCount = WARDROBE_ITEMS.filter((id) => owned[id]).length
  const freeAt = view?.freeAt ? Date.parse(view.freeAt) : null
  const freeReady = view !== null && (freeAt === null || freeAt <= now)
  const canBuy = view !== null && view.balance >= view.price
  const gifts = view?.gifts ?? 0
  const pityLeft = view ? Math.max(1, view.pityMax - view.pity) : null

  // Ouverture directe (bouton de l'accueil) : la boîte gratuite si elle est prête.
  useEffect(() => {
    if (!openBox || autoOpened || !view || !assets) return
    // Après l'apparition de l'écran (sa propre animation d'entrée d'abord).
    const timer = window.setTimeout(() => {
      setAutoOpened(true)
      if (gifts > 0) setBox({ kind: 'gift', key: Date.now() })
      else if (freeReady) setBox({ kind: 'free', key: Date.now() })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [openBox, autoOpened, view, assets, freeReady, gifts])

  useGSAP(
    () => {
      gsap.fromTo('[data-wardrobe-in]', { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.05, ease: EASE.glide })
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.to('[data-box-bob]', { y: -6, rotation: 2, duration: 1.1, ease: 'sine.inOut', repeat: -1, yoyo: true })
        gsap.fromTo('[data-box-shine]', { xPercent: -160 }, { xPercent: 260, duration: 1.6, ease: 'power2.inOut', repeat: -1, repeatDelay: 1.4 })
      }
    },
    { scope: ref },
  )

  const shown = trying ?? outfit
  const wear = async (id: WardrobeItemId) => {
    const target = ITEM_INFO[id].slot
    vibrate(8)
    if (!owned[id]) {
      // Pas encore gagnée : on l'essaie en vitrine.
      setTrying({ ...outfit, [target]: id })
      return
    }
    setTrying(null)
    const next = { ...outfit }
    if (next[target] === id) delete next[target]
    else next[target] = id
    try {
      await equip(next)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    }
  }

  const openTheBox = (kind: BoxKind) => {
    if (!assets) return
    setTrying(null)
    vibrate(12)
    setBox({ kind, key: Date.now() })
  }

  return createPortal(
    <div ref={ref} className="fixed inset-0 z-[110] flex flex-col overflow-hidden bg-[#0c0620]" role="dialog" aria-modal="true" aria-label={t.runner.wardrobe.title}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(90% 55% at 50% 18%, rgba(176,92,255,0.32), transparent 70%), radial-gradient(60% 40% at 90% 100%, rgba(255,111,181,0.16), transparent 70%)' }} />
      <header className="relative flex shrink-0 items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <button type="button" onClick={onClose} aria-label={t.runner.wardrobe.box.close} className="grid size-10 place-items-center rounded-full border border-white/12 bg-white/[0.06] text-cream">
          <X size={18} aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl leading-none text-cream">{t.runner.wardrobe.title}</h2>
          <p className="mt-1 text-[11px] text-cream/55 tabular-nums">{t.runner.wardrobe.collection(ownedCount, WARDROBE_ITEMS.length)}</p>
        </div>
        {view && <StardustBadge balance={view.balance} />}
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {/* Vitrine : le coureur habillé de ce qu'on essaie. */}
        <section data-wardrobe-in className="relative h-[38vh] min-h-56 shrink-0 overflow-hidden rounded-[1.75rem] border border-white/10" style={{ background: 'linear-gradient(180deg, #4b2a8c 0%, #9a5bc4 55%, #f0a3c8 100%)' }}>
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-20" style={{ background: 'radial-gradient(60% 100% at 50% 100%, rgba(255,255,255,0.35), transparent 70%)' }} />
          {!box && assets && <HeroPreview look="adventurer" assets={assets} outfit={shown} close className="absolute inset-0" />}
          {/* Progression de la collection. */}
          <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/35 px-3 py-1.5">
            <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-white/15">
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(ownedCount / WARDROBE_ITEMS.length) * 100}%`, background: 'linear-gradient(90deg, #ffd35c, #ff6fb5)' }} />
            </span>
            <span className="text-[11px] font-bold text-cream tabular-nums">
              {ownedCount}/{WARDROBE_ITEMS.length}
            </span>
          </div>
          {trying && (
            <button
              type="button"
              onClick={() => setTrying(null)}
              className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-full bg-black/55 px-3 py-2 text-xs font-semibold text-cream"
            >
              <Lock size={13} aria-hidden />
              {t.runner.wardrobe.lockedHint}
              <X size={13} aria-hidden />
            </button>
          )}
        </section>

        {/* La boîte mystère. */}
        <section data-wardrobe-in className="relative shrink-0 overflow-hidden rounded-[1.5rem] border border-gold/30 p-4" style={{ background: 'linear-gradient(135deg, #2a1150 0%, #160a33 60%, #2d1238 100%)' }}>
          <div className="flex items-center gap-4">
            <span data-box-bob aria-hidden className="relative grid size-16 shrink-0 place-items-center will-change-transform">
              <span className="absolute inset-1 rounded-2xl" style={{ background: 'linear-gradient(160deg, #5a24a8, #2a1150)', boxShadow: `0 0 26px -2px ${freeReady ? '#ffd35c' : '#b05cff'}, inset 0 0 0 2px #ffc93c` }} />
              <span className="absolute inset-y-1 left-1/2 w-2.5 -translate-x-1/2 bg-[#ffc93c]" />
              <span className="absolute inset-x-1 top-[38%] h-2.5 bg-[#ffc93c]" />
              <span className="relative font-display text-2xl text-[#ffe9a8]">?</span>
              <span className="absolute inset-1 overflow-hidden rounded-2xl">
                <span data-box-shine className="absolute inset-y-0 w-1/3 -skew-x-12 bg-white/35" />
              </span>
              {freeReady && <span className="absolute -top-1 -right-1 size-3.5 animate-ping rounded-full bg-like" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl leading-tight text-cream">{t.runner.wardrobe.box.title}</p>
              {pityLeft !== null && (
                <div className="mt-1.5">
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10">
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${((view!.pityMax - pityLeft) / view!.pityMax) * 100}%`, background: 'linear-gradient(90deg, #b05cff, #ffc23a)' }} />
                  </div>
                  <p className="mt-1 text-[11px] text-gold/85">{t.runner.wardrobe.box.pity(pityLeft)}</p>
                </div>
              )}
            </div>
          </div>
          {!signedIn ? (
            <p className="mt-3 text-xs text-cream/60">{t.runner.wardrobe.accountOnly}</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openTheBox('free')}
                disabled={!freeReady || !assets}
                className="relative inline-flex h-12 items-center justify-center gap-1.5 overflow-hidden rounded-full px-2 text-[13px] font-bold text-void disabled:bg-white/[0.06] disabled:text-cream/55"
                style={freeReady ? { background: 'linear-gradient(135deg, #fff0a8, #ffc23a 55%, #ff8a3d)', boxShadow: '0 0 24px -4px #ffc23a' } : undefined}
              >
                <Gift size={16} aria-hidden />
                <span className="tabular-nums">{freeReady ? t.runner.wardrobe.box.free : t.runner.wardrobe.box.freeIn(countdown((freeAt ?? now) - now))}</span>
              </button>
              <button
                type="button"
                onClick={() => (canBuy ? openTheBox('paid') : notify(t.runner.wardrobe.box.short(view?.price ?? 0), 'nope'))}
                disabled={!view || !assets}
                className={`inline-flex h-12 items-center justify-center gap-1.5 rounded-full border text-sm font-bold ${canBuy ? 'border-[#b05cff]/60 bg-[#b05cff]/20 text-cream' : 'border-white/10 bg-white/[0.04] text-cream/50'}`}
              >
                <Sparkles size={15} aria-hidden />
                {view && view.regular > view.price && <span className="text-[11px] font-semibold line-through opacity-60">{view.regular}</span>}
                {t.runner.wardrobe.box.buy(view?.price ?? 0)}
              </button>
              {gifts > 0 && (
                <button
                  type="button"
                  onClick={() => openTheBox('gift')}
                  disabled={!assets}
                  className="col-span-2 inline-flex h-12 items-center justify-center gap-1.5 rounded-full text-sm font-bold text-void"
                  style={{ background: 'linear-gradient(135deg, #ffd1f0, #ff6fb5 60%, #b05cff)', boxShadow: '0 0 24px -4px #ff6fb5' }}
                >
                  <Gift size={16} aria-hidden />
                  {t.runner.wardrobe.box.gifted(gifts)}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  vibrate(8)
                  setGifting(true)
                }}
                disabled={!view}
                className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] text-[13px] font-semibold text-cream/85"
              >
                <Send size={14} aria-hidden />
                {t.runner.wardrobe.gift.open}
              </button>
            </div>
          )}
          {view && (
            <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] tracking-wide text-cream/45 uppercase">
              <span>{t.runner.wardrobe.box.odds}</span>
              {RARITIES.map((rarity) => (
                <span key={rarity} style={{ color: RARITY_COLORS[rarity].main }}>
                  {t.runner.wardrobe.rarity[rarity]} {view.weights[rarity]} %
                </span>
              ))}
            </p>
          )}
        </section>

        {/* Rayons. */}
        <nav data-wardrobe-in className="flex shrink-0 gap-1.5 rounded-full border border-white/10 bg-white/[0.04] p-1" aria-label={t.runner.wardrobe.title}>
          {WARDROBE_SLOTS.map((name) => {
            const active = slot === name
            const all = WARDROBE_ITEMS.filter((id) => ITEM_INFO[id].slot === name)
            const have = all.filter((id) => owned[id]).length
            return (
              <button
                key={name}
                type="button"
                onClick={() => setSlot(name)}
                aria-pressed={active}
                aria-label={t.runner.wardrobe.slots[name]}
                className={`relative flex h-11 flex-1 flex-col items-center justify-center rounded-full transition-colors ${active ? 'bg-[#ff6fb5]/25 text-cream' : 'text-cream/55'}`}
              >
                {SLOT_ICONS[name]}
                <span className="text-[9px] font-bold tabular-nums">{have}/{all.length}</span>
              </button>
            )
          })}
        </nav>
        <p className="-mt-1 px-1 text-xs font-semibold tracking-[0.18em] text-cream/60 uppercase">{t.runner.wardrobe.slots[slot]}</p>

        <div className="grid shrink-0 grid-cols-2 gap-2.5 sm:grid-cols-3">
          {WARDROBE_ITEMS.filter((id) => ITEM_INFO[id].slot === slot).map((id) => {
            const info = ITEM_INFO[id]
            const colors = RARITY_COLORS[info.rarity]
            const have = owned[id] ?? 0
            const worn = outfit[slot] === id
            const tried = trying?.[slot] === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => void wear(id)}
                className="relative flex flex-col overflow-hidden rounded-[1.25rem] border text-left transition-transform active:scale-[0.97]"
                style={{
                  borderColor: worn || tried ? colors.main : `${colors.main}40`,
                  background: `radial-gradient(90% 70% at 50% 30%, ${colors.deep}cc, #120a26 80%)`,
                  boxShadow: worn ? `0 0 22px -6px ${colors.main}` : undefined,
                }}
              >
                <span className="relative grid aspect-square place-items-center">
                  {icons.get(id) ? (
                    <img src={icons.get(id)} alt="" className={`size-[82%] object-contain ${have ? '' : 'brightness-[0.35] saturate-50'}`} />
                  ) : (
                    <span className="text-cream/40">{SLOT_ICONS[slot]}</span>
                  )}
                  {!have && (
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="grid size-9 place-items-center rounded-full bg-black/55 text-cream/80">
                        <Lock size={16} aria-hidden />
                      </span>
                    </span>
                  )}
                  {worn && (
                    <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full text-void" style={{ background: colors.main }}>
                      <Check size={14} strokeWidth={3} aria-hidden />
                    </span>
                  )}
                  {have > 1 && <span className="absolute top-2 left-2 rounded-full bg-black/50 px-1.5 text-[10px] font-bold text-cream">×{have}</span>}
                </span>
                <span className="flex flex-col gap-0.5 px-3 pb-3">
                  <span className="text-[10px] font-black tracking-[0.18em] uppercase" style={{ color: colors.main }}>
                    {t.runner.wardrobe.rarity[info.rarity]}
                  </span>
                  <span className="truncate text-sm font-semibold text-cream">{have ? t.runner.wardrobe.items[id] : t.runner.wardrobe.locked}</span>
                  <span className="truncate text-[11px] text-cream/45">{info.anime}</span>
                  {have > 0 && <span className="mt-1 text-[11px] font-semibold text-cream/70">{worn ? t.runner.wardrobe.remove : t.runner.wardrobe.equip}</span>}
                </span>
              </button>
            )
          })}
        </div>
        {ownedCount === WARDROBE_ITEMS.length && <p className="text-center text-sm font-bold text-gold">{t.runner.wardrobe.box.complete}</p>}
      </div>

      {box && assets && (
        <MysteryBox key={box.key} request={box.key} kind={box.kind} assets={assets} onClose={() => setBox(null)} onAgain={(kind) => setBox({ kind, key: Date.now() })} />
      )}
      {gifting && <GiftBoxSheet onClose={() => setGifting(false)} />}
    </div>,
    document.body,
  )
}
