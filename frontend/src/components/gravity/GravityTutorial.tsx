import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUpDown,
  Asterisk,
  BrickWall,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Flame,
  Ghost,
  GraduationCap,
  Hand,
  Hourglass,
  Layers,
  Minimize2,
  Moon,
  MoveVertical,
  Play,
  Pointer,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Shield,
  Triangle,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useT } from '../../i18n'
import { TICK } from '../../lib/gravity/constants'
import { buildWorld } from '../../lib/gravity/engine'
import { readTutorial, writeTutorial, type Lesson, type LessonId } from '../../lib/gravity/tutorial'
import { LESSONS } from '../../lib/gravity/tutorial.lessons'
import { vibrate } from '../../lib/haptics'
import { playChime } from '../../lib/sfx'
import { GravityGame } from './GravityGame'
import { enterLandscape, leaveLandscape } from './landscape'
import { GravityScene, layoutFor } from './scene/GravityScene'

/** L'icône de chaque leçon, dans la liste. */
const ICONS: Record<LessonId, LucideIcon> = {
  flip: ArrowUpDown,
  edges: BrickWall,
  spikes: Triangle,
  islands: Layers,
  seal: RefreshCw,
  crumble: Hourglass,
  mover: MoveVertical,
  shuriken: Asterisk,
  moon: Moon,
  mini: Minimize2,
  log: Shield,
  scrolls: ScrollText,
  warp: Zap,
  flames: Flame,
  ghost: Ghost,
  orbit: CircleDashed,
}

type Screen = { kind: 'list' } | { kind: 'card'; index: number } | { kind: 'play'; index: number; key: number } | { kind: 'success'; index: number } | { kind: 'complete' }

/**
 * Le tutoriel de Gravity Ninja : la liste des leçons (une par mécanisme, cochées une fois réussies),
 * la fiche d'une leçon (ce que fait le mécanisme, comment s'en servir, et une démonstration animée),
 * la leçon jouée (le jeu ralentit et dit quand toucher), puis le bravo. Relançable à tout moment depuis
 * l'accueil du mode ; rien n'est enregistré sur le serveur, la progression reste sur l'appareil.
 */
