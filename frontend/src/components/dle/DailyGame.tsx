import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { vibrate } from '../../lib/haptics'
import { classicRevealSeconds, mergeSweep, sweepReward } from '../../lib/dle'
import { gsap } from '../../lib/gsap'
import { playChime, playDleMiss, playReveal } from '../../lib/sfx'
import { dleApi, type DleMode, type SweepState } from '../../services/dleApi'
import { dailyKey, useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { ParticleBurst, type Burst } from '../boosters/ParticleBurst'
import { DleBar } from './DleBar'
import { CATEGORY_STYLE, accentOf, modeLabel } from './dleStyle'
import { ClassicBoard, VerdictLegend, WrongGuesses } from './GuessBoard'
import { GuessInput } from './GuessInput'
import { StardustBadge } from './StardustBadge'
import { VictoryPanel } from './VictoryPanel'
import { NextPuzzle } from './NextPuzzle'
import { PixelFrame } from './PixelFrame'
import { SweepFrame } from './SweepFrame'
import { ZoomFrame } from './ZoomFrame'

/**
 * L'énigme du jour d'une catégorie et d'un format : la même pour tout le monde,
 * renouvelée à minuit (heure de Paris). Essais illimités ; trouver vite rapporte plus.
 */
export function DailyGame({ mode }: { mode: DleMode }) {
  const t = useT()
  const category = useDleStore((state) => state.category)
  const view = useDleStore((state) => state.daily[dailyKey(category, mode)])
  const works = useDleStore((state) => state.works[category] ?? null)
  const balance = useDleStore((state) => state.overview?.stardust ?? null)
  const dailyStreak = useDleStore((state) => state.overview?.stats.dailyStreak ?? 0)
  const loadDaily = useDleStore((state) => state.loadDaily)
  const guessDaily = useDleStore((state) => state.guessDaily)
  const openCategory = useDleStore((state) => state.openCategory)
  const notify = useUiStore((state) => state.notify)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [victory, setVictory] = useState<{ streak: number } | null>(null)
  const [burst, setBurst] = useState<Burst | null>(null)
  /** Chiffon : la vitre telle que les derniers coups de chiffon l'ont laissée (en avance sur la vue). */
  const [sweepLocal, setSweepLocal] = useState<{ day: string; state: SweepState } | null>(null)

  useEffect(() => {
    loadDaily(category, mode).catch(() => setFailed(true))
  }, [category, mode, attempt, loadDaily])

  const excluded = useMemo(() => new Set(view?.guesses.map((guess) => guess.work.id) ?? []), [view])

  const onGuess = async (cardId: string) => {
    try {
      const result = await guessDaily(category, mode, cardId)
      const last = result.view.guesses.at(-1)
      // Mode classique : la victoire (ou l'indice « on brûle ») attend que la dernière tuile soit posée.
      const after = mode === 'classic' ? classicRevealSeconds(category, result.view.guesses.length) : 0
      const { answer } = result.view
      if (result.view.solved && answer) {
        setVictory({ streak: result.streak })
        gsap.delayedCall(after, () => {
          vibrate([20, 40, 60])
          playReveal(answer.rarity ?? 'LEGENDARY')
          const colors = [accentOf(answer), '#3fe0a0', '#ffc46b', '#ff5ec4', '#fff4c8']
          setBurst({ id: Date.now(), x: window.innerWidth / 2, y: window.innerHeight * 0.35, colors, count: 140, kind: 'confetti', spread: Math.PI * 2 })
        })
      } else if (last) {
        vibrate(8)
        if (mode === 'sweep') notify(t.dle.sweep.penalty, 'nope')
        if (mode !== 'classic') playDleMiss()
        // Tout en vert sauf l'œuvre : on brûle, le son le dit.
        else if (last.feedback && Object.values(last.feedback).every((entry) => entry.verdict !== 'wrong')) gsap.delayedCall(after, () => playChime())
      }
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DleBar label={t.dle.categories[category].title} onBack={() => openCategory()}>
        {view && view.guesses.length > 0 && <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-cream/80 tabular-nums">{t.dle.game.attempts(view.guesses.length)}</span>}
        {balance !== null && <StardustBadge balance={balance} size="sm" />}
      </DleBar>
      <div data-dle-body className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-16">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <h2 className="text-center font-display text-3xl text-cream">{modeLabel(t, category, mode)}</h2>

        {!view ? (
          failed ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-cream/80">{t.dle.game.loadError}</p>
              <button
                type="button"
                onClick={() => {
                  setFailed(false)
                  setAttempt((value) => value + 1)
                }}
                className="rounded-full bg-cream px-5 py-2.5 text-xs font-medium text-void"
              >
                {t.dle.home.retry}
              </button>
            </div>
          ) : (
            <div className="grid place-items-center py-16">
              <Loader2 size={26} className="animate-spin text-glow" aria-hidden />
            </div>
          )
        ) : (
          <>
            {mode === 'pixel' && (
              <PixelFrame
                src={dleApi.dailyImage(category, 'pixel', view.day)}
                errors={view.guesses.filter((guess) => !guess.correct).length}
                revealed={view.solved}
                glow={CATEGORY_STYLE[category].accent}
                portrait={category !== 'manga'}
              />
            )}
            {mode === 'sweep' && view.sweep && (
              <SweepFrame
                key={view.day}
                category={category}
                sweep={mergeSweep(view.sweep, sweepLocal?.day === view.day ? sweepLocal.state : null) ?? view.sweep}
                reveal={(tiles) => dleApi.dailyReveal(category, tiles)}
                onSweep={(state) => setSweepLocal((current) => ({ day: view.day, state: mergeSweep(current?.day === view.day ? current.state : null, state) ?? state }))}
                fullImage={view.solved ? dleApi.dailyImage(category, 'sweep', view.day) : null}
                glow={CATEGORY_STYLE[category].accent}
                prize={view.solved ? null : sweepReward(Math.max(view.sweep.dirt, sweepLocal?.day === view.day ? sweepLocal.state.dirt : 0), 1)}
              />
            )}
            {mode === 'zoom' && (
              <ZoomFrame
                src={dleApi.dailyImage(category, 'zoom', view.day)}
                focus={view.focus}
                errors={view.guesses.filter((guess) => !guess.correct).length}
                revealed={view.solved}
              />
            )}

            {view.solved && view.answer ? (
              <>
                <VictoryPanel
                  answer={view.answer}
                  reward={view.reward}
                  streak={victory?.streak ?? dailyStreak}
                  nextAt={view.nextAt}
                  fresh={victory !== null}
                />
                <NextPuzzle category={category} mode={mode} fresh={victory !== null} />
              </>
            ) : (
              <GuessInput works={works} excluded={excluded} characters={category !== 'manga'} onGuess={onGuess} />
            )}

            {mode === 'classic' ? (
              <>
                <ClassicBoard guesses={view.guesses} category={category} />
                {view.guesses.length > 0 && <VerdictLegend />}
              </>
            ) : (
              <WrongGuesses guesses={view.guesses} />
            )}
          </>
        )}
      </div>
      </div>
      <ParticleBurst burst={burst} />
    </div>
  )
}
