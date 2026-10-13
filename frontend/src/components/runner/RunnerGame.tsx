import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Cloud, Loader2, Magnet, Pause, Play, ScrollText, Sparkles, X } from 'lucide-react'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { CLOUD_TIME, MAGNET_TIME, QUIZ_TIME, SHIELD_TIME, multiplierFor, reviveCost } from '../../lib/runner/constants'
import { act, answerQuiz, createRun, revive, scoreOf, type ActiveQuiz, type RunAction, type RunState } from '../../lib/runner/engine'
import { makeQuiz, type QuizUniverse } from '../../lib/runner/quiz'
import { seededRandom } from '../../lib/runner/random'
import { playChime, playRunnerHit, playRunnerJump, playRunnerPower, playRunnerSlide, playRunnerStar, playRunnerStumble, playRunnerWrong } from '../../lib/sfx'
import type { RunnerAssets } from './assets'
import type { HeroLookId } from './looks'
import { RunnerScene } from './RunnerScene'

export interface RunnerOutcome {
  distance: number
  stardust: number
  quiz: number
  score: number
}

interface RunnerGameProps {
  /** Graine de la piste (donnée par le serveur). */
  seed: number
  look: HeroLookId
  assets: RunnerAssets
  buttons: boolean
  lite: boolean
  universes: readonly QuizUniverse[]
  onOver: (outcome: RunnerOutcome) => void
  /** Résurrection possible (course enregistrée sur un compte) : le solde, et le paiement. `null` : jamais. */
  revival: { balance: number; pay: () => Promise<boolean> } | null
  /** Abandon (depuis la pause) : la distance parcourue compte comme une fin de course. */
  onQuit: (outcome: RunnerOutcome) => void
}

const KEYS: Record<string, RunAction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  q: 'left',
  a: 'left',
  d: 'right',
  z: 'up',
  w: 'up',
  ' ': 'up',
  s: 'down',
}

/** Temps pour décider de revivre (s). */
const REVIVE_SECONDS = 6

/** Distance d'un glissement de doigt qui compte comme un geste (px). */
const SWIPE = 26

/**
 * Une course : la scène 3D en plein écran et, par-dessus, le HUD. Les compteurs qui
 * changent à chaque image (distance, score, ✦, jauges) sont écrits directement dans le
 * DOM ; React ne se redessine que pour ce qui change rarement (vies, quiz, pause).
 */
