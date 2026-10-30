import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarCheck, Check, Flame, Loader2, X } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { formatCountdown } from '../../lib/oracle'
import { playChime } from '../../lib/sfx'
import { CYCLE_DAYS, type DailyBundle, type DailyClaim, type DailyDay, type DailyStatus } from '../../services/dailyApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDailyStore } from '../../store/useDailyStore'
import { useUiStore } from '../../store/useUiStore'
import { CARD_RATIO, CollectibleCard } from '../cards/CollectibleCard'
import { BundleGlyphs, PackGlyph } from './RewardGlyphs'

/**
 * Récompense quotidienne : à la première connexion du jour (minuit → 23 h 59, heure de Paris),
 * un calendrier de 30 cases s'ouvre. Toucher « Récupérer » donne la case du jour ; il faut
 * enchaîner les jours (un jour manqué repart de zéro) pour atteindre le 30ᵉ : un pack avec une
 * Légendaire garantie. À monter une fois, dans `App`.
 */
export function DailyRewardModal() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const open = useDailyStore((state) => state.open)
  const status = useDailyStore((state) => state.status)

  // Connexion, ou ouverture de l'app : la case du jour se présente d'elle-même.
  useEffect(() => {
    if (!accountId) return
    void useDailyStore.getState().load(true)
    // Une app restée ouverte ou revenue d'arrière-plan peut avoir changé de jour.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void useDailyStore.getState().load(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [accountId])

  // Minuit à Paris : le calendrier se remet à jour sans attendre, et s'ouvre sur la nouvelle case.
  useEffect(() => {
    if (!accountId || !status) return
    const delay = Math.min(status.secondsUntilReset * 1000 + 1500, 2 ** 31 - 1)
    const timer = window.setTimeout(() => void useDailyStore.getState().load(true), delay)
    return () => window.clearTimeout(timer)
  }, [accountId, status])

  if (!open || !status) return null
  return createPortal(<DailyDialog status={status} />, document.body)
}

/** Secondes restantes avant minuit à Paris, comptées à partir de la réponse du serveur. */
function useCountdown(status: DailyStatus): number {
  const [deadline] = useState(() => Date.now() + status.secondsUntilReset * 1000)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return Math.max(0, deadline - now)
}

function DailyDialog({ status }: { status: DailyStatus }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const claim = useDailyStore((state) => state.claim)
  const close = useDailyStore((state) => state.close)
  const reward = useDailyStore((state) => state.reward)
  const dismissReward = useDailyStore((state) => state.dismissReward)
  const notify = useUiStore((state) => state.notify)
  const [busy, setBusy] = useState(false)
  const remaining = useCountdown(status)

  useGSAP(
    () => {
      gsap
        .timeline({ defaults: { ease: EASE.glide } })
        .fromTo('[data-daily-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 })
        .fromTo('[data-daily-panel]', { y: 40, scale: 0.96, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.55 }, 0.05)
        .fromTo('[data-daily-cell]', { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.35, stagger: 0.012, clearProps: 'transform,opacity,visibility' }, 0.25)
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.to('[data-daily-today]', { scale: 1.05, duration: 0.9, ease: 'sine.inOut', repeat: -1, yoyo: true })
      }
    },
    { scope: ref },
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const take = async () => {
    if (busy) return
    setBusy(true)
    try {
      await claim()
      vibrate([10, 30, 60])
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  const days = status.calendar
  const last = days.find((entry) => entry.day === CYCLE_DAYS)

  return (
    <div ref={ref} className="fixed inset-0 z-[120] grid place-items-center px-3 py-4" role="dialog" aria-modal="true" aria-label={t.daily.title}>
      <div data-daily-backdrop className="absolute inset-0 bg-[#07040f]/92" onClick={close} />
      <div
        data-daily-panel
        className="no-scrollbar relative flex max-h-[94dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-[2rem] border border-[#ffc46b]/25 p-5 text-cream"
        style={{ background: 'linear-gradient(170deg, #1d1330 0%, #0e0a1a 60%)', boxShadow: '0 30px 80px -20px rgba(120,60,255,0.45)' }}
      >
        <button type="button" onClick={close} aria-label={t.daily.close} className="absolute top-3 right-3 grid size-10 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-cream">
          <X size={18} />
        </button>

        <header className="pr-10">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.3em] text-gold uppercase">
            <CalendarCheck size={13} aria-hidden />
            {t.daily.eyebrow}
          </p>
          <h2 className="mt-1 font-display text-3xl leading-none">{t.daily.title}</h2>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-cream/70">
            <span className="font-semibold text-cream">{t.daily.progress(status.claimable ? status.day : status.streak, CYCLE_DAYS)}</span>
            {status.streak > 0 && (
              <span className="inline-flex items-center gap-1 text-[#ff9b3d]">
                <Flame size={13} aria-hidden />
                {t.daily.streak(status.streak)}
              </span>
            )}
          </p>
        </header>

        {status.broken && status.claimable && (
          <p role="status" className="rounded-2xl border border-[#ff4d6d]/30 bg-[#ff4d6d]/10 px-3.5 py-2.5 text-xs leading-snug text-[#ffb3c0]">
            <strong className="font-semibold">{t.daily.brokenTitle}</strong> {t.daily.broken}
          </p>
        )}

        <ol className="grid grid-cols-7 gap-1.5">
          {days
            .filter((entry) => entry.day < CYCLE_DAYS)
            .map((entry) => (
              <DayCell key={entry.day} entry={entry} />
            ))}
          {last && <GrandCell entry={last} />}
        </ol>

        <p className="text-center text-[11px] leading-relaxed text-cream/55">{t.daily.rule}</p>

        {status.claimable ? (
          <button
            type="button"
            onClick={() => void take()}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold text-[#3a2200] transition-transform active:scale-95 disabled:opacity-70"
            style={{ background: 'linear-gradient(135deg, #fff1b8, #ffc23a 55%, #ff9b3d)', boxShadow: '0 10px 30px -10px #ffc23a' }}
          >
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
            {busy ? t.daily.claiming : t.daily.claim}
          </button>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center">
            <p className="text-sm font-semibold text-cream">{t.daily.claimedDone}</p>
            <p className="mt-0.5 text-xs text-cream/60">
              {t.daily.nextIn} <span className="font-semibold text-cream tabular-nums">{formatCountdown(remaining)}</span>
            </p>
          </div>
        )}
      </div>

      {reward && <RewardReveal reward={reward} onDone={dismissReward} />}
    </div>
  )
}

const STATE_CLASS = {
  claimed: 'border-white/5 bg-white/[0.03] opacity-55',
  today: 'border-[#ffc46b] bg-[linear-gradient(160deg,#4a3210,#241238)] shadow-[0_0_24px_-4px_#ffc23a]',
  upcoming: 'border-white/10 bg-[#13101c]',
} as const

/** Texte lu par les lecteurs d'écran : jour, contenu, état. */
function useCellLabel() {
  const t = useT()
  return (entry: DailyDay) => `${t.daily.day(entry.day)} — ${describe(entry.reward, t)} — ${t.daily.states[entry.state]}`
}

function describe(reward: DailyBundle, t: ReturnType<typeof useT>): string {
  return [
    reward.pack ? t.daily.reward.pack : null,
    reward.boosters > 0 ? t.daily.reward.boosters(reward.boosters) : null,
    reward.boxes > 0 ? t.daily.reward.boxes(reward.boxes) : null,
    reward.stardust > 0 ? t.daily.reward.stardust(reward.stardust) : null,
  ]
    .filter(Boolean)
    .join(', ')
}

function DayCell({ entry }: { entry: DailyDay }) {
  const label = useCellLabel()
  const milestone = entry.tier === 'milestone'
  const multiple = [entry.reward.stardust, entry.reward.boosters, entry.reward.boxes].filter((amount) => amount > 0).length > 1
  return (
    <li
      data-daily-cell
      {...(entry.state === 'today' && { 'data-daily-today': '' })}
      aria-label={label(entry)}
      aria-current={entry.state === 'today' ? 'date' : undefined}
      className={`relative flex aspect-[5/6] flex-col items-center justify-center gap-1 rounded-xl border pt-3 ${STATE_CLASS[entry.state]} ${milestone && entry.state !== 'today' ? 'border-[#b05cff]/60' : ''}`}
    >
      <span className={`absolute top-1 left-1.5 text-[9px] leading-none font-bold tabular-nums ${milestone ? 'text-[#d6b0ff]' : 'text-cream/55'}`}>{entry.day}</span>
      <BundleGlyphs reward={entry.reward} size={multiple ? 12 : 20} labels compact={multiple} />
      {entry.state === 'claimed' && (
        <span className="absolute top-1 right-1 grid size-3.5 place-items-center rounded-full bg-like text-void">
          <Check size={9} strokeWidth={3.5} aria-hidden />
        </span>
      )}
    </li>
  )
}

/** Le 30ᵉ jour : la grande récompense, sur le reste de la dernière rangée. */
function GrandCell({ entry }: { entry: DailyDay }) {
  const t = useT()
  const label = useCellLabel()
  return (
    <li
      data-daily-cell
      aria-label={label(entry)}
      className={`relative col-span-6 flex items-center gap-3 rounded-xl border px-3 py-2 ${entry.state === 'claimed' ? STATE_CLASS.claimed : 'border-[#ffc46b]/70 bg-[linear-gradient(120deg,#3b2410,#2a1150)] shadow-[0_0_28px_-6px_#ffc23a]'}`}
    >
      <span className="text-[9px] font-bold text-gold tabular-nums">{entry.day}</span>
      <PackGlyph size={34} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight font-bold text-cream">{t.daily.reward.pack}</span>
        <span className="block text-[11px] leading-snug text-cream/65">{t.daily.packHint}</span>
      </span>
      <BundleGlyphs reward={{ ...entry.reward, pack: false }} size={15} labels />
      {entry.state === 'claimed' && (
        <span className="absolute top-1 right-1 grid size-3.5 place-items-center rounded-full bg-like text-void">
          <Check size={9} strokeWidth={3.5} aria-hidden />
        </span>
      )}
    </li>
  )
}

/** Ce qu'on vient de gagner : le contenu de la case et, le 30ᵉ jour, les cartes du pack. */
function RewardReveal({ reward, onDone }: { reward: DailyClaim; onDone: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const grand = reward.reward.pack
  const cards = reward.cards
  const width = Math.min(118, Math.floor((Math.min(window.innerWidth, 448) - 64) / Math.max(1, cards.length) - 6))

  useGSAP(
    () => {
      playChime(grand)
      vibrate(grand ? [20, 40, 20, 40, 120] : [14, 30, 40])
      const timeline = gsap.timeline({ defaults: { ease: EASE.glide } })
      timeline
        .fromTo('[data-reveal-bg]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 })
        .fromTo('[data-reveal-glow]', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.8 }, 0.05)
        .fromTo('[data-reveal-in]', { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.09 }, 0.25)
        .fromTo('[data-reveal-prize]', { scale: 0.2, rotation: -18, autoAlpha: 0 }, { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.7, ease: 'back.out(2.2)' }, 0.3)
        .fromTo('[data-reveal-card]', { y: 50, rotationY: 90, autoAlpha: 0 }, { y: 0, rotationY: 0, autoAlpha: 1, duration: 0.6, stagger: 0.22, ease: 'back.out(1.6)' }, 0.9)
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.to('[data-reveal-glow]', { rotation: 360, duration: 20, ease: 'none', repeat: -1 })
      }
    },
    { scope: ref },
  )

  return (
    <div ref={ref} className="absolute inset-0 z-10 grid place-items-center px-4" role="dialog" aria-modal="true" aria-label={t.daily.gotTitle}>
      <div data-reveal-bg className="absolute inset-0 bg-[#07040f]/96" />
      <div className="relative flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <span
          data-reveal-glow
          aria-hidden
          className="pointer-events-none absolute top-[-6%] -z-10 size-[26rem] max-w-[140vw] opacity-0"
          style={{ background: 'repeating-conic-gradient(from 0deg, rgba(255,211,92,0.28) 0deg 8deg, transparent 8deg 22deg)', maskImage: 'radial-gradient(circle, black 25%, transparent 68%)' }}
        />
        <p data-reveal-in className="text-[11px] font-semibold tracking-[0.3em] text-gold uppercase">
          {t.daily.got(reward.day)}
        </p>
        <h2 data-reveal-in className="font-display text-4xl leading-none text-cream">
          {grand ? t.daily.grandTitle : t.daily.gotTitle}
        </h2>
        <div data-reveal-prize className="my-3 grid min-h-24 place-items-center">
          <BundleGlyphs reward={reward.reward} size={cards.length > 0 ? 54 : 78} labels />
        </div>
        <p data-reveal-in className="text-sm font-semibold text-cream/85">
          {describe(reward.reward, t)}
        </p>
        {cards.length > 0 && (
          <div className="mt-2 flex justify-center gap-1.5" style={{ perspective: 900 }}>
            {cards.map((entry, index) => (
              <div key={`${entry.card.id}-${index}`} data-reveal-card className="relative" style={{ width, height: Math.round(width * CARD_RATIO) }}>
                <CollectibleCard
                  card={entry.card}
                  width={width}
                  interactive
                  lazy={false}
                  badge={entry.isNew ? <span className="rounded-full bg-like px-1.5 py-0.5 text-[8px] font-bold text-void uppercase">{t.daily.newCard}</span> : undefined}
                />
              </div>
            ))}
          </div>
        )}
        <button
          data-reveal-in
          type="button"
          onClick={onDone}
          className="mt-4 rounded-full px-10 py-3 text-sm font-bold text-[#3a2200] transition-transform active:scale-95"
          style={{ background: 'linear-gradient(135deg, #fff1b8, #ffc23a 55%, #ff9b3d)', boxShadow: '0 10px 30px -10px #ffc23a' }}
        >
          {t.daily.great}
        </button>
      </div>
    </div>
  )
}
