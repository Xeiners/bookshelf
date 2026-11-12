import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Hand, Moon, Pause, Play, Pointer, RotateCcw, ScrollText, Shield, Skull, Smartphone, X, type LucideIcon } from 'lucide-react'
import { useT } from '../../i18n'
import { MOON_SECONDS, TICK } from '../../lib/gravity/constants'
import { buildWorld, progressOf, scrollsIn, type Checkpoint, type GravityWorld } from '../../lib/gravity/engine'
import { introsOf, type IntroKind } from '../../lib/gravity/intros'
import type { SolveReport } from '../../lib/gravity/solver'
import type { CoachCue } from '../../lib/gravity/tutorial'
import type { GravityLevel } from '../../lib/gravity/types'
import { vibrate } from '../../lib/haptics'
import { playGravityFinish, playGravityFlip, playGravityLand, playGravityLog, playGravityMoon, playGravityPoof, playGravityScroll, playGravitySize, playGravityWarp } from '../../lib/sfx'
import { useNotificationStore } from '../../store/useNotificationStore'
import { SfxVolume } from '../ui/SfxVolume'
import { GravityScene, layoutFor } from './scene/GravityScene'

/** Après une chute, le temps de voir la fumée avant la tentative suivante, au départ (s). */
const RESPAWN_DELAY = 0.75
/** Durée d'affichage de l'explication d'un élément nouveau (ms). */
const TIP_MS = 3400
/** Après l'arrivée, le temps de la fête avant le bilan (s). */
const FINISH_DELAY = 1.1
/** Images au plus rattrapées d'un coup (onglet en arrière-plan, appareil lent). */
const MAX_STEPS = 8

export interface GravityRunResult {
  /** Avancement le plus loin atteint (0 → 100). */
  percent: number
  completed: boolean
  /** Temps de jeu (pauses exclues), en millisecondes. */
  timeMs: number
  deaths: number
  scrolls: number
}

interface GravityGameProps {
  level: GravityLevel
  /** Niveau fini : le bilan. */
  onFinish: (result: GravityRunResult) => void
  /** Partie quittée en cours : le bilan partiel. */
  onQuit: (result: GravityRunResult) => void
  /** « Recommencer » depuis la pause : le bilan partiel, puis une partie neuve. */
  onRestart: (result: GravityRunResult) => void
  /** Badge « Essai » (atelier) : rien n'est enregistré. */
  trial?: boolean
  /** Démonstration : le solveur joue son chemin (les touchers du joueur sont ignorés). */
  solution?: SolveReport | null
  /** Meilleur avancement déjà enregistré (0 → 100) : repéré sur la barre de progression. */
  record?: number
  /**
   * Tutoriel : les fenêtres où toucher (cf. `lib/gravity/tutorial.ts`). Pendant chacune, le temps
   * ralentit et l'invite « Touche ! » s'affiche.
   */
  coach?: readonly CoachCue[]
  /**
   * Tutoriel : ses chapitres. À l'approche de chacun, sa carte s'affiche (et le temps ralentit un
   * instant pour la lire) ; une chute fait reprendre au début du chapitre en cours.
   */
  chapters?: readonly GameChapter[]
}

export interface GameChapter {
  x: number
  title: string
  text: string
  icon: LucideIcon
  checkpoint: Checkpoint
}

/** Au ralenti, une fenêtre dure environ ce temps réel (s), sans aller plus lent que `SLOWEST`. */
const COACH_REAL_SECONDS = 1.2
const SLOWEST = 0.2
/** Invite du tutoriel : toucher, toucher et maintenir, maintenir jusqu'à se poser. */
type CoachPrompt = 'press' | 'hold' | 'holding' | null
/** La carte d'un chapitre s'affiche quand il est à tant de secondes de course ; puis ralenti pour la lire (s réelles, vitesse). */
const CHAPTER_AHEAD = 1.3
const CHAPTER_SLOW = { seconds: 1.8, scale: 0.5 }

