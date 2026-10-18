import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Gamepad2, Loader2, Play, RotateCcw, Swords, Trophy, Users } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playChime } from '../../lib/sfx'
import type { StackOutcome } from '../../lib/stack/engine'
import { stackApi, type StackOverview, type StackResult } from '../../services/stackApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { useGuestStardustStore } from '../../store/useGuestStardustStore'
import { useStardustBalance } from '../../store/useHigherLowerStore'
import { useRecordRewards } from '../../store/useRecordRewards'
import { useStackRoom } from '../../store/useStackRoom'
import { parseRoomCode } from '../../lib/dle'
import { useUiStore } from '../../store/useUiStore'
import { ParticleBurst, type Burst } from '../boosters/ParticleBurst'
import { DleBar } from '../dle/DleBar'
import { StardustBadge } from '../dle/StardustBadge'
import { StackEmblem } from './StackEmblem'
import { StackGame } from './StackGame'
import { StackRoomScreen } from './StackRoomScreen'
import type { StackMode } from '../../lib/stack/net'

interface Session {
  key: number
  /** Partie ouverte côté serveur ; `null` hors ligne (rien n'est enregistré). */
  runId: string | null
}

type Settled = { outcome: StackOutcome; result: StackResult | null; error: string | null; saving: boolean }

/**
 * Page Stack : l'accueil (records, classement), la partie en plein écran et son bilan. Sans
 * compte, on joue en invité, comme au BookshelfDLE : les ✦ gagnées sont des reçus gardés sur
 * l'appareil, que l'inscription ajoute au compte.
 */
export function StackView() {
  const t = useT()
  const openActivity = useUiStore((state) => state.openActivity)
  const notify = useUiStore((state) => state.notify)
  const signedIn = useAuthStore((state) => state.user !== null)
  const dleOverview = useDleStore((state) => state.overview)
  const loadDle = useDleStore((state) => state.loadOverview)
  const ensureGuest = useDleStore((state) => state.ensureGuest)
  const guest = dleOverview?.guest ?? null
  const ready = signedIn || guest !== null
  const meId = useAuthStore((state) => state.user?.id) ?? guest?.id ?? null
  const stardust = useStardustBalance()
  const roomStatus = useStackRoom((state) => state.status)
  const pendingCode = useStackRoom((state) => state.pendingCode)
  const [overview, setOverview] = useState<StackOverview | null>(null)
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

  // Invitation par lien (`?stack=CODE`) : on entre dans le salon dès qu'on a une identité.
  useEffect(() => {
    if (!ready || !pendingCode) return
    useStackRoom.getState().setPendingCode(null)
    void useStackRoom.getState().join(pendingCode).catch(() => undefined)
  }, [ready, pendingCode])

  // Quitter Page Stack ferme aussi le salon.
  useEffect(() => () => useStackRoom.getState().leave(), [])

  const refresh = useCallback(() => {
    stackApi
      .overview()
      .then(setOverview)
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (ready) refresh()
  }, [ready, signedIn, refresh])

  const start = useCallback(async () => {
    if (starting) return
    setStarting(true)
    setSettled(null)
    vibrate(10)
    let runId: string | null = null
    try {
      runId = (await stackApi.start()).id
    } catch {
      // Hors ligne : on joue quand même, sans rien enregistrer.
    }
    setSession((current) => ({ key: (current?.key ?? 0) + 1, runId }))
    setStarting(false)
  }, [starting])

  const finish = useCallback(
    (outcome: StackOutcome) => {
      const runId = session?.runId ?? null
      setSettled({ outcome, result: null, error: runId ? null : t.stack.over.offline, saving: runId !== null })
      if (!runId) return
      stackApi
        .end(runId, { score: outcome.score, pages: outcome.pages, perfects: outcome.perfects })
        .then((result) => {
          if (result.receipts.length > 0) for (const receipt of result.receipts) useGuestStardustStore.getState().add(receipt)
          else if (useAuthStore.getState().user) useDleStore.getState().setStardust(result.balance)
          setSettled({ outcome, result, error: null, saving: false })
          if (result.record) {
            playChime(true)
            vibrate([20, 40, 20, 40, 60])
          }
          // Record de tous les temps : la fenêtre du choix de la récompense.
          if (result.recordReward) useRecordRewards.getState().push(result.recordReward)
          refresh()
        })
        .catch((error: unknown) => setSettled({ outcome, result: null, error: apiErrorMessage(error, t), saving: false }))
    },
    [session, t, refresh],
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
        <StackHome overview={overview} starting={starting} onStart={() => void start()} onCreate={(mode) => void useStackRoom.getState().create(mode).catch(() => undefined)} onJoin={(code) => void useStackRoom.getState().join(code).catch(() => undefined)} />
      ) : (
        <div className="grid flex-1 place-items-center pb-16">
          <Loader2 size={26} className="animate-spin text-glow" aria-hidden />
        </div>
      )}

      {meId && roomStatus !== 'idle' && createPortal(<StackRoomScreen meId={meId} />, document.body)}

      {session &&
        createPortal(
          <>
            <StackGame key={session.key} onOver={finish} onQuit={(outcome) => (outcome.pages > 0 ? finish(outcome) : leave())} />
            {settled && <GameOver settled={settled} replaying={starting} onReplay={() => void start()} onHome={leave} />}
          </>,
          document.body,
        )}
    </div>
  )
}

