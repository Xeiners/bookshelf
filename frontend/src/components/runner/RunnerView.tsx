import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cloud, Gamepad2, HelpCircle, Loader2, Magnet, Play, RotateCcw, Sparkles, Trophy } from 'lucide-react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import type { QuizUniverse } from '../../lib/runner/quiz'
import { playChime } from '../../lib/sfx'
import { DLE_CATEGORIES, dleApi } from '../../services/dleApi'
import { runnerApi, type RunnerOverview, type RunnerResult } from '../../services/runnerApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { useGuestStardustStore } from '../../store/useGuestStardustStore'
import { useStardustBalance } from '../../store/useHigherLowerStore'
import { useUiStore } from '../../store/useUiStore'
import { ParticleBurst, type Burst } from '../boosters/ParticleBurst'
import { DleBar } from '../dle/DleBar'
import { StardustBadge } from '../dle/StardustBadge'
import { RunnerGame, type RunnerOutcome } from './RunnerGame'

/** Réglages du Runner, gardés sur l'appareil. */
interface RunnerPrefs {
  buttons: boolean
  lite: boolean
  set: (patch: Partial<Pick<RunnerPrefs, 'buttons' | 'lite'>>) => void
}

const modestDevice = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4

const useRunnerPrefs = create<RunnerPrefs>()(
  persist(
    (set) => ({
      buttons: false,
      lite: modestDevice,
      set: (patch) => set(patch),
    }),
    { name: 'bookshelf:runner:v1', version: 2, partialize: ({ buttons, lite }) => ({ buttons, lite }), migrate: (persisted) => persisted as RunnerPrefs },
  ),
)

interface Session {
  key: number
  seed: number
  /** Course ouverte côté serveur ; `null` hors ligne (rien n'est enregistré). */
  runId: string | null
}

type Settled = { outcome: RunnerOutcome; result: RunnerResult | null; error: string | null; saving: boolean }

/**
 * Manga Runner 3D : l'accueil (records, réglages, classement), la course en plein écran et
 * son bilan. Sans compte, on court en invité, comme au BookshelfDLE : les ✦ gagnées sont
 * des reçus gardés sur l'appareil, que l'inscription ajoute au compte.
 */
