import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { countDuration, formatHlValue, initialsOf } from '../../lib/higherLower'
import { gsap, useGSAP } from '../../lib/gsap'
import { playHlTick } from '../../lib/sfx'
import { hlSound } from '../../store/useHigherLowerStore'
import type { HlCard as HlCardData, HlChoice, HlMetric } from '../../services/higherLowerApi'
import { MetricIcon } from './MetricIcon'
import { CARD_INK, HL_DOWN, HL_UP, METRIC_STYLE, gradientText } from './hlStyle'

/** Valeur qui défile de 0 à `to`, puis prévient (`onDone`). Écrit dans le DOM : aucun rendu React par frame. */
function CountUp({ to, metric, onDone }: { to: number; metric: HlMetric; onDone: () => void }) {
  const locale = useLanguage()
  const ref = useRef<HTMLSpanElement>(null)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useGSAP(
    () => {
      const node = ref.current
      if (!node) return
      const counter = { value: 0 }
      node.textContent = formatHlValue(0, metric, locale)
      // Un tic toutes les 70 ms au plus, de plus en plus aigu : le compteur s'entend défiler.
      let lastTick = 0
      const tween = gsap.to(counter, {
        value: to,
        duration: countDuration(to),
        ease: 'power3.out',
        onUpdate: () => {
          node.textContent = formatHlValue(counter.value, metric, locale)
          const now = performance.now()
          if (now - lastTick > 70 && tween.progress() < 0.92) {
            lastTick = now
            hlSound(() => playHlTick(tween.progress()))
          }
        },
        onComplete: () => {
          node.textContent = formatHlValue(to, metric, locale)
          done.current()
        },
      })
    },
    { dependencies: [to, metric, locale] },
  )

  return <span ref={ref} />
}

interface HlCardProps {
  card: HlCardData
  metric: HlMetric
  /** `current` : la référence (valeur affichée) ; `next` : la carte à deviner. */
  role: 'current' | 'next'
  /** Valeur révélée de la carte à deviner : le compteur défile, puis `onRevealed`. */
  revealed?: number | null
  onRevealed?: () => void
  verdict?: 'right' | 'wrong' | null
  onChoose?: (choice: HlChoice) => void
  disabled?: boolean
  /** COOP, quand ce n'est pas mon tour : affiché à la place des deux réponses. */
  waiting?: ReactNode
}

/**
 * Une carte du duel, plein cadre : portrait ou couverture (à défaut, les initiales
 * sur le dégradé de la métrique), voile sombre en bas, nom, puis la valeur — ou les
 * deux grosses réponses tant qu'elle est à deviner.
 */
export function HlCard({ card, metric, role, revealed = null, onRevealed, verdict = null, onChoose, disabled = false, waiting }: HlCardProps) {
  const t = useT()
  const locale = useLanguage()
  const [broken, setBroken] = useState(false)
  const style = METRIC_STYLE[metric]
  const words = t.hl.metrics[metric]
  const portrait = metric === 'bounty'
  const value = role === 'current' ? card.value : revealed
  const valueGradient = verdict === 'right' ? HL_UP.gradient : verdict === 'wrong' ? HL_DOWN.gradient : 'linear-gradient(180deg, #fff8dc, #ffc46b 60%, #ff9a3d)'

  return (
    <div className="relative isolate h-full w-full overflow-hidden rounded-[2rem] border border-white/10" style={{ background: CARD_INK }}>
      {/* Image : portrait cadré sur le visage, couverture centrée ; sinon des initiales géantes. */}
      {card.image && !broken ? (
        <img
          src={card.image}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => setBroken(true)}
          className={`absolute inset-0 -z-10 h-full w-full object-cover ${portrait ? 'object-[50%_15%]' : 'object-center'}`} // i18n-ignore
        />
      ) : (
        <div aria-hidden className="absolute inset-0 -z-10 grid place-items-center" style={{ background: `radial-gradient(circle at 50% 35%, ${style.glow}, transparent 70%), ${CARD_INK}` }}>
          <span className="font-display text-[clamp(5rem,22vw,9rem)] leading-none opacity-80" style={gradientText(style.gradient)}>
            {initialsOf(card.name)}
          </span>
        </div>
      )}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ background: 'linear-gradient(180deg, rgba(5,5,8,0.35) 0%, rgba(5,5,8,0) 22%, rgba(5,5,8,0.1) 45%, rgba(5,5,8,0.82) 72%, #050508 100%)' }}
      />
      {/* Éclair du verdict, joué par l'écran de jeu. */}
      <div
        aria-hidden
        data-hl-flash
        className="pointer-events-none absolute inset-0 rounded-[2rem] opacity-0"
        style={{ boxShadow: `inset 0 0 0 3px ${verdict === 'wrong' ? HL_DOWN.color : HL_UP.color}, inset 0 0 60px ${verdict === 'wrong' ? HL_DOWN.glow : HL_UP.glow}` }}
      />

      <div className="flex h-full flex-col justify-between p-4 md:p-6">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[10px] font-semibold tracking-[0.16em] uppercase" style={{ color: style.accent }}>
          <MetricIcon metric={metric} size={12} />
          {words.label}
        </span>

        <div className="min-w-0 text-center">
          <h3 className="line-clamp-2 font-display text-[clamp(1.35rem,5.5vw,2.25rem)] leading-[1.05] text-cream">{card.name}</h3>
          <p className="mt-1 text-xs text-cream/60 md:text-sm">{words.question}</p>

          {value !== null ? (
            <p className="mt-1.5 flex flex-wrap items-baseline justify-center gap-x-2 font-display leading-none tabular-nums">
              <span className="text-[clamp(1.7rem,7.5vw,3rem)]" style={gradientText(valueGradient)}>
                {role === 'next' && revealed !== null ? <CountUp to={revealed} metric={metric} onDone={() => onRevealed?.()} /> : formatHlValue(value, metric, locale)}
              </span>
              <span className="text-sm text-cream/55 md:text-base">{words.unit}</span>
            </p>
          ) : waiting ? (
            <div className="mx-auto mt-3 flex min-h-13 w-full max-w-sm items-center justify-center md:mt-4 md:min-h-14">{waiting}</div>
          ) : (
            <div className="mx-auto mt-3 grid w-full max-w-sm grid-cols-2 gap-2.5 md:mt-4 md:grid-cols-1 md:gap-3">
              <ChoiceButton direction="higher" label={t.hl.higher} disabled={disabled} onClick={() => onChoose?.('higher')} />
              <ChoiceButton direction="lower" label={t.hl.lower} disabled={disabled} onClick={() => onChoose?.('lower')} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ChoiceButton({ direction, label, disabled, onClick }: { direction: HlChoice; label: string; disabled: boolean; onClick: () => void }) {
  const tone = direction === 'higher' ? HL_UP : HL_DOWN
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative inline-flex h-13 items-center justify-center gap-2 overflow-hidden rounded-2xl text-sm font-bold tracking-[0.08em] uppercase transition-transform active:scale-95 disabled:opacity-60 md:h-14 md:text-base"
      style={{ background: tone.gradient, color: tone.ink, boxShadow: `0 10px 30px -12px ${tone.glow}, inset 0 1px 0 rgba(255,255,255,0.6)` }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1/2 -skew-x-12"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)', animation: 'shimmer 3.2s ease-in-out infinite' }}
      />
      <span className="relative flex items-center gap-1.5">
        {direction === 'higher' ? <ArrowUp size={18} strokeWidth={2.75} aria-hidden /> : <ArrowDown size={18} strokeWidth={2.75} aria-hidden />}
        {label}
      </span>
    </button>
  )
}
