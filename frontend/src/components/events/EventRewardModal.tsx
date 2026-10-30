import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Gift, Loader2, X } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playChime } from '../../lib/sfx'
import type { TeamEvent } from '../../services/eventsApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDailyStore } from '../../store/useDailyStore'
import { useEventsStore } from '../../store/useEventsStore'
import { useRecordRewards } from '../../store/useRecordRewards'
import { useUiStore } from '../../store/useUiStore'
import { BoosterPackArt } from '../boosters/BoosterPackArt'
import { SeasonalCorner } from '../layout/SeasonalDecor'

/**
 * Événement de l'équipe (Halloween…) : à la connexion, une fenêtre présente le mot de l'équipe
 * et les cadeaux (pack Légendaire, boosters, Poussières), à récupérer d'un toucher, puis à
 * ouvrir tout de suite ou plus tard. Elle attend que le calendrier du jour, une récompense de
 * record ou une ouverture de booster soient refermés. À monter une fois, dans `App`.
 */
export function EventRewardModal() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  useEffect(() => {
    const { load, reset } = useEventsStore.getState()
    if (!accountId) {
      reset()
      return
    }
    void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [accountId])

  const event = useEventsStore((state) => state.claimed ?? state.pending[0] ?? null)
  const claimed = useEventsStore((state) => state.claimed !== null)
  const dailyOpen = useDailyStore((state) => state.open)
  const recordOpen = useRecordRewards((state) => state.open)
  const boosterOpen = useUiStore((state) => state.boosterOpen)
  if (!accountId || !event || dailyOpen || recordOpen || boosterOpen) return null
  return createPortal(<EventDialog key={event.id} event={event} claimed={claimed} />, document.body)
}

