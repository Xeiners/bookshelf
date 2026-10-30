import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Trophy, X } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playChime } from '../../lib/sfx'
import type { RewardChoice } from '../../services/rewardsApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useBoosterStore } from '../../store/useBoosterStore'
import { useRecordRewards } from '../../store/useRecordRewards'
import { useRunnerWardrobe } from '../../store/useRunnerWardrobeStore'
import { useUiStore } from '../../store/useUiStore'
import { BoosterPackArt } from '../boosters/BoosterPackArt'

/**
 * Record de tous les temps battu : un trophée, le score, l'ancien record, et le choix de
 * la récompense — un booster de cartes, ou une boîte mystère de la garde-robe (à ouvrir
 * plus tard). S'ouvre d'elle-même (fin de partie, notification) ; à monter une fois, dans `App`.
 */
export function RecordRewardModal() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  // À la connexion (ou à l'ouverture de l'app) : une récompense encore à choisir se présente.
  useEffect(() => {
    if (accountId) void useRecordRewards.getState().load(true)
  }, [accountId])
  const open = useRecordRewards((state) => state.open)
  const reward = useRecordRewards((state) => state.pending[0] ?? null)
  if (!open || !reward) return null
  return createPortal(<RewardChoiceDialog key={reward.id} />, document.body)
}

function RewardChoiceDialog() {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const reward = useRecordRewards((state) => state.pending[0]!)
  const claim = useRecordRewards((state) => state.claim)
  const close = useRecordRewards((state) => state.close)
  const notify = useUiStore((state) => state.notify)
  const [busy, setBusy] = useState<RewardChoice | null>(null)

  useGSAP(
    () => {
      playChime(true)
      vibrate([20, 40, 20, 40, 80])
      const timeline = gsap.timeline({ defaults: { ease: EASE.glide } })
      timeline
        .fromTo('[data-reward-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 })
        .fromTo('[data-reward-trophy]', { scale: 0.2, rotation: -25, autoAlpha: 0 }, { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.7, ease: 'back.out(2.2)' }, 0.1)
        .fromTo('[data-reward-rays]', { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.8 }, 0.15)
        .fromTo('[data-reward-in]', { y: 22, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.07 }, 0.35)
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.to('[data-reward-rays]', { rotation: 360, duration: 18, ease: 'none', repeat: -1 })
        gsap.to('[data-reward-trophy]', { y: -6, duration: 1.2, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 0.8 })
      }
    },
    { scope: ref },
  )

  const choose = async (choice: RewardChoice) => {
    if (busy) return
    setBusy(choice)
    try {
      await claim(reward.id, choice)
      vibrate([10, 30, 60])
      notify(choice === 'booster' ? t.recordReward.gotBooster : t.recordReward.gotBox, 'like')
      // Les stocks affichés se mettent à jour (réserve de boosters, boîtes offertes).
      if (choice === 'booster') void useBoosterStore.getState().refresh()
      else void useRunnerWardrobe.getState().load()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
      void useRecordRewards.getState().load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div ref={ref} className="fixed inset-0 z-[130] grid place-items-center px-5" role="dialog" aria-modal="true" aria-label={t.recordReward.title}>
      <div data-reward-backdrop className="absolute inset-0 bg-[#0b0618]/90" onClick={close} />
      <div className="relative flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <button type="button" onClick={close} aria-label={t.recordReward.later} className="absolute -top-2 right-0 grid size-10 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-cream">
          <X size={18} />
        </button>
        <div className="relative grid size-36 place-items-center">
          <span
            data-reward-rays
            aria-hidden
            className="absolute inset-[-40%] rounded-full opacity-0"
            style={{ background: 'repeating-conic-gradient(from 0deg, rgba(255,211,92,0.35) 0deg 8deg, transparent 8deg 22deg)', maskImage: 'radial-gradient(circle, black 30%, transparent 70%)' }}
          />
          <span
            data-reward-trophy
            className="relative grid size-28 place-items-center rounded-[2rem] text-[#3a2200]"
            style={{ background: 'linear-gradient(150deg, #fff6c8, #ffc23a 50%, #ff8a3d)', boxShadow: '0 0 60px -6px #ffc23a, inset 0 -6px 0 rgba(0,0,0,0.15)' }}
          >
            <Trophy size={58} strokeWidth={2.2} />
          </span>
        </div>
        <p data-reward-in className="text-[11px] font-semibold tracking-[0.3em] text-gold uppercase">
          {t.recordReward.games[reward.game]}
        </p>
        <h2 data-reward-in className="font-display text-4xl leading-none text-cream">
          {t.recordReward.title}
        </h2>
        <p data-reward-in className="text-sm text-cream/70">
          {t.recordReward.body(reward.score, reward.previous)}
        </p>
        <p data-reward-in className="mt-1 text-xs font-bold tracking-[0.2em] text-cream/55 uppercase">
          {t.recordReward.choose}
        </p>
        <div data-reward-in className="grid w-full grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void choose('booster')}
            disabled={busy !== null}
            className="flex flex-col items-center gap-2 rounded-[1.5rem] border border-[#ffc46b]/50 bg-[linear-gradient(160deg,#2a1a08,#1a1020)] px-3 pt-4 pb-3 transition-transform active:scale-95 disabled:opacity-60"
          >
            <span className="-rotate-6">
              <BoosterPackArt width={58} series={3} lit />
            </span>
            <span className="text-sm font-bold text-cream">{t.recordReward.booster}</span>
            <span className="text-[11px] leading-snug text-cream/55">{t.recordReward.boosterHint}</span>
            {busy === 'booster' && <Loader2 size={16} className="animate-spin text-cream/70" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => void choose('box')}
            disabled={busy !== null}
            className="flex flex-col items-center gap-2 rounded-[1.5rem] border border-[#b05cff]/60 bg-[linear-gradient(160deg,#2a1150,#160a33)] px-3 pt-4 pb-3 transition-transform active:scale-95 disabled:opacity-60"
          >
            <span aria-hidden className="relative grid size-[4.5rem] rotate-6 place-items-center">
              <span className="absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(160deg, #5a24a8, #2a1150)', boxShadow: '0 0 22px -2px #b05cff, inset 0 0 0 3px #ffc93c' }} />
              <span className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 bg-[#ffc93c]" />
              <span className="absolute inset-x-0 top-[38%] h-3 bg-[#ffc93c]" />
              <span className="relative font-display text-3xl text-[#ffe9a8]">?</span>
            </span>
            <span className="text-sm font-bold text-cream">{t.recordReward.box}</span>
            <span className="text-[11px] leading-snug text-cream/55">{t.recordReward.boxHint}</span>
            {busy === 'box' && <Loader2 size={16} className="animate-spin text-cream/70" aria-hidden />}
          </button>
        </div>
        <button type="button" onClick={close} className="text-xs font-semibold text-cream/50 underline-offset-4 hover:underline">
          {t.recordReward.later}
        </button>
      </div>
    </div>
  )
}
