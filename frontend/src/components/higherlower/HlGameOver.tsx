import { useRef, useState } from 'react'
import { Flame, LayoutGrid, Loader2, RotateCcw, Sparkle, Trophy } from 'lucide-react'
import { useCountUp } from '../../hooks/useCountUp'
import { useLanguage, useT } from '../../i18n'
import { formatHlValue, tierProgress } from '../../lib/higherLower'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playHlOver, playHlStart, playHlTier, playReveal } from '../../lib/sfx'
import { useDleStore } from '../../store/useDleStore'
import { hlSound, useHigherLowerStore } from '../../store/useHigherLowerStore'
import { DleBar } from '../dle/DleBar'
import { StardustBadge } from '../dle/StardustBadge'
import { SoundToggle } from './SoundToggle'
import { MetricIcon } from './MetricIcon'
import { HL_DOWN, HL_GRADIENT, HL_UP, METRIC_STYLE, gradientText } from './hlStyle'

/**
 * Bilan d'une série : le score qui défile en grand, un record salué par une
 * couronne de rayons, les Poussières gagnées, le duel qui a coûté la série, puis
 * « Rejouer » (même terrain) ou « Autre terrain ».
 */
export function HlGameOver() {
  const t = useT()
  const locale = useLanguage()
  const rootRef = useRef<HTMLDivElement>(null)
  const result = useHigherLowerStore((state) => state.result)
  const duel = useHigherLowerStore((state) => state.lastDuel)
  const tiers = useHigherLowerStore((state) => state.overview?.tiers ?? [])
  const start = useHigherLowerStore((state) => state.start)
  const starting = useHigherLowerStore((state) => state.starting)
  const openHome = useHigherLowerStore((state) => state.openHome)
  const balance = useDleStore((state) => state.overview?.stardust ?? result?.balance ?? 0)
  const [failed, setFailed] = useState(false)
  const scoreRef = useCountUp(result?.streak ?? 0, { duration: 1, delay: 0.35 })
  const celebrate = Boolean(result && (result.record || result.dayRecord))

  useGSAP(
    () => {
      gsap.fromTo('[data-over-in]', { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.08, ease: EASE.glide })
      gsap.fromTo('[data-over-score]', { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.8, ease: EASE.spring, delay: 0.15 })
      // Record : fanfare ; sinon un accord qui retombe, et des étoiles si des Poussières tombent.
      if (celebrate) gsap.delayedCall(1.2, () => hlSound(() => playReveal('LEGENDARY')))
      else {
        gsap.delayedCall(0.3, () => hlSound(playHlOver))
        if ((result?.reward ?? 0) > 0) gsap.delayedCall(1, () => hlSound(playHlTier))
      }
      if (celebrate) {
        gsap.fromTo('[data-over-badge]', { scale: 0, rotation: -20 }, { scale: 1, rotation: 0, duration: 0.7, delay: 1.2, ease: EASE.snap })
        gsap.delayedCall(1.2, () => vibrate([12, 50, 12, 50, 24]))
      }
      gsap.fromTo('[data-over-reward]', { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.6, delay: 1, ease: EASE.snap })
    },
    { scope: rootRef },
  )

  if (!result) return null
  const style = METRIC_STYLE[result.metric]
  const progress = tierProgress(result.streak, tiers)
  const missing = tiers[0] ? tiers[0].streak - result.streak : 0
  const nextHigher = duel && duel.next.value !== null && duel.current.value !== null ? duel.next.value > duel.current.value : null

  const again = () => {
    vibrate(10)
    hlSound(playHlStart)
    setFailed(false)
    start(result.metric).catch(() => setFailed(true))
  }

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <DleBar label={t.hl.title} onBack={openHome}>
        <SoundToggle />
        <StardustBadge balance={balance} />
      </DleBar>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 pt-2 text-center">
          <p data-over-in className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.28em] uppercase" style={{ color: style.accent }}>
            <MetricIcon metric={result.metric} size={13} />
            {duel ? t.hl.over.title : t.hl.over.quitTitle}
          </p>

          {/* Le score : rayons qui tournent lentement derrière quand c'est un record. */}
          <div className="relative grid size-52 place-items-center">
            {celebrate && (
              <div
                aria-hidden
                className="absolute inset-0 rounded-full opacity-60"
                style={{
                  background: 'repeating-conic-gradient(from 0deg, rgba(255,196,107,0.35) 0deg 8deg, transparent 8deg 22deg)',
                  maskImage: 'radial-gradient(closest-side, #000 35%, transparent 100%)',
                  WebkitMaskImage: 'radial-gradient(closest-side, #000 35%, transparent 100%)',
                  animation: 'seal-spin 18s linear infinite',
                }}
              />
            )}
            <div aria-hidden className="absolute inset-8 rounded-full" style={{ background: `radial-gradient(closest-side, ${celebrate ? 'rgba(255,196,107,0.35)' : style.glow}, transparent)` }} />
            <div data-over-score className="relative flex flex-col items-center">
              <span className="font-display text-[6.5rem] leading-none tabular-nums" style={gradientText(celebrate ? 'linear-gradient(180deg, #fff8dc, #ffc46b 55%, #ff7a3d)' : HL_GRADIENT)}>
                <span ref={scoreRef}>0</span>
              </span>
              <span className="mt-1 flex items-center gap-1 text-xs text-cream/60">
                <Flame size={13} className="fill-[#ff8a3d] text-[#ff8a3d]" aria-hidden />
                {t.hl.over.streak(result.streak)}
              </span>
            </div>
          </div>

          {celebrate && (
            <span
              data-over-badge
              className="-mt-2 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold text-[#2a1a02]"
              style={{ background: 'linear-gradient(135deg, #fff0b0, #e0a82e 55%, #c8901c)', boxShadow: '0 0 26px rgba(255,196,107,0.5)' }}
            >
              <Trophy size={15} aria-hidden />
              {result.record ? t.hl.over.record : t.hl.over.dayRecord}
            </span>
          )}

          {/* Les Poussières. */}
          <div data-over-reward className="flex flex-col items-center gap-1.5">
            {result.reward > 0 ? (
              <span className="inline-flex items-center gap-2 font-display text-4xl" style={gradientText('linear-gradient(135deg, #fff4c8, #ffc46b 45%, #ff5ec4)')}>
                <Sparkle size={26} className="fill-[#ffc46b] text-[#ffc46b]" aria-hidden />+{result.reward}
              </span>
            ) : (
              missing > 0 && <span className="text-sm text-cream/60">{t.hl.over.noReward(missing)}</span>
            )}
            {result.capped && <span className="text-xs text-[#ff9ad8]">{t.hl.over.capped}</span>}
            {!result.capped && progress.next && result.streak > 0 && <span className="text-[11px] text-cream/45">{t.hl.nextTier(progress.next.streak, progress.next.reward)}</span>}
            <span className="text-[11px] text-cream/40 tabular-nums">{t.hl.over.best(result.best)}</span>
          </div>

          {/* Le duel qui a coûté la série. */}
          {duel && duel.current.value !== null && duel.next.value !== null && (
            <div data-over-in className="w-full rounded-[1.5rem] border border-white/10 bg-[#08080f] p-3">
              <p className="mb-2 text-[10px] tracking-[0.22em] text-cream/40 uppercase">{t.hl.over.answer}</p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <DuelSide name={duel.current.name} image={duel.current.image} value={formatHlValue(duel.current.value, result.metric, locale)} />
                <span className="font-display text-2xl" style={{ color: nextHigher ? HL_UP.color : HL_DOWN.color }}>
                  {nextHigher ? '<' : '>'}
                </span>
                <DuelSide name={duel.next.name} image={duel.next.image} value={formatHlValue(duel.next.value, result.metric, locale)} highlight />
              </div>
            </div>
          )}

          <div data-over-in className="flex w-full flex-col gap-2.5 sm:flex-row">
            <button
              type="button"
              onClick={again}
              disabled={starting !== null}
              className="relative inline-flex h-13 flex-1 items-center justify-center gap-2 overflow-hidden rounded-2xl text-sm font-bold tracking-[0.06em] text-[#04241a] uppercase transition-transform active:scale-95 disabled:opacity-70"
              style={{ background: HL_GRADIENT, boxShadow: '0 12px 30px -12px rgba(76,201,240,0.6), inset 0 1px 0 rgba(255,255,255,0.6)' }}
            >
              <span aria-hidden className="absolute inset-y-0 left-0 w-1/2 -skew-x-12" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)', animation: 'shimmer 3s ease-in-out infinite' }} />
              <span className="relative flex items-center gap-2">
                {starting ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <RotateCcw size={17} aria-hidden />}
                {t.hl.over.again}
              </span>
            </button>
            <button
              type="button"
              onClick={openHome}
              className="inline-flex h-13 flex-1 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 text-sm font-semibold text-cream transition-transform active:scale-95"
            >
              <LayoutGrid size={16} aria-hidden />
              {t.hl.over.change}
            </button>
          </div>
          {failed && <p className="text-xs text-nope">{t.hl.startError}</p>}
        </div>
      </div>
    </div>
  )
}

function DuelSide({ name, image, value, highlight = false }: { name: string; image: string | null; value: string; highlight?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <span className="block size-14 overflow-hidden rounded-xl border border-white/10 bg-[#0b0b12]">
        {image && <img src={image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" />}
      </span>
      <span className="w-full truncate text-xs text-cream/80">{name}</span>
      <span className={`text-sm font-semibold tabular-nums ${highlight ? 'text-[#ffc46b]' : 'text-cream/70'}`}>{value}</span>
    </div>
  )
}
