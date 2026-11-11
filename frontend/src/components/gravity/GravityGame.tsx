import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Moon, Pause, Play, RotateCcw, ScrollText, Skull, Smartphone, X } from 'lucide-react'
import { useT } from '../../i18n'
import { MOON_SECONDS, TICK } from '../../lib/gravity/constants'
import { buildWorld, progressOf, scrollsIn, type GravityWorld } from '../../lib/gravity/engine'
import type { SolveReport } from '../../lib/gravity/solver'
import type { GravityLevel } from '../../lib/gravity/types'
import { vibrate } from '../../lib/haptics'
import { playGravityCheckpoint, playGravityFinish, playGravityFlip, playGravityLand, playGravityMoon, playGravityPoof, playGravityScroll } from '../../lib/sfx'
import { useNotificationStore } from '../../store/useNotificationStore'
import { SfxVolume } from '../ui/SfxVolume'
import { GravityScene, layoutFor } from './scene/GravityScene'

/** Après une chute, le temps de voir la fumée avant de repartir (s). */
const RESPAWN_DELAY = 0.75
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
}

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
 * fait planer. Une chute renvoie au dernier point de reprise.
 */
export function GravityGame({ level, onFinish, onQuit, onRestart, trial = false, solution = null }: GravityGameProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<GravityScene | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const percentRef = useRef<HTMLSpanElement>(null)
  const deathsRef = useRef<HTMLSpanElement>(null)
  const moonRef = useRef<HTMLDivElement>(null)
  const [scrolls, setScrolls] = useState(0)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const [hint, setHint] = useState(true)
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
  const checkpoints = world.checkpoints.map((checkpoint) => progressOf(world, checkpoint.x))

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
    let shownDeaths = -1
    let shownScrolls = 0

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
      if (!pausedRef.current) {
        if (run.status === 'running') elapsed.current += dt
        accumulator = Math.min(accumulator + dt, TICK * MAX_STEPS)
        while (accumulator >= TICK) {
          accumulator -= TICK
          if (run.status === 'dead') {
            deadFor += TICK
            if (deadFor >= RESPAWN_DELAY) {
              deadFor = 0
              scene.respawn()
            }
            continue
          }
          if (run.status === 'finished') {
            if (finishedFor < 0) finishedFor = 0
            continue
          }
          const events = scene.step({ press: input.current.press, hold: input.current.hold })
          input.current.press = false
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
              case 'checkpoint':
                playGravityCheckpoint()
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
      scene.render(ctx, layout, pausedRef.current ? 1 : accumulator / TICK, pausedRef.current ? 0 : dt)

      // Interface : écrite directement dans le DOM, sans rendu React à chaque image.
      const percent = run.status === 'finished' ? 100 : progressOf(world, run.x)
      if (percent !== shownPercent) {
        shownPercent = percent
        if (progressRef.current) progressRef.current.style.width = `${percent}%`
        if (percentRef.current) percentRef.current.textContent = `${percent} %`
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
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [world, solution])

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
        <button type="button" onClick={quit} aria-label={t.gravity.game.quit} className="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/45 text-white/90 backdrop-blur-sm">
          <X size={18} aria-hidden />
        </button>
        <button type="button" onClick={() => setPaused(true)} aria-label={t.gravity.game.pause} className="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/45 text-white/90">
          <Pause size={17} aria-hidden />
        </button>
        <div className="mx-1 mt-1 flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
            <span className="truncate">
              {(trial || solution) && <span className="mr-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] tracking-[0.14em] uppercase">{solution ? t.gravity.game.demo : t.gravity.game.trial}</span>}
              {level.name}
            </span>
            <span ref={percentRef} className="tabular-nums">
              0 %
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-black/45">
            <div ref={progressRef} className="h-full rounded-full" style={{ width: '0%', background: 'linear-gradient(90deg, #ffe08a, #ff8a6b 60%, #e3313f)' }} />
            {checkpoints.map((percent, index) => (
              <span key={index} aria-hidden className="absolute top-0 h-full w-0.5 bg-white/70" style={{ left: `${percent}%` }} />
            ))}
          </div>
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

      {/* La lune : le temps qui reste. */}
      <div ref={moonRef} className="pointer-events-none absolute top-[max(4rem,calc(env(safe-area-inset-top)+3.4rem))] right-3 flex items-center gap-2 rounded-full bg-[#1a2147]/80 px-3 py-1.5 text-xs font-semibold text-[#dfe6ff] opacity-0 transition-opacity">
        <Moon size={14} aria-hidden />
        {t.gravity.game.moon}
        <span className="block h-1.5 w-14 overflow-hidden rounded-full bg-white/15">
          <span className="block h-full origin-left rounded-full bg-[#cfd8ff]" style={{ transform: 'scaleX(var(--moon, 0))' }} />
        </span>
      </div>

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