/** Le bilan d'une partie (en cours ou finie). */
function resultOf(world: GravityWorld, scene: GravityScene | null, seconds: number, completed: boolean): GravityRunResult {
  const run = scene?.run
  return {
    percent: completed ? 100 : run ? progressOf(world, run.maxX) : 0,
    completed,
    timeMs: Math.round(seconds * 1000),
    deaths: run?.deaths ?? 0,
    scrolls: run ? scrollsIn(run.scrolls) : 0,
  }
}

/** Écran étroit et vertical : le couloir y serait petit, on propose de tourner l'appareil. */
const portrait = () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth && window.innerWidth < 700

/**
 * Gravity Ninja en plein écran : le canvas, la progression, les rouleaux, les chutes. Un seul
 * geste : toucher l'écran (clic, Espace, flèches) inverse la gravité ; le maintenir, sous la lune,
 * fait planer. Pas de point de reprise : une chute renvoie au départ, pour une nouvelle tentative
 * (« Tentative n »), et la barre garde la trace du meilleur avancement.
 */
export function GravityGame({ level, onFinish, onQuit, onRestart, trial = false, solution = null, record = 0, coach, chapters }: GravityGameProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<GravityScene | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const percentRef = useRef<HTMLSpanElement>(null)
  const bestRef = useRef<HTMLSpanElement>(null)
  const recordRef = useRef(record)
  const deathsRef = useRef<HTMLSpanElement>(null)
  const moonRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const [scrolls, setScrolls] = useState(0)
  const [attempt, setAttempt] = useState(1)
  const [tip, setTip] = useState<IntroKind | null>(null)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const [hint, setHint] = useState(!coach)
  const [prompt, setPrompt] = useState<CoachPrompt>(null)
  /** Le chapitre du tutoriel affiché (et sa « visite » : la carte revient après une reprise). */
  const [chapter, setChapter] = useState<{ index: number; visit: number } | null>(null)
  const [turn, setTurn] = useState(portrait)
  const input = useRef({ press: false, hold: false })
  const elapsed = useRef(0)
  const callbacks = useRef({ onFinish, onQuit, onRestart })
  useEffect(() => {
    callbacks.current = { onFinish, onQuit, onRestart }
  })
  useEffect(() => {
    pausedRef.current = paused
    if (paused) input.current = { press: false, hold: false }
  }, [paused])

  const world = useMemo(() => buildWorld(level), [level])

  useEffect(() => {
    if (!tip) return
    const timer = window.setTimeout(() => setTip(null), TIP_MS)
    return () => window.clearTimeout(timer)
  }, [tip])

  const result = (completed: boolean) => resultOf(world, sceneRef.current, elapsed.current, completed)

  // Pause d'elle-même : notification, app en arrière-plan, fenêtre quittée.
  const notified = useNotificationStore((state) => state.banners.length > 0)
  useEffect(() => {
    if (notified && sceneRef.current?.run.status === 'running') setPaused(true)
  }, [notified])
  useEffect(() => {
    const pause = () => {
      if (sceneRef.current?.run.status === 'running') setPaused(true)
    }
    const onHidden = () => document.visibilityState === 'hidden' && pause()
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('blur', pause)
    const onResize = () => setTurn((current) => current && portrait())
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('blur', pause)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // Clavier : Espace, Entrée, flèches haut/bas (ou W/S, Z/S) ; Échap met en pause.
  useEffect(() => {
    const keys = new Set(['Space', 'Enter', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'KeyZ'])
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPaused((value) => !value)
        return
      }
      if (!keys.has(event.code) || pausedRef.current) return
      event.preventDefault()
      if (!event.repeat) input.current.press = true
      input.current.hold = true
    }
    const up = (event: KeyboardEvent) => {
      if (keys.has(event.code)) input.current.hold = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // La boucle : simulation au pas fixe, rendu à chaque image.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const scene = new GravityScene(world)
    if (solution) scene.playSolution(solution)
    sceneRef.current = scene
    let frame = 0
    let last = performance.now()
    let accumulator = 0
    let deadFor = 0
    let finishedFor = -1
    let shownPercent = -1
    let shownBest = -1
    // Chaque élément particulier s'explique une fois par partie, un peu avant d'entrer dans l'écran
    // (le tutoriel a ses propres cartes, plus complètes).
    const intros = chapters ? [] : introsOf(world)
    let nextIntro = 0
    let shownDeaths = -1
    let shownScrolls = 0
    // Tutoriel : la prochaine fenêtre où toucher, un toucher maintenu en cours (lune), le ralenti.
    const coached = coach && !solution ? coach : null
    let cueIndex = 0
    let holdingCue = false
    let shownPrompt: CoachPrompt = null
    let timeScale = 1
    // Tutoriel : le prochain chapitre à annoncer, et le temps de lecture (ralenti) qui reste.
    let nextChapter = 0
    let chapterVisit = 0
    let readingLeft = 0

    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(window.innerWidth * ratio)
      canvas.height = Math.round(window.innerHeight * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const run = scene.run
      // Au ralenti pendant une fenêtre du tutoriel : la simulation et les effets suivent le même temps.
      const gameDt = dt * timeScale
      if (!pausedRef.current) {
        if (run.status === 'running') elapsed.current += gameDt
        accumulator = Math.min(accumulator + gameDt, TICK * MAX_STEPS)
        while (accumulator >= TICK) {
          accumulator -= TICK
          if (run.status === 'dead') {
            deadFor += TICK
            if (deadFor >= RESPAWN_DELAY) {
              deadFor = 0
              // Tutoriel : reprise au début du chapitre où l'on est tombé (sa carte revient) ; sinon, au départ.
              let at = -1
              chapters?.forEach((item, index) => {
                if (item.checkpoint.x <= run.x) at = index
              })
              const checkpoint = at >= 0 ? chapters![at]!.checkpoint : undefined
              scene.restart(checkpoint)
              setAttempt(run.deaths + 1)
              const nextCue = checkpoint && coached ? coached.findIndex((cue) => cue.to >= checkpoint.tick) : 0
              cueIndex = nextCue < 0 ? (coached?.length ?? 0) : nextCue
              holdingCue = false
              if (chapters) nextChapter = Math.max(0, at)
            }
            continue
          }
          if (run.status === 'finished') {
            if (finishedFor < 0) finishedFor = 0
            continue
          }
          const pressed = input.current.press
          const tickBefore = run.tick
          const events = scene.step({ press: input.current.press, hold: input.current.hold })
          input.current.press = false
          if (coached) {
            // Un toucher dans la fenêtre la valide ; une fenêtre passée sans toucher est perdue.
            const cue = coached[cueIndex]
            if (cue && pressed && tickBefore >= cue.from && tickBefore <= cue.to) {
              cueIndex += 1
              holdingCue = cue.hold
            } else if (cue && tickBefore > cue.to) cueIndex += 1
            if (holdingCue && run.grounded && !pressed) holdingCue = false
          }
          for (const event of events) {
            switch (event.kind) {
              case 'flip':
              case 'pad':
                playGravityFlip(run.g === -1)
                vibrate(8)
                setHint(false)
                break
              case 'land':
                if (event.speed > 8) playGravityLand()
                break
              case 'scroll':
                playGravityScroll()
                vibrate([10, 30, 10])
                break
              case 'moon':
                playGravityMoon()
                vibrate(20)
                break
              case 'shrink':
              case 'grow':
                playGravitySize(event.kind === 'shrink')
                vibrate(12)
                break
              case 'log':
                playGravityLog()
                vibrate(15)
                break
              case 'substitute':
                playGravityPoof()
                vibrate([20, 30, 20])
                break
              case 'warp':
                playGravityWarp()
                vibrate(14)
                break
              case 'die':
                playGravityPoof()
                vibrate([30, 40, 60])
                break
              case 'finish':
                playGravityFinish()
                vibrate([20, 40, 20, 40, 80])
                break
              default:
                break
            }
          }
        }
        if (finishedFor >= 0) {
          finishedFor += dt
          if (finishedFor >= FINISH_DELAY) {
            finishedFor = -Infinity
            callbacks.current.onFinish(resultOf(world, scene, elapsed.current, true))
          }
        }
      }
      const layout = layoutFor(window.innerWidth, window.innerHeight)
      const ahead = run.cameraX + layout.width / layout.unit + world.speed * 0.4
      while (nextIntro < intros.length && intros[nextIntro]!.x <= ahead) {
        setTip(intros[nextIntro]!.kind)
        nextIntro += 1
      }
      // Tutoriel : la carte du chapitre qui approche (et un instant de ralenti pour la lire).
      let target = 1
      if (chapters && !pausedRef.current) {
        while (nextChapter < chapters.length && run.status === 'running' && run.x >= chapters[nextChapter]!.x - world.speed * CHAPTER_AHEAD) {
          chapterVisit += 1
          setChapter({ index: nextChapter, visit: chapterVisit })
          readingLeft = CHAPTER_SLOW.seconds
          nextChapter += 1
        }
        if (readingLeft > 0) {
          readingLeft -= dt
          target = CHAPTER_SLOW.scale
        }
      }
      // Tutoriel : l'invite et le ralenti (il commence un peu avant la fenêtre, et s'en va en douceur).
      if (coached) {
        const cue = coached[cueIndex]
        const running = run.status === 'running'
        const inWindow = running && cue !== undefined && run.tick >= cue.from && run.tick <= cue.to
        const next: CoachPrompt = inWindow ? (cue.hold ? 'hold' : 'press') : holdingCue && running ? 'holding' : null
        if (next !== shownPrompt) {
          shownPrompt = next
          setPrompt(next)
        }
        const slowing = running && cue !== undefined && run.tick >= cue.from - 6 && run.tick <= cue.to
        if (slowing) target = Math.min(target, Math.max(SLOWEST, Math.min(1, ((cue.to - cue.from + 1) * TICK) / COACH_REAL_SECONDS)))
      }
      if (coached || chapters) timeScale += (target - timeScale) * Math.min(1, dt * 14)
      scene.render(ctx, layout, pausedRef.current ? 1 : accumulator / TICK, pausedRef.current ? 0 : gameDt)

      // Interface : écrite directement dans le DOM, sans rendu React à chaque image.
      const percent = run.status === 'finished' ? 100 : progressOf(world, run.x)
      if (percent !== shownPercent) {
        shownPercent = percent
        if (progressRef.current) progressRef.current.style.width = `${percent}%`
        if (percentRef.current) percentRef.current.textContent = `${percent} %`
      }
      // Le meilleur avancement (enregistré, ou de cette partie) : un repère sur la barre.
      const best = Math.max(recordRef.current, progressOf(world, run.maxX))
      if (best !== shownBest) {
        shownBest = best
        if (bestRef.current) {
          bestRef.current.style.left = `${best}%`
          bestRef.current.style.opacity = best > 0 && best < 100 ? '1' : '0'
        }
      }
      if (run.deaths !== shownDeaths) {
        shownDeaths = run.deaths
        if (deathsRef.current) deathsRef.current.textContent = String(run.deaths)
      }
      const collected = scrollsIn(run.scrolls)
      if (collected !== shownScrolls) {
        shownScrolls = collected
        setScrolls(collected)
      }
      if (moonRef.current) {
        moonRef.current.style.opacity = run.moonLeft > 0 ? '1' : '0'
        moonRef.current.style.setProperty('--moon', String(run.moonLeft / MOON_SECONDS))
      }
      if (logRef.current) logRef.current.style.opacity = run.shield ? '1' : '0'
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [world, solution, coach, chapters])

  const onPointerDown = (event: ReactPointerEvent) => {
    if (paused || (event.target as HTMLElement).closest('button')) return
    input.current.press = true
    input.current.hold = true
  }
  const release = () => {
    input.current.hold = false
  }

  const quit = () => {
    setPaused(true)
    callbacks.current.onQuit(result(false))
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[95] touch-none overflow-hidden bg-black select-none [-webkit-touch-callout:none]"
      onPointerDown={onPointerDown}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      role="application"
      aria-label={t.gravity.game.aria(level.name)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />

      {/* Haut : quitter, pause, progression, rouleaux, chutes. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 px-3 pt-[max(0.6rem,env(safe-area-inset-top))]">
        <button type="button" onClick={quit} aria-label={t.gravity.game.quit} className="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/45 text-white/90">
          <X size={18} aria-hidden />
        </button>
        <button type="button" onClick={() => setPaused(true)} aria-label={t.gravity.game.pause} className="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/45 text-white/90">
          <Pause size={17} aria-hidden />
        </button>
        <div className="mx-1 mt-1 flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
            <span className="truncate">
              {(trial || solution || coach) && (
                <span className="mr-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] tracking-[0.14em] uppercase">{solution ? t.gravity.game.demo : coach ? t.gravity.game.tutorial : t.gravity.game.trial}</span>
              )}
              {level.name}
            </span>
            <span ref={percentRef} className="tabular-nums">
              0 %
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-black/45">
            <div ref={progressRef} className="h-full rounded-full" style={{ width: '0%', background: 'linear-gradient(90deg, #ffe08a, #ff8a6b 60%, #e3313f)' }} />
            <span ref={bestRef} aria-hidden className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-white opacity-0" />
          </div>
          {/* Un élément nouveau approche : son explication, en petit sous la barre (jamais devant le chemin). */}
          {tip && !paused && (
            <p key={tip} role="status" className="mt-0.5 line-clamp-2 animate-[gravity-banner_3.4s_ease-out_both] rounded-lg bg-black/55 px-2 py-1 text-[11px] leading-snug text-white/90">
              <span className="font-bold text-[#ffd66b]">{t.gravity.game.elements[tip].name}</span>
              <span className="text-white/50"> · </span>
              {t.gravity.game.elements[tip].text}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1.5 text-white/90" aria-label={t.gravity.game.scrolls(scrolls, world.scrollCount)}>
          {Array.from({ length: world.scrollCount }, (_, index) => (
            <ScrollText key={index} size={15} aria-hidden className={index < scrolls ? 'text-[#ffd66b]' : 'text-white/30'} />
          ))}
          <span className="mx-0.5 h-4 w-px bg-white/20" />
          <Skull size={14} aria-hidden className="text-white/70" />
          <span ref={deathsRef} className="text-xs font-bold tabular-nums">
            0
          </span>
        </div>
      </div>

      {/* Kawarimi : une bûche en réserve. */}
      <div ref={logRef} className="pointer-events-none absolute top-[max(4rem,calc(env(safe-area-inset-top)+3.4rem))] left-3 flex items-center gap-2 rounded-full bg-[#3a2414]/85 px-3 py-1.5 text-xs font-semibold text-[#ffe2b8] opacity-0 transition-opacity">
        <Shield size={14} aria-hidden />
        {t.gravity.game.logReady}
      </div>

      {/* La lune : le temps qui reste. */}
      <div ref={moonRef} className="pointer-events-none absolute top-[max(4rem,calc(env(safe-area-inset-top)+3.4rem))] right-3 flex items-center gap-2 rounded-full bg-[#1a2147]/80 px-3 py-1.5 text-xs font-semibold text-[#dfe6ff] opacity-0 transition-opacity">
        <Moon size={14} aria-hidden />
        <span>{t.gravity.game.moon}</span>
        <span className="font-medium text-[#dfe6ff]/75">{t.gravity.game.moonHold}</span>
        <span className="block h-1.5 w-14 overflow-hidden rounded-full bg-white/15">
          <span className="block h-full origin-left rounded-full bg-[#cfd8ff]" style={{ transform: 'scaleX(var(--moon, 0))' }} />
        </span>
      </div>

      {/* Tutoriel : la carte du chapitre qui arrive (elle revient après une reprise). */}
      {chapters && chapter && !paused && <ChapterCard key={`${chapter.index}-${chapter.visit}`} chapter={chapters[chapter.index]!} />}

      {!paused && !solution && !chapters && (
        <p
          key={attempt}
          className="pointer-events-none absolute inset-x-0 top-[max(4.5rem,calc(env(safe-area-inset-top)+4rem))] animate-[gravity-banner_1.6s_ease-out_both] text-center font-display text-3xl text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.7)]"
        >
          {t.gravity.game.attempt(attempt)}
        </p>
      )}

      {/* Tutoriel : quand toucher (et maintenir), au ralenti. */}
      {prompt && !paused && (
        <div role="status" className="pointer-events-none absolute inset-x-0 bottom-[max(1.75rem,calc(env(safe-area-inset-bottom)+1rem))] flex flex-col items-center gap-2">
          <span
            className={`grid size-16 place-items-center rounded-full bg-white text-void shadow-[0_0_0_10px_rgba(255,255,255,0.18)] ${prompt === 'holding' ? '' : 'motion-safe:animate-[gravity-tap_0.7s_ease-out_infinite]'}`}
          >
            {prompt === 'press' ? <Pointer size={30} aria-hidden /> : <Hand size={30} aria-hidden />}
          </span>
          <span className="rounded-full bg-black/65 px-4 py-1.5 font-display text-xl text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.6)]">{t.gravity.tutorial.coach[prompt]}</span>
        </div>
      )}

      {hint && !paused && !solution && (
        <p className="pointer-events-none absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] animate-pulse text-center text-sm font-semibold text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.8)]">
          {t.gravity.game.hint}
        </p>
      )}

      {turn && !paused && (
        <button
          type="button"
          onClick={() => setTurn(false)}
          className="pointer-events-auto absolute inset-x-6 bottom-[max(4rem,calc(env(safe-area-inset-bottom)+3rem))] flex items-center justify-center gap-2 rounded-2xl bg-black/65 px-4 py-3 text-xs text-white/90"
        >
          <Smartphone size={16} className="rotate-90" aria-hidden />
          {t.gravity.game.rotate}
        </button>
      )}

      {paused && (
        <div className="absolute inset-0 grid place-items-center bg-black/60 px-6" role="dialog" aria-modal="true" aria-label={t.gravity.game.paused}>
          <div className="flex w-full max-w-xs flex-col gap-2 rounded-[1.5rem] border border-white/10 bg-[#140d24]/95 p-5 text-center">
            <p className="font-display text-2xl text-cream">{t.gravity.game.paused}</p>
            <div className="flex justify-center">
              <SfxVolume />
            </div>
            <button type="button" onClick={() => setPaused(false)} className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-cream text-sm font-bold text-void">
              <Play size={16} className="fill-void" aria-hidden />
              {t.gravity.game.resume}
            </button>
            <button
              type="button"
              onClick={() => {
                setPaused(false)
                callbacks.current.onRestart(result(false))
              }}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/15 text-sm font-semibold text-cream"
            >
              <RotateCcw size={15} aria-hidden />
              {t.gravity.game.restart}
            </button>
            <button type="button" onClick={quit} className="h-11 rounded-full text-sm font-semibold text-cream/70">
              {t.gravity.game.quit}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

/**
 * La carte d'un chapitre du tutoriel, en haut de l'écran (jamais devant le chemin du ninja) : elle
 * glisse, reste le temps de la lire, puis s'efface d'elle-même.
 */
function ChapterCard({ chapter }: { chapter: GameChapter }) {
  const Icon = chapter.icon
  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 top-[max(3.9rem,calc(env(safe-area-inset-top)+3.4rem))] flex justify-center px-4">
      <div className="flex w-full max-w-md items-start gap-3 rounded-2xl border border-[#ffb84d]/40 bg-[#120a1f]/90 px-3.5 py-3 text-left shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)] motion-safe:animate-[gravity-chapter_7s_ease-out_both]">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ffb84d] text-void">
          <Icon size={18} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block font-display text-lg leading-tight text-white">{chapter.title}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-white/85">{chapter.text}</span>
        </span>
      </div>
    </div>
  )
}
