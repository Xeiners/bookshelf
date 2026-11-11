import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, ChevronDown, Gamepad2, Home, Loader2, Play, RotateCcw, ScrollText, ShieldCheck, Skull, SkipForward, Timer, Trash2, Wand2 } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { formatTime } from '../../lib/gravity/format'
import { THEMES } from '../../lib/gravity/themes'
import type { SolveReport } from '../../lib/gravity/solver'
import type { GravityLevel } from '../../lib/gravity/types'
import { gravityApi, type GravityLevelSummary, type GravityOverview, type GravityProgress } from '../../services/gravityApi'
import { useUiStore } from '../../store/useUiStore'
import { DleBar } from '../dle/DleBar'
import { GravityEmblem } from './GravityEmblem'
import { GravityGame, type GravityRunResult } from './GravityGame'
import { GravityWorkshop } from './GravityWorkshop'

interface Session {
  key: number
  level: GravityLevel
  /** Essai depuis l'atelier : rien n'est enregistré. */
  trial: boolean
  /** Démonstration du solveur. */
  solution?: SolveReport
}

/**
 * Sur téléphone, le jeu se joue mieux en paysage : plein écran et orientation verrouillée quand le
 * navigateur le permet (Android), sans effet ailleurs. Appelé dans le geste qui lance le niveau.
 */
function enterLandscape(): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return
  const root = document.documentElement
  const lock = () => {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> }
    void orientation.lock?.('landscape').catch(() => undefined)
  }
  if (!document.fullscreenElement && root.requestFullscreen) void root.requestFullscreen().then(lock).catch(() => undefined)
  else lock()
}

function leaveLandscape(): void {
  try {
    screen.orientation.unlock?.()
  } catch {
    // Rien à déverrouiller.
  }
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
}

/**
 * Gravity Ninja : les niveaux (avancement de 0 à 100 %, rouleaux, meilleur temps), la partie en
 * plein écran et son bilan ; l'atelier des niveaux pour les admins. Le mode est pour l'instant
 * réservé aux administrateurs (le serveur répond 404 aux autres).
 */