export function RunnerView() {
  const t = useT()
  const openActivity = useUiStore((state) => state.openActivity)
  const notify = useUiStore((state) => state.notify)
  const signedIn = useAuthStore((state) => state.user !== null)
  const dleOverview = useDleStore((state) => state.overview)
  const loadDle = useDleStore((state) => state.loadOverview)
  const ensureGuest = useDleStore((state) => state.ensureGuest)
  const guest = dleOverview?.guest ?? null
  const ready = signedIn || guest !== null
  const stardust = useStardustBalance()
  const prefs = useRunnerPrefs()
  const [overview, setOverview] = useState<RunnerOverview | null>(null)
  const [universes, setUniverses] = useState<QuizUniverse[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [starting, setStarting] = useState(false)
  const [settled, setSettled] = useState<Settled | null>(null)

  useEffect(() => {
    if (useDleStore.getState().overview === null) void loadDle()
  }, [signedIn, loadDle])

  // Sans compte ni pseudo : un pseudo d'invité est attribué d'office.
  const asking = useRef(false)
  useEffect(() => {
    if (signedIn || guest || !dleOverview || asking.current) return
    asking.current = true
    ensureGuest('')
      .catch((error: unknown) => notify(apiErrorMessage(error, t), 'nope'))
      .finally(() => (asking.current = false))
  }, [signedIn, guest, dleOverview, ensureGuest, notify, t])

  const refresh = useCallback(() => {
    runnerApi
      .overview()
      .then(setOverview)
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (ready) refresh()
  }, [ready, signedIn, refresh])

  // Questions de quiz : quelques personnages de chaque univers du BookshelfDLE.
  useEffect(() => {
    const controller = new AbortController()
    const categories = DLE_CATEGORIES.filter((category) => category !== 'manga')
    void Promise.allSettled(categories.map((category) => dleApi.works(category, controller.signal))).then((lists) => {
      if (controller.signal.aborted) return
      setUniverses(
        lists.flatMap((list, index) =>
          list.status === 'fulfilled' && list.value.length > 0
            ? [{ title: t.dle.categories[categories[index]!].title, characters: list.value.slice(0, 40).map((work) => ({ name: work.name, image: work.imageUrl })) }]
            : [],
        ),
      )
    })
    return () => controller.abort()
  }, [t])

  const start = useCallback(async () => {
    if (starting) return
    setStarting(true)
    setSettled(null)
    vibrate(10)
    let next: Omit<Session, 'key'>
    try {
      const run = await runnerApi.start()
      next = { seed: run.seed, runId: run.id }
    } catch {
      // Hors ligne : on court quand même, sans rien enregistrer.
      next = { seed: Math.floor(Math.random() * 2 ** 32), runId: null }
    }
    setSession((current) => ({ key: (current?.key ?? 0) + 1, ...next }))
    setStarting(false)
  }, [starting])

  const finish = useCallback(
    (outcome: RunnerOutcome) => {
      const runId = session?.runId ?? null
      setSettled({ outcome, result: null, error: runId ? null : t.runner.over.offline, saving: runId !== null })
      if (!runId) return
      runnerApi
        .end(runId, { distance: outcome.distance, stardust: outcome.stardust, quiz: outcome.quiz })
        .then((result) => {
          if (result.receipts.length > 0) for (const receipt of result.receipts) useGuestStardustStore.getState().add(receipt)
          else if (useAuthStore.getState().user) useDleStore.getState().setStardust(result.balance)
          setSettled({ outcome, result, error: null, saving: false })
          if (result.record) {
            playChime(true)
            vibrate([20, 40, 20, 40, 60])
          }
          refresh()
        })
        .catch((error: unknown) => setSettled({ outcome, result: null, error: apiErrorMessage(error, t), saving: false }))
    },
    [session, t, refresh],
  )

  /** Revivre : les Poussières sont débitées sur le serveur ; le solde affiché suit. */
  const payRevive = useCallback(
    async (runId: string) => {
      try {
        const { balance } = await runnerApi.revive(runId)
        useDleStore.getState().setStardust(balance)
        return true
      } catch (error) {
        notify(apiErrorMessage(error, t), 'nope')
        return false
      }
    },
    [notify, t],
  )

  const leave = () => {
    setSession(null)
    setSettled(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DleBar label={t.activities.back} onBack={() => openActivity('hub')}>
        <StardustBadge balance={stardust} />
      </DleBar>
      {ready ? (
        <RunnerHome overview={overview} starting={starting} onStart={() => void start()} />
      ) : (
        <div className="grid flex-1 place-items-center pb-16">
          <Loader2 size={26} className="animate-spin text-glow" aria-hidden />
        </div>
      )}

      {session &&
        createPortal(
          <>
            <RunnerGame
              key={session.key}
              seed={session.seed}
              buttons={prefs.buttons}
              lite={prefs.lite}
              universes={universes}
              onOver={finish}
              revival={session.runId && signedIn ? { balance: stardust, pay: () => payRevive(session.runId!) } : null}
              onQuit={(outcome) => (outcome.distance > 1 ? finish(outcome) : leave())}
            />
            {settled && <GameOver settled={settled} replaying={starting} onReplay={() => void start()} onHome={leave} />}
          </>,
          document.body,
        )}
    </div>
  )
}

function RunnerHome({ overview, starting, onStart }: { overview: RunnerOverview | null; starting: boolean; onStart: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const prefs = useRunnerPrefs()
  const signedIn = useAuthStore((state) => state.user !== null)
  const me = overview?.me

  useGSAP(
    () => {
      gsap.fromTo('[data-runner-in]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.06, ease: EASE.glide })
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) gsap.to('[data-runner-emblem]', { y: -6, duration: 1.6, ease: 'sine.inOut', repeat: -1, yoyo: true })
    },
    { scope: ref },
  )

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-28">
      <section data-runner-in className="relative shrink-0 overflow-hidden rounded-[1.75rem] border border-[#ff6fb5]/30 bg-[#140a2e] p-5">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(120% 80% at 80% 0%, rgba(255,111,181,0.28), transparent 60%)' }} />
        <div className="relative flex items-center gap-4">
          <span data-runner-emblem aria-hidden className="grid size-16 shrink-0 place-items-center rounded-[1.3rem] text-3xl" style={{ background: 'linear-gradient(135deg, #ff6fb5, #7c5cff 60%, #3fd0ff)' }}>
            🏃
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-3xl leading-tight text-cream">{t.runner.title}</h2>
            <p className="mt-1 text-sm leading-snug text-cream/65">{t.runner.home.tagline}</p>
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2">
          <Stat label={t.runner.home.best} value={me ? me.best.toLocaleString() : '—'} />
          <Stat label={t.runner.home.bestDistance} value={me ? `${me.bestDistance.toLocaleString()} m` : '—'} />
        </div>
        {overview && (
          <p className="relative mt-3 text-xs text-cream/60">
            {t.runner.home.today(overview.me.earnedToday, overview.dailyCap)} · {t.runner.home.games(overview.me.games)}
          </p>
        )}
        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          className="relative mt-4 inline-flex h-14 w-full items-center justify-center gap-2 rounded-full text-base font-bold text-void shadow-[0_0_30px_rgba(255,111,181,0.45)] transition-transform active:scale-[0.98] disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #ffd35c, #ff6fb5 60%, #c58bff)' }}
        >
          {starting ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Play size={20} className="fill-void" aria-hidden />}
          {t.runner.home.play}
        </button>
        {!signedIn && <p className="relative mt-3 text-[11px] leading-relaxed text-cream/55">{t.runner.home.guest}</p>}
      </section>

      <section data-runner-in className="flex shrink-0 flex-col gap-3 rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
        <Toggle label={t.runner.home.buttons} hint={t.runner.home.buttonsHint} checked={prefs.buttons} onChange={(buttons) => prefs.set({ buttons })} />
        <Toggle label={t.runner.home.lite} hint={t.runner.home.liteHint} checked={prefs.lite} onChange={(lite) => prefs.set({ lite })} />
      </section>

      <section data-runner-in className="flex shrink-0 flex-col gap-2 rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4 text-sm text-cream/75">
        <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">
          <Gamepad2 size={14} aria-hidden />
          {t.runner.home.controls}
        </p>
        <p>{t.runner.home.swipe}</p>
        <p className="text-cream/55">{t.runner.home.keys}</p>
        <p className="mt-2 text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">{t.runner.home.pickups}</p>
        <p className="flex items-center gap-2">
          <Sparkles size={15} className="shrink-0 text-gold" aria-hidden />
          {t.runner.home.stardust}
        </p>
        <p className="flex items-center gap-2">
          <HelpCircle size={15} className="shrink-0 text-[#ffd35c]" aria-hidden />
          {t.runner.home.quiz}
        </p>
        <p className="flex items-center gap-2">
          <Magnet size={15} className="shrink-0 text-[#ff4d5e]" aria-hidden />
          {t.runner.home.magnet}
        </p>
        <p className="flex items-center gap-2">
          <Cloud size={15} className="shrink-0 text-[#bfe9ff]" aria-hidden />
          {t.runner.home.cloud}
        </p>
      </section>

      <section data-runner-in className="flex shrink-0 flex-col gap-2 rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
        <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">
          <Trophy size={14} aria-hidden />
          {t.runner.home.leaderboard}
        </p>
        {overview && overview.leaderboard.length === 0 && <p className="text-sm text-cream/55">{t.runner.home.empty}</p>}
        <ol className="flex flex-col gap-1">
          {overview?.leaderboard.map((row) => (
            <li key={row.userId} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${row.me ? 'bg-[#ff6fb5]/15' : ''}`}>
              <span className="w-6 text-center text-sm font-bold text-cream/60 tabular-nums">{row.rank}</span>
              {row.avatarUrl ? (
                <img src={row.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-white/10 text-xs font-semibold text-cream/80">{(row.name ?? '?').charAt(0).toUpperCase()}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-cream">
                {row.name ?? '—'}
                {row.me && <span className="ml-1.5 text-xs text-[#ff6fb5]">({t.runner.home.you})</span>}
              </span>
              <span className="text-sm font-bold text-gold tabular-nums">{row.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.05] px-3 py-2.5">
      <p className="text-[10px] tracking-[0.16em] text-cream/50 uppercase">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-cream tabular-nums">{value}</p>
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex items-center gap-3 rounded-2xl px-1 py-1 text-left">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-cream">{label}</span>
        <span className="block text-xs text-cream/50">{hint}</span>
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-[#ff6fb5]' : 'bg-white/15'}`}>
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  )
}

/** Bilan de la course, par-dessus la scène figée ; célébration si record. */
function GameOver({ settled, replaying, onReplay, onHome }: { settled: Settled; replaying: boolean; onReplay: () => void; onHome: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [burst, setBurst] = useState<Burst | null>(null)
  const { outcome, result, error, saving } = settled
  const record = result?.record ?? false

  useGSAP(
    () => {
      gsap.fromTo('[data-over-card]', { y: 40, scale: 0.92, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.55, ease: EASE.spring })
      gsap.fromTo('[data-over-row]', { x: -12, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.35, stagger: 0.06, delay: 0.2, ease: EASE.glide })
    },
    { scope: ref },
  )

  useEffect(() => {
    if (!record) return
    const timer = window.setTimeout(
      () => setBurst({ id: Date.now(), x: window.innerWidth / 2, y: window.innerHeight * 0.32, colors: ['#ffd35c', '#ff6fb5', '#3fd0ff', '#ffffff'], count: 160, spread: Math.PI * 2, kind: 'confetti' }),
      250,
    )
    return () => window.clearTimeout(timer)
  }, [record])

  const rows: [string, string][] = [
    [t.runner.over.distance, `${Math.floor(result?.distance ?? outcome.distance).toLocaleString()} m`],
    [t.runner.over.stardust, `✦ ${result?.stardust ?? outcome.stardust}`],
    [t.runner.over.quiz, result ? (result.quiz > 0 ? `${result.quiz} · +${result.quizReward} ✦` : '—') : outcome.quiz > 0 ? String(outcome.quiz) : '—'],
  ]

  return (
    <div ref={ref} className="fixed inset-0 z-[90] grid place-items-center bg-black/55 px-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t.runner.over.title}>
      <ParticleBurst burst={burst} />
      <div data-over-card className="relative w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-[#ff6fb5]/30 bg-[#140a2e] p-5 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(100% 60% at 50% 0%, rgba(255,111,181,0.3), transparent 70%)' }} />
        <p className="relative text-[11px] font-semibold tracking-[0.24em] text-[#ff9ccf] uppercase">{record ? `🏆 ${t.runner.over.record}` : t.runner.over.title}</p>
        <p className="relative mt-2 font-display text-5xl text-cream tabular-nums">{(result?.score ?? outcome.score).toLocaleString()}</p>
        <p className="relative text-xs text-cream/50">{t.runner.over.score}</p>
        <div className="relative mt-4 flex flex-col gap-1.5 text-left">
          {rows.map(([label, value]) => (
            <div key={label} data-over-row className="flex items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2 text-sm">
              <span className="text-cream/65">{label}</span>
              <span className="font-semibold text-cream tabular-nums">{value}</span>
            </div>
          ))}
          <div data-over-row className="flex items-center justify-between rounded-xl bg-gold/15 px-3 py-2 text-sm">
            <span className="text-gold">{t.runner.over.reward}</span>
            <span className="font-bold text-gold tabular-nums">{saving ? <Loader2 size={15} className="animate-spin" aria-label={t.runner.over.saving} /> : `+${result?.reward ?? 0} ✦`}</span>
          </div>
        </div>
        {result?.capped && <p className="relative mt-2 text-xs text-gold/80">{t.runner.over.capped}</p>}
        {error && <p className="relative mt-2 text-xs text-nope">{error}</p>}
        <div className="relative mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onReplay}
            disabled={replaying}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold text-void disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #ffd35c, #ff6fb5 60%, #c58bff)' }}
          >
            {replaying ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <RotateCcw size={17} aria-hidden />}
            {t.runner.over.replay}
          </button>
          <button type="button" onClick={onHome} className="h-12 rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-cream">
            {t.runner.over.home}
          </button>
        </div>
      </div>
    </div>
  )
}
