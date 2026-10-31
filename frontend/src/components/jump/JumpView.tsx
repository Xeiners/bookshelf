import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Gamepad2, Loader2, Play, RotateCcw, Trophy } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { DEFAULT_CHARACTER, isJumpCharacter } from '../../lib/jump/characters'
import type { JumpOutcome } from '../../lib/jump/engine'
import { playChime } from '../../lib/sfx'
import { jumpApi, type JumpCharacters, type JumpOverview, type JumpResult } from '../../services/jumpApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { useGuestStardustStore } from '../../store/useGuestStardustStore'
import { useStardustBalance } from '../../store/useHigherLowerStore'
import { useRecordRewards } from '../../store/useRecordRewards'
import { useUiStore } from '../../store/useUiStore'
import { requestTiltPermission } from '../../hooks/useHoloTilt'
import { DleBar } from '../dle/DleBar'
import { StardustBadge } from '../dle/StardustBadge'
import { CharacterShop } from './CharacterShop'
import { JumpEmblem } from './JumpEmblem'
import { JumpGame } from './JumpGame'

interface Session {
  key: number
  /** Partie ouverte côté serveur ; `null` hors ligne (rien n'est enregistré). */
  runId: string | null
}

type Settled = { outcome: JumpOutcome; result: JumpResult | null; error: string | null; saving: boolean }

/** Altitude affichée : une « mètre » pour 10 unités du jeu. */
const meters = (height: number) => Math.floor(height / 10)

/**
 * Page Jump : l'accueil (records, classement, règles), la partie en plein écran et son bilan.
 * Sans compte, on joue en invité, comme au BookshelfDLE : les ✦ gagnées sont des reçus gardés sur
 * l'appareil, que l'inscription ajoute au compte.
 */
export function JumpView() {
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
  const [overview, setOverview] = useState<JumpOverview | null>(null)
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
    jumpApi
      .overview()
      .then(setOverview)
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (ready) refresh()
  }, [ready, signedIn, refresh])

  const start = useCallback(async () => {
    if (starting) return
    requestTiltPermission()
    setStarting(true)
    setSettled(null)
    vibrate(10)
    let runId: string | null = null
    try {
      runId = (await jumpApi.start()).id
    } catch {
      // Hors ligne : on joue quand même, sans rien enregistrer.
    }
    setSession((current) => ({ key: (current?.key ?? 0) + 1, runId }))
    setStarting(false)
  }, [starting])

  const finish = useCallback(
    (outcome: JumpOutcome) => {
      const runId = session?.runId ?? null
      setSettled({ outcome, result: null, error: runId ? null : t.jump.over.offline, saving: runId !== null })
      if (!runId) return
      jumpApi
        .end(runId, { score: outcome.score, height: outcome.height, stars: outcome.stars, stomps: outcome.stomps })
        .then((result) => {
          if (result.receipts.length > 0) for (const receipt of result.receipts) useGuestStardustStore.getState().add(receipt)
          else if (useAuthStore.getState().user) useDleStore.getState().setStardust(result.balance)
          setSettled({ outcome, result, error: null, saving: false })
          if (result.record) {
            playChime(true)
            vibrate([20, 40, 20, 40, 60])
          }
          // Record de tous les temps : la fenêtre du choix de la récompense (booster ou boîte).
          if (result.recordReward) useRecordRewards.getState().push(result.recordReward)
          refresh()
        })
        .catch((error: unknown) => setSettled({ outcome, result: null, error: apiErrorMessage(error, t), saving: false }))
    },
    [session, t, refresh],
  )

  // Le personnage choisi (la Lune tant que rien n'est chargé, ou si l'identifiant est inconnu).
  const chosen = overview?.characters.selected
  const character = isJumpCharacter(chosen) ? chosen : DEFAULT_CHARACTER
  const changeCharacters = (characters: JumpCharacters) => setOverview((current) => (current ? { ...current, characters } : current))

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
        <JumpHome overview={overview} starting={starting} onStart={() => void start()} onCharacters={changeCharacters} />
      ) : (
        <div className="grid flex-1 place-items-center pb-16">
          <Loader2 size={26} className="animate-spin text-glow" aria-hidden />
        </div>
      )}

      {session &&
        createPortal(
          <>
            <JumpGame key={session.key} character={character} onOver={finish} onQuit={(outcome) => (outcome.height > 0 ? finish(outcome) : leave())} />
            {settled && <GameOver settled={settled} replaying={starting} onReplay={() => void start()} onHome={leave} />}
          </>,
          document.body,
        )}
    </div>
  )
}