export function GravityView() {
  const t = useT()
  const openActivity = useUiStore((state) => state.openActivity)
  const notify = useUiStore((state) => state.notify)
  const [overview, setOverview] = useState<GravityOverview | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [result, setResult] = useState<{ run: GravityRunResult; progress: GravityProgress | null } | null>(null)
  const [workshop, setWorkshop] = useState(false)

  const refresh = useCallback(() => {
    gravityApi
      .overview()
      .then((next) => {
        setOverview(next)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [])
  useEffect(refresh, [refresh])

  const play = async (summary: GravityLevelSummary) => {
    if (loading) return
    vibrate(10)
    enterLandscape()
    setLoading(summary.id)
    try {
      const { level } = await gravityApi.level(summary.id)
      setResult(null)
      setSession((current) => ({ key: (current?.key ?? 0) + 1, level, trial: false }))
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setLoading(null)
    }
  }

  const tryLevel = (level: GravityLevel, solution?: SolveReport) => {
    enterLandscape()
    setResult(null)
    setSession((current) => ({ key: (current?.key ?? 0) + 1, level, trial: true, solution }))
  }

  /** Enregistre une partie (sauf un essai) ; la progression revient du serveur. */
  const record = async (level: GravityLevel, run: GravityRunResult, trial: boolean): Promise<GravityProgress | null> => {
    if (trial || (run.percent === 0 && !run.completed)) return null
    try {
      const { progress } = await gravityApi.run(level.id, run)
      setOverview((current) => (current ? { ...current, progress: { ...current.progress, [level.id]: progress } } : current))
      return progress
    } catch {
      return null
    }
  }

  const close = () => {
    setSession(null)
    setResult(null)
    leaveLandscape()
  }

  const onFinish = (run: GravityRunResult) => {
    if (!session) return
    setResult({ run, progress: null })
    void record(session.level, run, session.trial).then((progress) => setResult({ run, progress }))
  }

  const onQuit = (run: GravityRunResult) => {
    if (session) void record(session.level, run, session.trial)
    close()
  }

  const onRestart = (run: GravityRunResult) => {
    if (!session) return
    void record(session.level, run, session.trial)
    setResult(null)
    setSession({ ...session, key: session.key + 1 })
  }

  const levels = overview?.levels ?? []
  const index = session ? levels.findIndex((level) => level.id === session.level.id) : -1
  const next = !session?.trial && index >= 0 ? levels[index + 1] : undefined

  const remove = async (summary: GravityLevelSummary) => {
    if (!window.confirm(t.gravity.home.confirmDelete(summary.name))) return
    try {
      await gravityApi.remove(summary.id)
      refresh()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DleBar label={t.activities.back} onBack={() => openActivity('hub')} />
      <GravityHome overview={overview} failed={failed} loading={loading} onPlay={(level) => void play(level)} onWorkshop={() => setWorkshop(true)} onDelete={(level) => void remove(level)} onRetry={refresh} />

      {workshop && <GravityWorkshop ai={overview?.ai ?? []} onClose={() => setWorkshop(false)} onTry={tryLevel} onSaved={refresh} />}

      {session && (
        <>
          <GravityGame key={session.key} level={session.level} trial={session.trial} solution={session.solution} onFinish={onFinish} onQuit={onQuit} onRestart={onRestart} />
          {result &&
            createPortal(
              <LevelComplete
                level={session.level}
                result={result}
                trial={session.trial}
                onNext={next ? () => void play(next) : undefined}
                onReplay={() => {
                  setResult(null)
                  setSession({ ...session, key: session.key + 1 })
                }}
                onHome={close}
              />,
              document.body,
            )}
        </>
      )}
    </div>
  )
}

function GravityHome({
  overview,
  failed,
  loading,
  onPlay,
  onWorkshop,
  onDelete,
  onRetry,
}: {
  overview: GravityOverview | null
  failed: boolean
  loading: string | null
  onPlay: (level: GravityLevelSummary) => void
  onWorkshop: () => void
  onDelete: (level: GravityLevelSummary) => void
  onRetry: () => void
}) {
  const t = useT()
  const g = t.gravity.home
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      gsap.fromTo('[data-gravity-in]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.05, ease: EASE.glide })
    },
    { scope: ref, dependencies: [overview === null] },
  )
  const levels = overview?.levels ?? []
  const done = levels.filter((level) => overview?.progress[level.id]?.completed).length

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-28">
      <section data-gravity-in className="relative shrink-0 overflow-hidden rounded-[1.75rem] border border-[#ff8a6b]/30 bg-[#170c26]">
        <div className="relative h-48 overflow-hidden">
          <GravityEmblem className="absolute inset-0 block size-full" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#170c26] via-transparent to-transparent" />
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-[#ffd2b8] uppercase">
            <ShieldCheck size={12} aria-hidden />
            {g.adminOnly}
          </span>
          <div className="absolute inset-x-0 bottom-0 p-4">
            <h2 className="font-display text-[1.8rem] leading-none text-white [text-shadow:0_2px_0_#1a1030]">{t.gravity.title}</h2>
            <p className="mt-1 max-w-[18rem] text-xs leading-snug text-white/85">{g.tagline}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-cream/65">
          <span>{overview ? g.completed(done, levels.length) : '—'}</span>
          <button type="button" onClick={onWorkshop} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#ff8a6b]/15 px-3 text-xs font-semibold text-[#ffb69c]">
            <Wand2 size={14} aria-hidden />
            {g.workshop}
          </button>
        </div>
      </section>

      {!overview && !failed && (
        <div className="grid place-items-center py-10">
          <Loader2 size={24} className="animate-spin text-[#ff8a6b]" aria-hidden />
        </div>
      )}
      {failed && (
        <button type="button" onClick={onRetry} className="rounded-2xl bg-white/[0.05] p-4 text-sm text-cream/70">
          {g.failed}
        </button>
      )}

      <ol className="flex shrink-0 flex-col gap-2.5">
        {levels.map((level, index) => (
          <LevelCard key={level.id} level={level} rank={index + 1} progress={overview?.progress[level.id] ?? null} loading={loading === level.id} onPlay={() => onPlay(level)} onDelete={level.builtin ? undefined : () => onDelete(level)} />
        ))}
      </ol>

      <details data-gravity-in className="group shrink-0 rounded-[1.5rem] border border-white/8 bg-white/[0.03]">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">
          <Gamepad2 size={14} aria-hidden />
          <span className="flex-1">{g.howTo}</span>
          <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="flex flex-col gap-2 px-4 pb-4 text-sm text-cream/75">
          {g.rules.map((rule) => (
            <p key={rule}>{rule}</p>
          ))}
        </div>
      </details>
    </div>
  )
}

function LevelCard({ level, rank, progress, loading, onPlay, onDelete }: { level: GravityLevelSummary; rank: number; progress: GravityProgress | null; loading: boolean; onPlay: () => void; onDelete?: () => void }) {
  const t = useT()
  const g = t.gravity.home
  const theme = THEMES[level.theme] ?? THEMES.konoha
  const percent = progress?.bestPercent ?? 0
  return (
    <li data-gravity-in className="relative overflow-hidden rounded-[1.4rem] border border-white/8" style={{ background: `linear-gradient(115deg, ${theme.sky[0]} 0%, ${theme.near} 70%)` }}>
      <button type="button" onClick={onPlay} disabled={loading} className="flex w-full items-center gap-3 p-3.5 text-left">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl font-display text-xl text-void" style={{ background: `linear-gradient(135deg, ${theme.sky[2]}, ${theme.accent})` }}>
          {progress?.completed ? <CheckCircle2 size={22} aria-hidden /> : rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-lg leading-tight text-cream">{level.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-cream/60">
            <span>{t.gravity.themes[level.theme] ?? level.theme}</span>
            <Difficulty value={level.difficulty} color={theme.accent} />
            {!level.builtin && <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-semibold">{g.custom}</span>}
          </span>
          <span className="mt-2 flex items-center gap-2">
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-black/40">
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${percent}%`, background: `linear-gradient(90deg, ${theme.sky[2]}, ${theme.accent})` }} />
            </span>
            <span className="w-9 text-right text-[11px] font-bold text-cream tabular-nums">{percent} %</span>
          </span>
          {progress?.completed && (
            <span className="mt-1.5 flex items-center gap-3 text-[11px] text-cream/65 tabular-nums">
              <span className="inline-flex items-center gap-1">
                {Array.from({ length: level.scrolls }, (_, index) => (
                  <ScrollText key={index} size={12} aria-hidden className={index < progress.scrolls ? 'text-[#ffd66b]' : 'text-white/25'} />
                ))}
              </span>
              {progress.bestTimeMs !== null && (
                <span className="inline-flex items-center gap-1">
                  <Timer size={12} aria-hidden />
                  {formatTime(progress.bestTimeMs)}
                </span>
              )}
              {progress.fewestDeaths !== null && (
                <span className="inline-flex items-center gap-1">
                  <Skull size={12} aria-hidden />
                  {progress.fewestDeaths}
                </span>
              )}
            </span>
          )}
        </span>
        {loading ? <Loader2 size={20} className="shrink-0 animate-spin text-cream/80" aria-hidden /> : <Play size={20} className="shrink-0 fill-cream/90 text-cream/90" aria-hidden />}
      </button>
      {onDelete && (
        <button type="button" onClick={onDelete} aria-label={g.delete(level.name)} className="absolute right-12 bottom-2 grid size-8 place-items-center rounded-full text-cream/40 hover:text-nope">
          <Trash2 size={14} aria-hidden />
        </button>
      )}
    </li>
  )
}

/** Difficulté sur dix : des pastilles. */
function Difficulty({ value, color }: { value: number; color: string }) {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={t.gravity.home.difficulty(value)} role="img">
      {Array.from({ length: 10 }, (_, index) => (
        <span key={index} className="h-1.5 w-1.5 rounded-full" style={{ background: index < value ? color : 'rgba(255,255,255,0.18)' }} />
      ))}
    </span>
  )
}

/** Le bilan d'un niveau fini, par-dessus la scène figée. */
function LevelComplete({
  level,
  result,
  trial,
  onNext,
  onReplay,
  onHome,
}: {
  level: GravityLevel
  result: { run: GravityRunResult; progress: GravityProgress | null }
  trial: boolean
  onNext?: () => void
  onReplay: () => void
  onHome: () => void
}) {
  const t = useT()
  const r = t.gravity.result
  const ref = useRef<HTMLDivElement>(null)
  const theme = THEMES[level.theme] ?? THEMES.konoha
  const { run, progress } = result
  const scrollCount = level.elements.filter((element) => element.type === 'scroll').length
  const best = progress?.bestTimeMs !== null && progress?.bestTimeMs === run.timeMs
  useGSAP(
    () => {
      gsap.fromTo('[data-result-card]', { y: 40, scale: 0.92, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.5, ease: EASE.spring })
      gsap.fromTo('[data-result-scroll]', { scale: 0, rotation: -40 }, { scale: 1, rotation: 0, duration: 0.5, delay: 0.35, stagger: 0.12, ease: EASE.spring })
    },
    { scope: ref },
  )
  return (
    <div ref={ref} className="fixed inset-0 z-[97] grid place-items-center bg-black/55 px-5" role="dialog" aria-modal="true" aria-label={r.title}>
      <div data-result-card className="relative w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-white/12 bg-[#140c22] p-5 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(100% 60% at 50% 0%, ${theme.accent}55, transparent 70%)` }} />
        <p className="relative text-[11px] font-semibold tracking-[0.24em] text-cream/70 uppercase">{trial ? r.trial : r.title}</p>
        <p className="relative mt-1 font-display text-3xl text-cream">{level.name}</p>
        <div className="relative mt-4 flex justify-center gap-3">
          {Array.from({ length: scrollCount }, (_, index) => (
            <span key={index} data-result-scroll className={`grid size-12 place-items-center rounded-2xl ${index < run.scrolls ? 'bg-[#ffd66b]/20 text-[#ffd66b]' : 'bg-white/[0.05] text-white/25'}`}>
              <ScrollText size={24} aria-hidden />
            </span>
          ))}
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2 text-left">
          <div className="rounded-xl bg-white/[0.05] px-3 py-2">
            <p className="text-[10px] tracking-[0.16em] text-cream/50 uppercase">{r.time}</p>
            <p className="text-lg font-bold text-cream tabular-nums">{formatTime(run.timeMs)}</p>
            {best && !trial && <p className="text-[10px] font-semibold text-gold">{r.best}</p>}
          </div>
          <div className="rounded-xl bg-white/[0.05] px-3 py-2">
            <p className="text-[10px] tracking-[0.16em] text-cream/50 uppercase">{r.deaths}</p>
            <p className="text-lg font-bold text-cream tabular-nums">{run.deaths}</p>
          </div>
        </div>
        <div className="relative mt-5 flex flex-col gap-2">
          {onNext && (
            <button type="button" onClick={onNext} className="inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold text-void" style={{ background: `linear-gradient(135deg, ${theme.sky[2]}, ${theme.accent})` }}>
              <SkipForward size={17} aria-hidden />
              {r.next}
            </button>
          )}
          <button type="button" onClick={onReplay} className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-cream">
            <RotateCcw size={16} aria-hidden />
            {r.replay}
          </button>
          <button type="button" onClick={onHome} className="inline-flex h-11 items-center justify-center gap-2 rounded-full text-sm font-semibold text-cream/70">
            <Home size={15} aria-hidden />
            {r.levels}
          </button>
        </div>
      </div>
    </div>
  )
}