function EventDialog({ event, claimed }: { event: TeamEvent; claimed: boolean }) {
  const t = useT()
  const copy = t.events
  const ref = useRef<HTMLDivElement>(null)
  const notify = useUiStore((state) => state.notify)
  const [busy, setBusy] = useState(false)

  useGSAP(
    () => {
      playChime(true)
      vibrate([20, 40, 20, 40, 80])
      const timeline = gsap.timeline({ defaults: { ease: EASE.glide } })
      timeline
        .fromTo('[data-event-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 })
        .fromTo('[data-event-panel]', { y: 40, scale: 0.94, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.55 }, 0.05)
        .fromTo('[data-event-gift]', { scale: 0.2, rotation: -20, autoAlpha: 0 }, { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.7, ease: 'back.out(2.2)' }, 0.2)
        .fromTo('[data-event-rays]', { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.8 }, 0.25)
        .fromTo('[data-event-in]', { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.06 }, 0.4)
        .fromTo('[data-event-reward]', { y: 26, scale: 0.8, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.5, stagger: 0.09, ease: 'back.out(1.8)' }, 0.6)
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.to('[data-event-rays]', { rotation: 360, duration: 20, ease: 'none', repeat: -1 })
        gsap.to('[data-event-gift]', { y: -5, duration: 1.3, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 0.9 })
      }
    },
    { scope: ref },
  )

  // Les cadeaux récupérés : ils sautent une fois, pour dire « c'est à toi ».
  const { contextSafe } = useGSAP({ scope: ref })
  const celebrate = contextSafe(() => {
    gsap.fromTo('[data-event-reward]', { scale: 1 }, { scale: 1.08, duration: 0.18, yoyo: true, repeat: 1, stagger: 0.07, ease: 'power2.out' })
  })

  const dismiss = () => useEventsStore.getState().dismiss()

  const claim = async () => {
    if (busy) return
    setBusy(true)
    try {
      await useEventsStore.getState().claim(event)
      playChime(true)
      vibrate([10, 30, 60])
      celebrate()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  // Après coup : ouvrir tout de suite ce qui vaut le plus (le pack Légendaire d'abord).
  const openNow = () => {
    dismiss()
    vibrate(12)
    if (event.legendaryPacks > 0) useUiStore.getState().openLegendaryPack()
    else useUiStore.getState().openBooster()
  }
  const opensSomething = event.legendaryPacks > 0 || event.boosters > 0

  return (
    <div ref={ref} className="fixed inset-0 z-[125] grid place-items-center px-4 py-6" role="dialog" aria-modal="true" aria-label={event.title}>
      <div data-event-backdrop className="absolute inset-0 bg-[#07040c]/92" onClick={claimed ? dismiss : undefined} />
      <div
        data-event-panel
        className="relative isolate flex max-h-full w-full max-w-sm flex-col items-center gap-3 overflow-y-auto rounded-[2rem] border border-white/10 px-5 pt-6 pb-5 text-center"
        style={{
          background:
            'radial-gradient(90% 55% at 50% 0%, color-mix(in srgb, var(--color-glow) 30%, transparent), transparent 70%), linear-gradient(180deg, #15101f 0%, #0b0911 100%)',
        }}
      >
        <SeasonalCorner corner="left" size={78} behind />
        <SeasonalCorner corner="right" size={60} behind />
        <button
          type="button"
          onClick={dismiss}
          aria-label={copy.later}
          className="absolute top-3 right-3 grid size-9 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-cream/70 hover:text-cream"
        >
          <X size={16} />
        </button>

        <div className="relative grid size-28 place-items-center">
          <span
            data-event-rays
            aria-hidden
            className="absolute inset-[-45%] rounded-full opacity-0"
            style={{
              background: 'repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--color-glow) 38%, transparent) 0deg 8deg, transparent 8deg 22deg)',
              maskImage: 'radial-gradient(circle, black 28%, transparent 68%)',
            }}
          />
          <span
            data-event-gift
            className="btn-cta relative grid size-20 place-items-center rounded-[1.6rem]"
            style={{ boxShadow: '0 0 50px -8px var(--color-glow), inset 0 -5px 0 rgba(0,0,0,0.18)' }}
          >
            <Gift size={40} strokeWidth={2.2} aria-hidden />
          </span>
        </div>

        <p data-event-in className="text-[10px] font-semibold tracking-[0.3em] text-glow uppercase">
          {claimed ? copy.claimedEyebrow : copy.eyebrow}
        </p>
        <h2 data-event-in className="font-display text-3xl leading-tight text-cream">
          {claimed ? copy.claimedTitle : event.title}
        </h2>
        <p data-event-in className="text-sm leading-relaxed whitespace-pre-line text-cream/75">
          {claimed ? copy.claimedBody : event.message}
        </p>

        <p data-event-in className="mt-1 text-[10px] font-bold tracking-[0.22em] text-cream/45 uppercase">
          {copy.gifts}
        </p>
        <ul className="flex w-full flex-wrap justify-center gap-2.5">
          {event.legendaryPacks > 0 && (
            <RewardTile
              count={event.legendaryPacks}
              label={copy.legendaryPack(event.legendaryPacks)}
              tint="#ffc46b"
              art={<BoosterPackArt width={44} series={3} lit halo="LEGENDARY" />}
            />
          )}
          {event.boosters > 0 && <RewardTile count={event.boosters} label={copy.boosters(event.boosters)} tint="#9b8cff" art={<BoosterPackArt width={44} series={3} lit />} />}
          {event.stardust > 0 && (
            <RewardTile
              count={event.stardust}
              plus
              label={copy.stardust}
              tint="#7fd8ff"
              art={
                <span aria-hidden className="grid h-[62px] place-items-center font-display text-5xl leading-none text-[#bfeaff]">
                  ✦
                </span>
              }
            />
          )}
        </ul>

        <div data-event-in className="mt-2 flex w-full flex-col gap-2">
          {claimed ? (
            <>
              {opensSomething && (
                <button type="button" onClick={openNow} className="btn-cta inline-flex h-12 items-center justify-center rounded-full text-sm font-bold">
                  {event.legendaryPacks > 0 ? copy.openLegendary : copy.openBooster}
                </button>
              )}
              <button type="button" onClick={dismiss} className="h-10 text-xs font-semibold text-cream/55 hover:text-cream">
                {opensSomething ? copy.later : copy.done}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void claim()}
                disabled={busy}
                className="btn-cta inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold disabled:opacity-60"
              >
                {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Gift size={17} aria-hidden />}
                {copy.claim}
              </button>
              <button type="button" onClick={dismiss} className="h-10 text-xs font-semibold text-cream/50 hover:text-cream">
                {copy.notNow}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Un cadeau : son image, « ×N » (ou « +N ») et ce que c'est. */
function RewardTile({ count, label, tint, art, plus = false }: { count: number; label: string; tint: string; art: ReactNode; /** « +N » (une somme) plutôt que « ×N ». */ plus?: boolean }) {
  return (
    <li
      data-event-reward
      className="relative flex w-[6.4rem] flex-col items-center gap-1.5 rounded-2xl border px-2 pt-3 pb-2.5"
      style={{ borderColor: `${tint}55`, background: `radial-gradient(90% 70% at 50% 25%, ${tint}2b, transparent 75%), #110d18` }}
    >
      <span className="-rotate-6">{art}</span>
      <span className="font-display text-xl leading-none" style={{ color: tint }}>
        {plus ? '+' : '×'}
        {count.toLocaleString()}
      </span>
      <span className="text-[11px] leading-tight font-semibold text-cream/80">{label}</span>
    </li>
  )
}