export function RunnerGame({ seed, look, assets, buttons, lite, universes, onOver, revival, onQuit }: RunnerGameProps) {
  const t = useT()
  const [initial] = useState(() => createRun(seed))
  const state = useRef<RunState>(initial)
  const paused = useRef(true)
  const [pausedView, setPausedView] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(3)
  /** Choc fatal : l'offre de résurrection (prix, secondes restantes), ou `null`. */
  const [offer, setOffer] = useState<{ cost: number; paying: boolean } | null>(null)
  const [offerLeft, setOfferLeft] = useState(0)
  const [quiz, setQuiz] = useState<ActiveQuiz | null>(null)
  const [verdict, setVerdict] = useState<'right' | 'wrong' | null>(null)
  const [hitFlash, setHitFlash] = useState(0)

  const distanceRef = useRef<HTMLSpanElement>(null)
  const scoreRef = useRef<HTMLSpanElement>(null)
  const starsRef = useRef<HTMLSpanElement>(null)
  const multiplierRef = useRef<HTMLSpanElement>(null)
  const quizBarRef = useRef<HTMLDivElement>(null)
  const powerRefs = useRef<Record<'magnet' | 'cloud' | 'shield', HTMLDivElement | null>>({ magnet: null, cloud: null, shield: null })
  const registerGauge = useCallback((name: 'magnet' | 'cloud' | 'shield', node: HTMLDivElement | null) => {
    powerRefs.current[name] = node
  }, [])
  const shown = useRef({ distance: -1, score: -1, stars: -1, multiplier: -1 })
  const combo = useRef({ count: 0, at: 0 })
  const finished = useRef(false)
  const onOverRef = useRef(onOver)
  const revivalRef = useRef(revival)
  useEffect(() => {
    onOverRef.current = onOver
    revivalRef.current = revival
  }, [onOver, revival])

  /** Fin de la course : le bilan part au serveur. */
  const end = useCallback((run: RunState) => {
    if (finished.current) return
    finished.current = true
    setOffer(null)
    onOverRef.current({ distance: run.distance, stardust: run.stardust, quiz: run.quizRight, score: scoreOf(run) })
  }, [])

  // Offre de résurrection : un compte à rebours, puis la course se termine d'elle-même.
  const offering = offer !== null && !offer.paying
  useEffect(() => {
    if (!offering) return
    if (offerLeft <= 0) {
      end(state.current)
      return
    }
    const timer = window.setTimeout(() => setOfferLeft((left) => left - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [offering, offerLeft, end])

  const accept = async () => {
    const current = revivalRef.current
    if (!offer || offer.paying || !current) return
    setOffer({ ...offer, paying: true })
    const paid = await current.pay()
    if (!paid) {
      end(state.current)
      return
    }
    revive(state.current)
    setOffer(null)
    paused.current = false
  }

  // Questions de quiz : tirées des univers du BookshelfDLE, reproductibles avec la graine.
  const [quizRandom] = useState(() => seededRandom(seed ^ 0x9e3779b9))
  const ask = useCallback(() => makeQuiz(universes, t.runner.quiz, quizRandom), [universes, t, quizRandom])

  // Compte à rebours, puis départ.
  useEffect(() => {
    if (countdown === null) return
    if (countdown === 0) {
      const timer = window.setTimeout(() => {
        setCountdown(null)
        paused.current = false
      }, 450)
      return () => window.clearTimeout(timer)
    }
    playChime(false)
    const timer = window.setTimeout(() => setCountdown(countdown - 1), 650)
    return () => window.clearTimeout(timer)
  }, [countdown])

  const pause = useCallback((value: boolean) => {
    // Course finie, ou en attente d'une résurrection : la pause n'a plus de sens.
    if (finished.current || state.current.over) return
    paused.current = value
    setPausedView(value)
  }, [])

  // Onglet caché : pause automatique.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && countdown === null) pause(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [countdown, pause])

  // Développement : l'état de la course, lisible depuis la console (et les tests du navigateur).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    Object.assign(window, { __mangaRunner: state })
    return () => {
      Reflect.deleteProperty(window, '__mangaRunner')
    }
  }, [])

  // Pas de défilement de la page pendant la course : les gestes sont pour le jeu.
  useEffect(() => {
    const { overflow, overscrollBehavior } = document.body.style
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = overflow
      document.body.style.overscrollBehavior = overscrollBehavior
    }
  }, [])

  const perform = useCallback((action: RunAction) => {
    if (paused.current) return
    act(state.current, action)
  }, [])

  /** Une réponse touchée au quiz : jugée tout de suite (le verdict suit, via les événements). */
  const answer = useCallback((choice: 0 | 1 | 2) => {
    if (paused.current) return
    answerQuiz(state.current, choice)
  }, [])

  // Clavier : flèches, ZQSD / WASD, espace ; Échap met en pause.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'p') {
        pause(!paused.current)
        return
      }
      const action = KEYS[event.key] ?? KEYS[event.key.toLowerCase()]
      if (!action) return
      event.preventDefault()
      if (!event.repeat) perform(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pause, perform])

  // Glissements : le geste part dès que le doigt a assez bougé (pas besoin de le lever).
  const swipe = useRef<{ id: number; x: number; y: number; used: boolean } | null>(null)
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY, used: false }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = swipe.current
    if (!current || current.used || current.id !== event.pointerId) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return
    current.used = true
    perform(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down')
  }
  const onPointerUp = () => {
    swipe.current = null
  }

  const onTick = useCallback(
    (run: RunState) => {
      // Compteurs : écrits seulement quand ils changent.
      const distance = Math.floor(run.distance)
      const score = scoreOf(run)
      const multiplier = multiplierFor(run.stardust)
      const last = shown.current
      if (distance !== last.distance && distanceRef.current) distanceRef.current.textContent = `${distance.toLocaleString()} m`
      if (score !== last.score && scoreRef.current) scoreRef.current.textContent = score.toLocaleString()
      if (run.stardust !== last.stars && starsRef.current) starsRef.current.textContent = String(run.stardust)
      if (multiplier !== last.multiplier && multiplierRef.current) multiplierRef.current.textContent = `×${multiplier.toFixed(1)}`
      Object.assign(last, { distance, score, stars: run.stardust, multiplier })
      // Jauges des bonus et du quiz.
      const gauges: [keyof typeof powerRefs.current, number, number][] = [
        ['magnet', run.magnetUntil, MAGNET_TIME],
        ['cloud', run.cloudUntil, CLOUD_TIME],
        ['shield', run.shieldUntil, SHIELD_TIME],
      ]
      for (const [name, until, total] of gauges) {
        const node = powerRefs.current[name]
        if (!node) continue
        const left = Math.max(0, until - run.t) / total
        node.style.display = left > 0 ? 'flex' : 'none'
        const bar = node.lastElementChild as HTMLElement | null
        if (bar) bar.style.transform = `scaleX(${left})`
      }
      if (run.quiz && quizBarRef.current) quizBarRef.current.style.transform = `scaleX(${Math.max(0, run.quiz.deadline - run.t) / QUIZ_TIME})`

      if (run.events.length === 0) return
      for (const event of run.events) {
        switch (event) {
          case 'star': {
            const now = run.t
            combo.current.count = now - combo.current.at < 0.6 ? combo.current.count + 1 : 0
            combo.current.at = now
            playRunnerStar(combo.current.count)
            break
          }
          case 'jump':
            playRunnerJump()
            break
          case 'slide':
            playRunnerSlide()
            break
          case 'lane':
            vibrate(4)
            break
          case 'stumble':
            playRunnerStumble()
            vibrate([20, 25, 20])
            break
          case 'hit':
            playRunnerHit()
            vibrate([40, 30, 60])
            setHitFlash((value) => value + 1)
            break
          case 'magnet':
          case 'cloud':
            playRunnerPower()
            vibrate(15)
            break
          case 'quiz':
            playChime(true)
            setVerdict(null)
            setQuiz(run.quiz)
            break
          case 'quizRight':
            playRunnerPower()
            vibrate([15, 30, 15])
            setQuiz(null)
            setVerdict('right')
            break
          case 'quizWrong':
            playRunnerWrong()
            setQuiz(null)
            setVerdict('wrong')
            break
          case 'over': {
            setQuiz(null)
            // Résurrection possible : la course est figée le temps de choisir.
            const cost = revivalRef.current ? reviveCost(run.revives) : null
            if (cost !== null) {
              paused.current = true
              setOffer({ cost, paying: false })
              setOfferLeft(REVIVE_SECONDS)
            } else end(run)
            break
          }
          case 'revive':
            playRunnerPower()
            vibrate([20, 40, 20])
            break
        }
      }
      run.events.length = 0
    },
    [end],
  )

  // Le verdict du quiz s'efface après un instant.
  useEffect(() => {
    if (!verdict) return
    const timer = window.setTimeout(() => setVerdict(null), 1600)
    return () => window.clearTimeout(timer)
  }, [verdict])

  return (
    <div
      className="fixed inset-0 z-[85] touch-none overflow-hidden bg-[#1d0f40] select-none [-webkit-touch-callout:none]"
      style={{ overscrollBehavior: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <RunnerScene state={state} paused={paused} ask={ask} onTick={onTick} lite={lite} look={look} assets={assets} />

      {/* Éclair rouge au choc. */}
      {hitFlash > 0 && <div key={hitFlash} aria-hidden className="pointer-events-none absolute inset-0 animate-[runner-hit_0.45s_ease-out_forwards] bg-nope/35" />}

      {/* HUD du haut : distance, bonus actifs, score, ✦ et multiplicateur, pause. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex flex-col gap-1.5">
          <span ref={distanceRef} className="font-display text-3xl leading-none text-white tabular-nums drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
            0 m
          </span>
          <div className="flex flex-col gap-1">
            <PowerGauge register={registerGauge} name="magnet" label={t.runner.hud.magnet} icon={<Magnet size={13} aria-hidden />} color="#ff4d5e" />
            <PowerGauge register={registerGauge} name="cloud" label={t.runner.hud.cloud} icon={<Cloud size={13} aria-hidden />} color="#bfe9ff" />
            <PowerGauge register={registerGauge} name="shield" label={t.runner.hud.shield} icon={<ScrollText size={13} aria-hidden />} color="#ffd36b" />
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex flex-col items-end gap-1 rounded-2xl bg-black/35 px-3 py-2 backdrop-blur-sm">
            <span ref={scoreRef} className="text-lg leading-none font-bold text-white tabular-nums">
              0
            </span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-gold tabular-nums">
              ✦ <span ref={starsRef}>0</span>
              <span ref={multiplierRef} className="rounded-full bg-gold/20 px-1.5 text-[11px] text-gold">
                ×1.0
              </span>
            </span>
          </div>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => pause(true)}
            aria-label={t.runner.hud.pause}
            className="pointer-events-auto grid size-11 place-items-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-sm"
          >
            <Pause size={18} />
          </button>
        </div>
      </div>

      {/* Quiz : la question en haut, les trois réponses à toucher, en bas. */}
      {quiz && (
        <div className="pointer-events-none absolute inset-x-0 top-[28%] flex flex-col items-center gap-3 px-4">
          <div className="flex max-w-md items-center gap-3 rounded-2xl border border-gold/40 bg-[#1d0f40]/85 px-4 py-3 shadow-[0_0_24px_rgba(255,196,107,0.35)] backdrop-blur">
            {quiz.question.image && <img src={quiz.question.image} alt="" className="size-12 shrink-0 rounded-xl object-cover object-top" />}
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-base leading-snug font-bold text-white">{quiz.question.prompt}</p>
              <p className="text-[11px] tracking-wide text-gold/90 uppercase">{t.runner.hud.quizHint}</p>
            </div>
          </div>
          <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/15">
            <div ref={quizBarRef} className="h-full origin-left rounded-full bg-gold" />
          </div>
        </div>
      )}
      {quiz && (
        <div
          className="absolute inset-x-0 bottom-[max(6.5rem,calc(env(safe-area-inset-bottom)+6rem))] grid grid-cols-3 gap-2 px-3"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {quiz.question.options.map((option, index) => (
            <button
              key={index}
              type="button"
              onClick={() => answer(index as 0 | 1 | 2)}
              className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border border-white/25 bg-black/50 px-2 py-2 text-center backdrop-blur-sm transition-all duration-150 active:scale-95 active:border-gold active:bg-gold/30 active:shadow-[0_0_20px_rgba(255,196,107,0.55)]"
            >
              {option.image && <img src={option.image} alt="" className="size-9 rounded-lg object-cover object-top" />}
              <span className="line-clamp-2 text-xs leading-tight font-bold text-white">{option.label}</span>
            </button>
          ))}
        </div>
      )}
      {verdict && (
        <div className="pointer-events-none absolute inset-x-0 top-[30%] flex justify-center px-4">
          <span
            className={`rounded-full px-5 py-2.5 text-base font-bold shadow-lg ${verdict === 'right' ? 'bg-[#3fd0ff] text-void' : 'bg-nope/90 text-white'}`}
          >
            {verdict === 'right' ? t.runner.hud.quizRight : t.runner.hud.quizWrong}
          </span>
        </div>
      )}

      {/* Boutons à l'écran (au choix, sur l'accueil du Runner). */}
      {buttons && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))]" onPointerDown={(event) => event.stopPropagation()}>
          <TouchButton label={t.runner.hud.left} onPress={() => perform('left')} icon={<ArrowLeft size={26} />} />
          <div className="flex gap-2">
            <TouchButton label={t.runner.hud.slide} onPress={() => perform('down')} icon={<ArrowDown size={26} />} />
            <TouchButton label={t.runner.hud.jump} onPress={() => perform('up')} icon={<ArrowUp size={26} />} />
          </div>
          <TouchButton label={t.runner.hud.right} onPress={() => perform('right')} icon={<ArrowRight size={26} />} />
        </div>
      )}

      {offer && (
        <div className="absolute inset-0 grid place-items-center bg-black/60 px-6 backdrop-blur-sm" onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex w-full max-w-xs flex-col items-center gap-4 text-center">
            <div className="relative grid size-24 place-items-center">
              <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
                <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="#ffd35c"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={276.5}
                  strokeDashoffset={276.5 * (1 - offerLeft / REVIVE_SECONDS)}
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <span className="font-display text-4xl text-white tabular-nums">{offerLeft}</span>
            </div>
            <p className="font-display text-3xl text-white">{t.runner.revive.title}</p>
            <p className="text-sm text-cream/70">{t.runner.revive.body}</p>
            <button
              type="button"
              onClick={() => void accept()}
              disabled={offer.paying || (revival?.balance ?? 0) < offer.cost}
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full text-base font-bold text-void shadow-[0_0_28px_rgba(255,211,92,0.5)] disabled:opacity-45"
              style={{ background: 'linear-gradient(135deg, #fff0b0, #ffd35c 45%, #ff9f43)' }}
            >
              {offer.paying ? <Loader2 size={19} className="animate-spin" aria-hidden /> : <Sparkles size={19} aria-hidden />}
              {t.runner.revive.pay(offer.cost)}
            </button>
            <p className="text-xs text-cream/55">{(revival?.balance ?? 0) < offer.cost ? t.runner.revive.short(revival?.balance ?? 0) : t.runner.revive.balance(revival?.balance ?? 0)}</p>
            <button type="button" onClick={() => end(state.current)} disabled={offer.paying} className="h-11 w-full rounded-full border border-white/20 bg-white/10 text-sm font-semibold text-white disabled:opacity-45">
              {t.runner.revive.decline}
            </button>
          </div>
        </div>
      )}

      {countdown !== null && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span key={countdown} className="animate-[runner-count_0.6s_ease-out] font-display text-8xl text-white drop-shadow-[0_0_30px_rgba(255,111,181,0.9)]">
            {countdown > 0 ? countdown : t.runner.hud.go}
          </span>
        </div>
      )}

      {pausedView && (
        <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-sm" onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex w-64 flex-col items-center gap-3">
            <p className="font-display text-4xl text-white">{t.runner.hud.paused}</p>
            <button type="button" onClick={() => pause(false)} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-cream text-sm font-semibold text-void">
              <Play size={17} />
              {t.runner.hud.resume}
            </button>
            <button
              type="button"
              onClick={() => {
                const run = state.current
                finished.current = true
                paused.current = true
                setPausedView(false)
                onQuit({ distance: run.distance, stardust: run.stardust, quiz: run.quizRight, score: scoreOf(run) })
              }}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 text-sm font-semibold text-white"
            >
              <X size={17} />
              {t.runner.hud.quit}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PowerGauge({
  register,
  name,
  label,
  icon,
  color,
}: {
  register: (name: 'magnet' | 'cloud' | 'shield', node: HTMLDivElement | null) => void
  name: 'magnet' | 'cloud' | 'shield'
  label: string
  icon: ReactNode
  color: string
}) {
  return (
    <div
      ref={(node) => register(name, node)}
      className="relative w-28 flex-col gap-1 overflow-hidden rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white"
      style={{ display: 'none' }}
    >
      <span className="flex items-center gap-1" style={{ color }}>
        {icon}
        {label}
      </span>
      <span className="absolute inset-x-0 bottom-0 h-1 origin-left" style={{ backgroundColor: color }} />
    </div>
  )
}

function TouchButton({ label, onPress, icon }: { label: string; onPress: () => void; icon: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault()
        onPress()
      }}
      className="grid size-16 place-items-center rounded-2xl border border-white/20 bg-black/40 text-white backdrop-blur-sm active:scale-95 active:bg-white/20"
    >
      {icon}
    </button>
  )
}