function StackHome({ overview, starting, onStart, onCreate, onJoin }: { overview: StackOverview | null; starting: boolean; onStart: () => void; onCreate: (mode: StackMode) => void; onJoin: (code: string) => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const signedIn = useAuthStore((state) => state.user !== null)
  const me = overview?.me

  useGSAP(
    () => {
      gsap.fromTo('[data-stack-in]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.06, ease: EASE.glide })
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.to('[data-stack-emblem]', { y: -6, duration: 1.6, ease: 'sine.inOut', repeat: -1, yoyo: true })
      }
    },
    { scope: ref },
  )

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-28">
      <section data-stack-in className="relative shrink-0 overflow-hidden rounded-[1.75rem] border border-[#ff9a5c]/30 bg-[#140a2e]">
        <div className="relative h-72 overflow-hidden">
          <div data-stack-emblem className="absolute inset-0">
            <StackEmblem className="block size-full" wide />
          </div>
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#140a2e] via-transparent to-transparent" />
          <div className="absolute inset-x-0 top-0 p-4">
            <h2 className="font-display text-[1.7rem] leading-none text-white drop-shadow-[0_2px_10px_rgba(40,0,80,0.6)]">{t.stack.title}</h2>
            <p className="mt-1 max-w-[16rem] text-[11px] leading-snug text-white/85">{t.stack.home.tagline}</p>
          </div>
        </div>
        <div className="relative p-4">
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t.stack.home.best} value={me ? me.best.toLocaleString() : '—'} />
            <Stat label={t.stack.home.bestPages} value={me ? me.bestPages.toLocaleString() : '—'} />
            <Stat label={t.stack.home.todayShort} value={overview ? `${overview.me.earnedToday}/${overview.dailyCap}` : '—'} />
          </div>
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="mt-3 inline-flex h-14 w-full items-center justify-center gap-2 rounded-full text-base font-bold text-void shadow-[0_0_30px_rgba(255,154,92,0.45)] transition-transform active:scale-[0.98] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #ffd35c, #ff9a5c 55%, #ff6fb5)' }}
          >
            {starting ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Play size={20} className="fill-void" aria-hidden />}
            {t.stack.home.play}
          </button>
          {overview && <p className="mt-2 text-center text-[11px] text-cream/50">{t.stack.home.games(overview.me.games)}</p>}
          {!signedIn && <p className="mt-2 text-[11px] leading-relaxed text-cream/55">{t.stack.home.guest}</p>}
        </div>
      </section>

      <Multiplayer onCreate={onCreate} onJoin={onJoin} />

      <details data-stack-in className="group shrink-0 rounded-[1.5rem] border border-white/8 bg-white/[0.03]">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">
          <Gamepad2 size={14} aria-hidden />
          <span className="flex-1">{t.stack.home.howTo}</span>
          <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="flex flex-col gap-2 px-4 pb-4 text-sm text-cream/75">
          <p>{t.stack.home.rule1}</p>
          <p>{t.stack.home.rule2}</p>
          <p>{t.stack.home.rule3}</p>
          <p className="text-cream/55">{t.stack.home.rule4}</p>
        </div>
      </details>

      <section data-stack-in className="flex shrink-0 flex-col gap-2 rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
        <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">
          <Trophy size={14} aria-hidden />
          {t.stack.home.leaderboard}
        </p>
        {overview && overview.leaderboard.length === 0 && <p className="text-sm text-cream/55">{t.stack.home.empty}</p>}
        <ol className="flex flex-col gap-1">
          {overview?.leaderboard.map((row) => (
            <li key={row.userId} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${row.me ? 'bg-[#ff9a5c]/15' : ''}`}>
              <span className="w-6 text-center text-sm font-bold text-cream/60 tabular-nums">{row.rank}</span>
              {row.avatarUrl ? (
                <img src={row.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-white/10 text-xs font-semibold text-cream/80">{(row.name ?? '?').charAt(0).toUpperCase()}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-cream">
                {row.name ?? '—'}
                {row.me && <span className="ml-1.5 text-xs text-[#ff9a5c]">({t.stack.home.you})</span>}
              </span>
              <span className="text-sm font-bold text-gold tabular-nums">{row.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

/** Jouer à plusieurs : créer un salon (versus ou coop) ou en rejoindre un avec son code. */
function Multiplayer({ onCreate, onJoin }: { onCreate: (mode: StackMode) => void; onJoin: (code: string) => void }) {
  const t = useT()
  const [code, setCode] = useState('')
  const parsed = parseRoomCode(code)
  return (
    <section data-stack-in className="flex shrink-0 flex-col gap-3 rounded-[1.5rem] border border-[#ff9a5c]/25 bg-white/[0.03] p-4">
      <p className="text-[11px] font-semibold tracking-[0.2em] text-[#ffb98a] uppercase">{t.stack.room.title}</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onCreate('versus')} className="flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 text-center active:scale-[0.98]">
          <Swords size={20} className="text-[#ffb98a]" aria-hidden />
          <span className="text-sm font-bold text-cream">{t.stack.room.versus}</span>
          <span className="text-[11px] leading-snug text-cream/55">{t.stack.room.versusHint}</span>
        </button>
        <button type="button" onClick={() => onCreate('coop')} className="flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 text-center active:scale-[0.98]">
          <Users size={20} className="text-[#ffb98a]" aria-hidden />
          <span className="text-sm font-bold text-cream">{t.stack.room.coop}</span>
          <span className="text-[11px] leading-snug text-cream/55">{t.stack.room.coopHint}</span>
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (parsed) onJoin(parsed)
        }}
      >
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={t.stack.room.joinPlaceholder}
          aria-label={t.stack.room.joinPlaceholder}
          maxLength={12}
          autoCapitalize="characters"
          autoComplete="off"
          className="glass min-w-0 flex-1 rounded-full px-4 py-3 text-sm tracking-[0.15em] text-cream uppercase placeholder:tracking-normal placeholder:text-mist/60 placeholder:normal-case focus:ring-2 focus:ring-[#ff9a5c]/60 focus:outline-none"
        />
        <button type="submit" disabled={!parsed} className="rounded-full bg-white/10 px-5 text-sm font-semibold text-cream disabled:opacity-40">
          {t.stack.room.joinGo}
        </button>
      </form>
      <p className="text-center text-[11px] text-cream/45">{t.stack.room.noRewards}</p>
    </section>
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

/** Bilan de la partie, par-dessus la pile figée ; célébration si record. */
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
      () => setBurst({ id: Date.now(), x: window.innerWidth / 2, y: window.innerHeight * 0.32, colors: ['#ffd35c', '#ff9a5c', '#ff6fb5', '#ffffff'], count: 160, spread: Math.PI * 2, kind: 'confetti' }),
      250,
    )
    return () => window.clearTimeout(timer)
  }, [record])

  const rows: [string, string][] = [
    [t.stack.over.pages, String(result?.pages ?? outcome.pages)],
    [t.stack.over.perfects, String(result?.perfects ?? outcome.perfects)],
    [t.stack.over.combo, outcome.bestCombo > 0 ? `×${outcome.bestCombo}` : '—'],
  ]

  return (
    <div ref={ref} className="fixed inset-0 z-[90] grid place-items-center bg-black/55 px-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t.stack.over.title}>
      <ParticleBurst burst={burst} />
      <div data-over-card className="relative w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-[#ff9a5c]/30 bg-[#140a2e] p-5 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(100% 60% at 50% 0%, rgba(255,154,92,0.3), transparent 70%)' }} />
        <p className="relative text-[11px] font-semibold tracking-[0.24em] text-[#ffb98a] uppercase">{record ? `🏆 ${t.stack.over.record}` : t.stack.over.title}</p>
        <p className="relative mt-2 font-display text-5xl text-cream tabular-nums">{(result?.score ?? outcome.score).toLocaleString()}</p>
        <p className="relative text-xs text-cream/50">{t.stack.over.score}</p>
        <div className="relative mt-4 flex flex-col gap-1.5 text-left">
          {rows.map(([label, value]) => (
            <div key={label} data-over-row className="flex items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2 text-sm">
              <span className="text-cream/65">{label}</span>
              <span className="font-semibold text-cream tabular-nums">{value}</span>
            </div>
          ))}
          <div data-over-row className="flex items-center justify-between rounded-xl bg-gold/15 px-3 py-2 text-sm">
            <span className="text-gold">{t.stack.over.reward}</span>
            <span className="font-bold text-gold tabular-nums">{saving ? <Loader2 size={15} className="animate-spin" aria-label={t.stack.over.saving} /> : `+${result?.reward ?? 0} ✦`}</span>
          </div>
        </div>
        {result?.capped && <p className="relative mt-2 text-xs text-gold/80">{t.stack.over.capped}</p>}
        {error && <p className="relative mt-2 text-xs text-nope">{error}</p>}
        <div className="relative mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onReplay}
            disabled={replaying}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold text-void disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #ffd35c, #ff9a5c 55%, #ff6fb5)' }}
          >
            {replaying ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <RotateCcw size={17} aria-hidden />}
            {t.stack.over.replay}
          </button>
          <button type="button" onClick={onHome} className="h-12 rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-cream">
            {t.stack.over.home}
          </button>
        </div>
      </div>
    </div>
  )
}