function JumpHome({ overview, starting, onStart, onCharacters }: { overview: JumpOverview | null; starting: boolean; onStart: () => void; onCharacters: (next: JumpCharacters) => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const signedIn = useAuthStore((state) => state.user !== null)
  const me = overview?.me

  useGSAP(
    () => {
      gsap.fromTo('[data-jump-in]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.06, ease: EASE.glide })
    },
    { scope: ref },
  )

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-28">
      <section data-jump-in className="relative shrink-0 overflow-hidden rounded-[1.75rem] border border-[#ff8a6b]/30 bg-[#170c26]">
        <div className="relative h-64 overflow-hidden">
          <JumpEmblem wide className="absolute inset-0 block size-full" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#170c26] via-transparent to-transparent" />
          <div className="absolute inset-x-0 top-0 p-4">
            <h2 className="font-display text-[1.7rem] leading-none text-white [text-shadow:0_2px_0_#1a1030]">{t.jump.title}</h2>
            <p className="mt-1 max-w-[16rem] text-[11px] leading-snug text-white/90">{t.jump.home.tagline}</p>
          </div>
        </div>
        <div className="relative p-4">
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t.jump.home.best} value={me ? me.best.toLocaleString() : '—'} />
            <Stat label={t.jump.home.bestHeight} value={me ? t.jump.game.height(meters(me.bestHeight)) : '—'} />
            <Stat label={t.jump.home.todayShort} value={overview ? `${overview.me.earnedToday}/${overview.dailyCap}` : '—'} />
          </div>
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="mt-3 inline-flex h-14 w-full items-center justify-center gap-2 rounded-full text-base font-bold text-void transition-transform active:scale-[0.98] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #ffe08a, #ff8a6b 55%, #ff6fb5)' }}
          >
            {starting ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Play size={20} className="fill-void" aria-hidden />}
            {t.jump.home.play}
          </button>
          {overview && <p className="mt-2 text-center text-[11px] text-cream/50">{t.jump.home.games(overview.me.games)}</p>}
          {!signedIn && <p className="mt-2 text-[11px] leading-relaxed text-cream/55">{t.jump.home.guest}</p>}
        </div>
      </section>

      <CharacterShop characters={overview?.characters ?? null} onChange={onCharacters} />

      <details data-jump-in className="group shrink-0 rounded-[1.5rem] border border-white/8 bg-white/[0.03]">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">
          <Gamepad2 size={14} aria-hidden />
          <span className="flex-1">{t.jump.home.howTo}</span>
          <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="flex flex-col gap-2 px-4 pb-4 text-sm text-cream/75">
          <p>{t.jump.home.rule1}</p>
          <p>{t.jump.home.rule2}</p>
          <p>{t.jump.home.rule3}</p>
          <p>{t.jump.home.rule4}</p>
          <p className="text-cream/55">{t.jump.home.rule5}</p>
        </div>
      </details>

      <section data-jump-in className="flex shrink-0 flex-col gap-2 rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
        <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">
          <Trophy size={14} aria-hidden />
          {t.jump.home.leaderboard}
        </p>
        {overview && overview.leaderboard.length === 0 && <p className="text-sm text-cream/55">{t.jump.home.empty}</p>}
        <ol className="flex flex-col gap-1">
          {overview?.leaderboard.map((row) => (
            <li key={row.userId} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${row.me ? 'bg-[#ff8a6b]/15' : ''}`}>
              <span className="w-6 text-center text-sm font-bold text-cream/60 tabular-nums">{row.rank}</span>
              {row.avatarUrl ? (
                <img src={row.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-white/10 text-xs font-semibold text-cream/80">{(row.name ?? '?').charAt(0).toUpperCase()}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-cream">
                {row.name ?? '—'}
                {row.me && <span className="ml-1.5 text-xs text-[#ff8a6b]">({t.jump.home.you})</span>}
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
    <div className="min-w-0 rounded-2xl bg-white/[0.05] px-3 py-2.5">
      <p className="truncate text-[10px] tracking-[0.16em] text-cream/50 uppercase">{label}</p>
      <p className="mt-0.5 truncate text-lg font-bold text-cream tabular-nums">{value}</p>
    </div>
  )
}

/** Bilan de la partie, par-dessus le ciel figé ; célébration si record. */
function GameOver({ settled, replaying, onReplay, onHome }: { settled: Settled; replaying: boolean; onReplay: () => void; onHome: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const { outcome, result, error, saving } = settled
  const record = result?.record ?? false

  useGSAP(
    () => {
      gsap.fromTo('[data-over-card]', { y: 40, scale: 0.92, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.5, ease: EASE.spring })
    },
    { scope: ref },
  )

  const rows: [string, string][] = [
    [t.jump.over.height, t.jump.game.height(meters(result?.height ?? outcome.height))],
    [t.jump.over.stars, String(result?.stars ?? outcome.stars)],
    [t.jump.over.stomps, String(result?.stomps ?? outcome.stomps)],
  ]

  return (
    <div ref={ref} className="fixed inset-0 z-[90] grid place-items-center bg-black/55 px-5" role="dialog" aria-modal="true" aria-label={t.jump.over.title}>
      <div data-over-card className="relative w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-[#ff8a6b]/30 bg-[#170c26] p-5 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(100% 60% at 50% 0%, rgba(255,138,107,0.3), transparent 70%)' }} />
        <p className="relative text-[11px] font-semibold tracking-[0.24em] text-[#ffb9a0] uppercase">{record ? `🏆 ${t.jump.over.record}` : t.jump.over.title}</p>
        <p className="relative mt-2 font-display text-5xl text-cream tabular-nums">{(result?.score ?? outcome.score).toLocaleString()}</p>
        <p className="relative text-xs text-cream/50">{t.jump.over.score}</p>
        <div className="relative mt-4 flex flex-col gap-1.5 text-left">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2 text-sm">
              <span className="text-cream/65">{label}</span>
              <span className="font-semibold text-cream tabular-nums">{value}</span>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-xl bg-gold/15 px-3 py-2 text-sm">
            <span className="text-gold">{t.jump.over.reward}</span>
            <span className="font-bold text-gold tabular-nums">{saving ? <Loader2 size={15} className="animate-spin" aria-label={t.jump.over.saving} /> : `+${result?.reward ?? 0} ✦`}</span>
          </div>
        </div>
        {result?.capped && <p className="relative mt-2 text-xs text-gold/80">{t.jump.over.capped}</p>}
        {error && <p className="relative mt-2 text-xs text-nope">{error}</p>}
        <div className="relative mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onReplay}
            disabled={replaying}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold text-void disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #ffe08a, #ff8a6b 55%, #ff6fb5)' }}
          >
            {replaying ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <RotateCcw size={17} aria-hidden />}
            {t.jump.over.replay}
          </button>
          <button type="button" onClick={onHome} className="h-12 rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-cream">
            {t.jump.over.home}
          </button>
        </div>
      </div>
    </div>
  )
}