export function GravityTutorial({ onClose, onPlayLevels }: { onClose: () => void; onPlayLevels: () => void }) {
  const t = useT()
  const tt = t.gravity.tutorial
  const [done, setDone] = useState<LessonId[]>(() => readTutorial().done)
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const total = LESSONS.length
  const resumeAt = Math.max(0, LESSONS.findIndex((lesson) => !done.includes(lesson.id)))

  const open = (index: number) => {
    vibrate(8)
    setScreen({ kind: 'card', index })
  }
  const play = (index: number) => {
    vibrate(10)
    enterLandscape()
    setScreen((current) => ({ kind: 'play', index, key: current.kind === 'play' ? current.key + 1 : 1 }))
  }
  const succeed = (lesson: Lesson, index: number) => {
    leaveLandscape()
    playChime()
    const next = done.includes(lesson.id) ? done : [...done, lesson.id]
    setDone(next)
    writeTutorial({ ...readTutorial(), offered: true, done: next })
    setScreen({ kind: 'success', index })
  }

  if (screen.kind === 'play') {
    const lesson = LESSONS[screen.index]!
    return (
      <LessonGame
        key={screen.key}
        lesson={lesson}
        title={tt.lessons[lesson.id].title}
        onFinish={() => succeed(lesson, screen.index)}
        onQuit={() => {
          leaveLandscape()
          setScreen({ kind: 'card', index: screen.index })
        }}
        onRestart={() => play(screen.index)}
      />
    )
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={tt.title} className="fixed inset-0 z-[96] overflow-y-auto bg-[#0d0818] text-cream">
      <div className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {screen.kind === 'list' && (
          <>
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#ffb84d]/15 text-[#ffb84d]">
                <GraduationCap size={22} aria-hidden />
              </span>
              <h2 className="flex-1 font-display text-3xl leading-none">{tt.title}</h2>
              <button type="button" onClick={onClose} aria-label={tt.close} className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.06]">
                <X size={18} aria-hidden />
              </button>
            </div>
            <p className="text-sm leading-relaxed text-cream/70">{tt.subtitle}</p>
            <div className="flex items-center gap-3">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                <span className="block h-full rounded-full bg-[#ffb84d]" style={{ width: `${(done.length / total) * 100}%` }} />
              </span>
              <span className="text-xs text-cream/60 tabular-nums">{tt.progress(done.length, total)}</span>
            </div>
            <button
              type="button"
              onClick={() => open(resumeAt)}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[#ffb84d] font-display text-xl text-void shadow-[0_4px_0_#b8642f] transition-transform active:translate-y-1 active:shadow-none"
            >
              <Play size={20} className="fill-void" aria-hidden />
              {done.length === 0 ? tt.start : tt.resume}
            </button>
            <ol className="flex flex-col gap-2">
              {LESSONS.map((lesson, index) => {
                const Icon = ICONS[lesson.id]
                const cleared = done.includes(lesson.id)
                return (
                  <li key={lesson.id}>
                    <button type="button" onClick={() => open(index)} className="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.06]">
                      <span className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums ${cleared ? 'bg-[#3fe0a0] text-void' : 'bg-white/[0.08] text-cream/70'}`}>
                        {cleared ? <Check size={16} strokeWidth={3} aria-hidden /> : index + 1}
                      </span>
                      <Icon size={18} className="shrink-0 text-[#ffb84d]" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tt.lessons[lesson.id].title}</span>
                      <ChevronRight size={16} className="shrink-0 text-cream/40" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ol>
          </>
        )}

        {screen.kind === 'card' && (
          <LessonCard
            lesson={LESSONS[screen.index]!}
            rank={screen.index + 1}
            total={total}
            onBack={() => setScreen({ kind: 'list' })}
            onClose={onClose}
            onTry={() => play(screen.index)}
          />
        )}

        {screen.kind === 'success' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
            <span className="grid size-20 place-items-center rounded-full bg-[#3fe0a0] text-void shadow-[0_0_50px_-8px_#3fe0a0]">
              <Check size={40} strokeWidth={3} aria-hidden />
            </span>
            <h2 className="font-display text-3xl leading-none">{tt.success}</h2>
            <p className="text-sm text-cream/70">{tt.successText(tt.lessons[LESSONS[screen.index]!.id].title)}</p>
            <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
              <button
                type="button"
                onClick={() => (screen.index + 1 < total ? open(screen.index + 1) : setScreen({ kind: 'complete' }))}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#ffb84d] text-sm font-bold text-void"
              >
                <ChevronRight size={17} aria-hidden />
                {screen.index + 1 < total ? tt.next : tt.completeTitle}
              </button>
              <button type="button" onClick={() => play(screen.index)} className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold">
                <RotateCcw size={16} aria-hidden />
                {tt.replay}
              </button>
              <button type="button" onClick={() => setScreen({ kind: 'list' })} className="h-11 rounded-full text-sm font-semibold text-cream/70">
                {tt.all}
              </button>
            </div>
          </div>
        )}

        {screen.kind === 'complete' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
            <span className="grid size-20 place-items-center rounded-full bg-[#ffb84d] text-void shadow-[0_0_50px_-8px_#ffb84d]">
              <GraduationCap size={40} aria-hidden />
            </span>
            <h2 className="font-display text-3xl leading-none">{tt.completeTitle}</h2>
            <p className="max-w-sm text-sm leading-relaxed text-cream/70">{tt.completeText}</p>
            <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
              <button type="button" onClick={onPlayLevels} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#ffb84d] text-sm font-bold text-void">
                <Play size={16} className="fill-void" aria-hidden />
                {tt.play}
              </button>
              <button type="button" onClick={() => setScreen({ kind: 'list' })} className="h-11 rounded-full text-sm font-semibold text-cream/70">
                {tt.all}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** La fiche d'une leçon : ce que fait le mécanisme, comment s'en servir, et sa démonstration. */
function LessonCard({ lesson, rank, total, onBack, onClose, onTry }: { lesson: Lesson; rank: number; total: number; onBack: () => void; onClose: () => void; onTry: () => void }) {
  const t = useT()
  const tt = t.gravity.tutorial
  const copy = tt.lessons[lesson.id]
  const Icon = ICONS[lesson.id]
  return (
    <>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label={tt.all} className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.06]">
          <ChevronLeft size={20} aria-hidden />
        </button>
        <span className="flex-1 text-xs font-semibold tracking-[0.16em] text-cream/55 uppercase">{tt.lesson(rank, total)}</span>
        <button type="button" onClick={onClose} aria-label={tt.close} className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.06]">
          <X size={18} aria-hidden />
        </button>
      </div>
      <h2 className="flex items-center gap-2.5 font-display text-[1.9rem] leading-tight">
        <Icon size={24} className="shrink-0 text-[#ffb84d]" aria-hidden />
        {copy.title}
      </h2>
      <LessonPreview lesson={lesson} />
      <p className="text-[0.95rem] leading-relaxed text-cream/80">{copy.text}</p>
      {lesson.id === 'flip' && <p className="rounded-2xl bg-white/[0.04] px-3 py-2 text-xs text-cream/60">{tt.controls}</p>}
      <button
        type="button"
        onClick={onTry}
        className="mt-auto inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[#ffb84d] font-display text-xl text-void shadow-[0_4px_0_#b8642f] transition-transform active:translate-y-1 active:shadow-none"
      >
        <Play size={20} className="fill-void" aria-hidden />
        {tt.try}
      </button>
    </>
  )
}

/**
 * La démonstration d'une leçon, en boucle : le ninja la réussit tout seul (le chemin du tutoriel) ; un
 * doigt s'allume à chaque toucher, une main tant qu'il faut maintenir. Animée seulement à l'écran.
 */
function LessonPreview({ lesson }: { lesson: Lesson }) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tapRef = useRef<HTMLSpanElement>(null)
  const holdRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const scene = new GravityScene(buildWorld(lesson.level))
    scene.playSolution({ decisions: lesson.demo })
    const fit = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(canvas.clientWidth * ratio)
      canvas.height = Math.round(canvas.clientHeight * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(canvas)
    let frame = 0
    let last = performance.now()
    let accumulator = 0
    let over = 0
    let holding = false
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (scene.run.status !== 'running') {
        // La fin (ou une chute) : un temps, puis la démonstration recommence.
        over += dt
        if (over > 0.9) {
          over = 0
          scene.restart()
        }
      } else {
        accumulator = Math.min(accumulator + dt, TICK * 8)
        while (accumulator >= TICK && scene.run.status === 'running') {
          accumulator -= TICK
          for (const event of scene.step({ press: false, hold: false })) {
            if (event.kind === 'flip') tapRef.current?.animate([{ opacity: 1, transform: 'scale(0.7)' }, { opacity: 0, transform: 'scale(1.35)' }], { duration: 520, easing: 'ease-out' })
          }
        }
      }
      if (scene.run.lunar !== holding) {
        holding = scene.run.lunar
        if (holdRef.current) holdRef.current.style.opacity = holding ? '1' : '0'
      }
      scene.render(ctx, layoutFor(canvas.clientWidth, canvas.clientHeight), accumulator / TICK, dt)
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [lesson])

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[1.25rem] border border-white/10 bg-black">
      <canvas ref={canvasRef} className="absolute inset-0 block size-full" aria-hidden />
      <span className="absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold tracking-[0.14em] text-white/85 uppercase">{t.gravity.tutorial.demo}</span>
      <span ref={tapRef} aria-hidden className="absolute right-3 bottom-3 grid size-11 place-items-center rounded-full bg-white text-void opacity-0">
        <Pointer size={22} />
      </span>
      <span ref={holdRef} aria-hidden className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-bold text-void opacity-0 transition-opacity">
        <Hand size={16} />
        {t.gravity.tutorial.coach.holding}
      </span>
    </div>
  )
}

/** Une leçon jouée : le jeu, guidé (ralenti et invites), avec le titre de la leçon. */
function LessonGame({ lesson, title, onFinish, onQuit, onRestart }: { lesson: Lesson; title: string; onFinish: () => void; onQuit: () => void; onRestart: () => void }) {
  const level = useMemo(() => ({ ...lesson.level, name: title }), [lesson, title])
  return <GravityGame level={level} coach={lesson.cues} onFinish={onFinish} onQuit={onQuit} onRestart={onRestart} />
}
