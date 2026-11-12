import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Gamepad2, Gift, GraduationCap, Home, Loader2, Play, RotateCcw, ScrollText, Skull, SkipForward, Sparkle, Timer, Trash2, Wand2 } from 'lucide-react'
import { CLEAR_STARDUST, TIERS, tierOf, type Tier } from '../../lib/gravity/constants'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { formatTime } from '../../lib/gravity/format'
import { THEMES } from '../../lib/gravity/themes'
import type { SolveReport } from '../../lib/gravity/solver'
import type { GravityLevel } from '../../lib/gravity/types'
import { playChime } from '../../lib/sfx'
import { gravityApi, type GravityLevelSummary, type GravityOverview, type GravityProgress, type GravityReward } from '../../services/gravityApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useBoosterStore } from '../../store/useBoosterStore'
import { useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { DleBar } from '../dle/DleBar'
import { GravityEmblem } from './GravityEmblem'
import { GravityGame, type GravityRunResult } from './GravityGame'
import { GravityWorkshop } from './GravityWorkshop'
import { enterLandscape, leaveLandscape } from './landscape'
import { readTutorial, writeTutorial } from '../../lib/gravity/tutorial'

/** Le tutoriel (et ses leçons calculées d'avance) : chargé à la première ouverture. */
const GravityTutorial = lazy(() => import('./GravityTutorial').then((module) => ({ default: module.GravityTutorial })))

/** Le bilan d'une partie finie : la partie, puis la progression et la récompense rendues par le serveur. */
interface RunResult {
  run: GravityRunResult
  progress: GravityProgress | null
  reward: GravityReward | null
}

interface Session {
  key: number
  level: GravityLevel
  /** Essai depuis l'atelier : rien n'est enregistré. */
  trial: boolean
  /** Démonstration du solveur. */
  solution?: SolveReport
}

/**
 * Gravity Ninja : les niveaux (avancement de 0 à 100 %, rouleaux, meilleur temps), la partie en
 * plein écran et son bilan ; l'atelier des niveaux pour les admins (le serveur répond 404 aux
 * autres).
 */
export function GravityView() {
  const t = useT()
  const openActivity = useUiStore((state) => state.openActivity)
  const notify = useUiStore((state) => state.notify)
  const isAdmin = useAuthStore((state) => state.user?.isAdmin === true)
  const [overview, setOverview] = useState<GravityOverview | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
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

  /** Enregistre une partie (sauf un essai) ; la progression et la récompense reviennent du serveur. */
  const record = async (level: GravityLevel, run: GravityRunResult, trial: boolean): Promise<Omit<RunResult, 'run'> | null> => {
    if (trial || (run.percent === 0 && !run.completed)) return null
    try {
      const outcome = await gravityApi.run(level.id, run)
      setOverview((current) => (current ? { ...current, progress: { ...current.progress, [level.id]: outcome.progress } } : current))
      // Le solde et la réserve de boosters suivent aussitôt.
      if (outcome.stardust !== null) useDleStore.getState().setStardust(outcome.stardust)
      if (outcome.boosters) useBoosterStore.setState({ status: outcome.boosters, syncedAt: performance.now(), offline: false })
      return { progress: outcome.progress, reward: outcome.reward }
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
    setResult({ run, progress: null, reward: null })
    void record(session.level, run, session.trial).then((outcome) => setResult({ run, progress: outcome?.progress ?? null, reward: outcome?.reward ?? null }))
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
      <GravityHome overview={overview} failed={failed} loading={loading} focus={session?.level.id ?? null} onPlay={(level) => void play(level)} onWorkshop={isAdmin ? () => setWorkshop(true) : undefined} onDelete={isAdmin ? (level) => void remove(level) : undefined} onRetry={refresh} />

      {workshop && <GravityWorkshop ai={overview?.ai ?? []} onClose={() => setWorkshop(false)} onTry={tryLevel} onSaved={refresh} />}

      {session && (
        <>
          <GravityGame
            key={session.key}
            level={session.level}
            trial={session.trial}
            solution={session.solution}
            record={session.trial ? 0 : (overview?.progress[session.level.id]?.bestPercent ?? 0)}
            onFinish={onFinish}
            onQuit={onQuit}
            onRestart={onRestart}
          />
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

type Screen = 'home' | 'levels'

/** Un onglet de la sélection : un palier de difficulté, ou les niveaux de l'atelier. */
interface LevelGroup {
  id: Tier | 'custom'
  label: string
  items: GravityLevelSummary[]
}

/**
 * L'accueil du mode (« Jouer », récompenses, règles), puis la sélection des niveaux façon jeu : un
 * onglet par palier, une case numérotée par niveau, et la fiche du niveau choisi avec son bouton.
 * `focus` : le niveau en cours (ou le dernier lancé), que la sélection suit.
 */
function GravityHome({
  overview,
  failed,
  loading,
  focus,
  onPlay,
  onWorkshop,
  onDelete,
  onRetry,
}: {
  overview: GravityOverview | null
  failed: boolean
  loading: string | null
  focus: string | null
  onPlay: (level: GravityLevelSummary) => void
  /** Admins seulement. */
  onWorkshop?: () => void
  onDelete?: (level: GravityLevelSummary) => void
  onRetry: () => void
}) {
  const t = useT()
  const g = t.gravity.home
  const ref = useRef<HTMLDivElement>(null)
  const [screen, setScreen] = useState<Screen>('home')
  const [tabId, setTabId] = useState<LevelGroup['id'] | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)
  // Le niveau lancé (ou « Niveau suivant ») devient la case choisie, dans son onglet.
  const [followed, setFollowed] = useState(focus)
  if (focus !== followed) {
    setFollowed(focus)
    if (focus) {
      setPickedId(focus)
      setTabId(null)
    }
  }

  const levels = overview?.levels ?? []
  const progressOf = (level: GravityLevelSummary) => overview?.progress[level.id] ?? null
  const groups: LevelGroup[] = [
    ...TIERS.map((tier) => ({ id: tier, label: g.tiers[tier], items: levels.filter((level) => level.builtin && tierOf(level.difficulty) === tier) })),
    { id: 'custom' as const, label: g.custom, items: levels.filter((level) => !level.builtin) },
  ].filter((group) => group.items.length > 0)
  const groupOf = (id: string | null) => groups.find((group) => group.items.some((level) => level.id === id))
  const upcoming = groups.flatMap((group) => group.items).find((level) => !progressOf(level)?.completed) ?? null
  const upcomingGroup = groupOf(upcoming?.id ?? null)

  const group = groups.find((item) => item.id === tabId) ?? groupOf(pickedId) ?? upcomingGroup ?? groups[0]
  const selected = group?.items.find((level) => level.id === pickedId) ?? group?.items.find((level) => !progressOf(level)?.completed) ?? group?.items[0]

  const done = levels.filter((level) => progressOf(level)?.completed).length
  const scrollsOwned = levels.reduce((sum, level) => sum + Math.min(progressOf(level)?.scrolls ?? 0, level.scrolls), 0)
  const scrollsTotal = levels.reduce((sum, level) => sum + level.scrolls, 0)

  useGSAP(
    () => {
      gsap.fromTo('[data-gravity-in]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, stagger: 0.04, ease: EASE.glide })
    },
    { scope: ref, dependencies: [overview === null, screen, group?.id] },
  )

  const go = (next: Screen) => {
    vibrate(8)
    setScreen(next)
    ref.current?.scrollTo({ top: 0 })
  }

  // Le tutoriel : proposé au premier « Jouer » (une fois par appareil), relançable depuis l'accueil.
  const tt = t.gravity.tutorial
  const [tutorial, setTutorial] = useState(false)
  const [offer, setOffer] = useState(false)
  const [tutorialDone, setTutorialDone] = useState(() => readTutorial().done)
  const play = () => {
    if (!readTutorial().offered) {
      vibrate(8)
      setOffer(true)
      return
    }
    go('levels')
  }
  // Le parcours se joue en plein écran : lancé dans le geste du joueur.
  const openTutorial = () => {
    vibrate(10)
    enterLandscape()
    setTutorial(true)
  }
  const answerOffer = (take: boolean) => {
    writeTutorial({ ...readTutorial(), offered: true })
    setOffer(false)
    if (take) openTutorial()
    else go('levels')
  }
  const closeTutorial = () => {
    setTutorial(false)
    setTutorialDone(readTutorial().done)
    leaveLandscape()
  }

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-28">
      {screen === 'home' ? (
        <>
          <section data-gravity-in className="relative shrink-0 overflow-hidden rounded-[1.75rem] border border-[#ff8a6b]/30 bg-[#170c26]">
            <div className="relative h-48 overflow-hidden">
              <GravityEmblem className="absolute inset-0 block size-full" />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#170c26] via-transparent to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4">
                <h2 className="font-display text-[1.8rem] leading-none text-white [text-shadow:0_2px_0_#1a1030]">{t.gravity.title}</h2>
                <p className="mt-1 max-w-[18rem] text-xs leading-snug text-white/85">{g.tagline}</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
              <button
                type="button"
                onClick={play}
                disabled={!overview}
                className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[#ffb84d] font-display text-xl text-void shadow-[0_4px_0_#b8642f] transition-transform active:translate-y-1 active:shadow-none disabled:opacity-50"
              >
                {overview ? <Play size={20} className="fill-void" aria-hidden /> : <Loader2 size={20} className="animate-spin" aria-hidden />}
                {g.play}
              </button>
              {overview && upcoming && upcomingGroup && <p className="-mt-1 text-center text-[11px] text-cream/60">{g.next(upcomingGroup.label, upcomingGroup.items.indexOf(upcoming) + 1)}</p>}
              {overview && !upcoming && levels.length > 0 && <p className="-mt-1 text-center text-[11px] text-cream/60">{g.allDone}</p>}
              <div className="flex items-center justify-between gap-3 text-xs text-cream/65">
                <span className="flex flex-col gap-0.5 tabular-nums">
                  <span>{overview ? g.completed(done, levels.length) : '—'}</span>
                  {overview && scrollsTotal > 0 && (
                    <span className="inline-flex items-center gap-1 text-cream/50">
                      <ScrollText size={12} className="text-[#ffd66b]" aria-hidden />
                      {g.scrollsTotal(scrollsOwned, scrollsTotal)}
                    </span>
                  )}
                </span>
                {onWorkshop && (
                  <button type="button" onClick={onWorkshop} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#ff8a6b]/15 px-3 text-xs font-semibold text-[#ffb69c]">
                    <Wand2 size={14} aria-hidden />
                    {g.workshop}
                  </button>
                )}
              </div>
            </div>
          </section>

          {failed && (
            <button type="button" onClick={onRetry} className="rounded-2xl bg-white/[0.05] p-4 text-sm text-cream/70">
              {g.failed}
            </button>
          )}

          <button
            data-gravity-in
            type="button"
            onClick={openTutorial}
            className="flex shrink-0 items-center gap-3 rounded-[1.5rem] border border-[#ffb84d]/25 bg-[#ffb84d]/[0.07] p-4 text-left transition-colors hover:bg-[#ffb84d]/[0.12]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#ffb84d]/15 text-[#ffb84d]">
              {tutorialDone ? <Check size={20} strokeWidth={3} aria-hidden /> : <GraduationCap size={20} aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-cream">{tt.open}</span>
              <span className="block text-xs text-cream/60">{tutorialDone ? tt.done : tt.pitch}</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-cream/40" aria-hidden />
          </button>

          <RewardsGuide />

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
        </>
      ) : (
        <>
          <div data-gravity-in className="flex shrink-0 items-center gap-2 pt-1">
            <button type="button" onClick={() => go('home')} aria-label={g.back} className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.06] text-cream">
              <ChevronLeft size={20} aria-hidden />
            </button>
            <h2 className="flex-1 font-display text-2xl leading-none text-cream">{g.pick}</h2>
            <span className="text-xs text-cream/55 tabular-nums">{g.tierDone(done, levels.length)}</span>
          </div>

          {/* Les paliers : un onglet chacun (et l'atelier s'il a des niveaux). */}
          <div data-gravity-in role="tablist" aria-label={g.pick} className="flex shrink-0 gap-1 rounded-[1.25rem] bg-white/[0.04] p-1">
            {groups.map((item) => {
              const active = item.id === group?.id
              const finished = item.items.filter((level) => progressOf(level)?.completed).length
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    vibrate(6)
                    setTabId(item.id)
                  }}
                  className={`flex min-w-0 flex-1 flex-col items-center rounded-2xl px-1 py-1.5 transition-colors ${active ? 'bg-cream text-void' : 'text-cream/70'}`}
                >
                  <span className="max-w-full truncate text-xs font-bold">{item.label}</span>
                  <span className={`inline-flex items-center gap-0.5 text-[10px] tabular-nums ${active ? 'text-void/60' : 'text-cream/45'}`}>
                    {finished === item.items.length && <Check size={10} strokeWidth={3} aria-hidden />}
                    {g.tierDone(finished, item.items.length)}
                  </span>
                </button>
              )
            })}
          </div>

          {group && group.id !== 'custom' && group.items.some((level) => !progressOf(level)?.completed) && (
            <p data-gravity-in className="-mt-1.5 flex shrink-0 items-center gap-1.5 px-1 text-[11px] text-cream/55">
              <Gift size={12} className="text-gold" aria-hidden />
              {group.id === 'extreme' ? g.tierGiftLegendary : g.tierGift}
            </p>
          )}

          {/* Les cases : un numéro, les rouleaux gagnés, une coche une fois réussi. */}
          {group && (
            <ol className="grid shrink-0 grid-cols-4 gap-x-3 gap-y-6 pt-4" aria-label={group.label}>
              {group.items.map((level, index) => (
                <li key={level.id} data-gravity-in>
                  <LevelTile level={level} rank={index + 1} progress={progressOf(level)} selected={level.id === selected?.id} onSelect={() => setPickedId(level.id)} />
                </li>
              ))}
            </ol>
          )}

          {group && selected && (
            <LevelSheet
              key={selected.id}
              level={selected}
              rank={group.items.indexOf(selected) + 1}
              tier={group.label}
              progress={progressOf(selected)}
              loading={loading === selected.id}
              onPlay={() => onPlay(selected)}
              onDelete={selected.builtin || !onDelete ? undefined : () => onDelete(selected)}
            />
          )}
        </>
      )}

      {/* Premier « Jouer » : le tutoriel est proposé, une seule fois. */}
      {offer &&
        createPortal(
          <div className="fixed inset-0 z-[96] grid place-items-center bg-black/65 px-5" role="dialog" aria-modal="true" aria-label={tt.offerTitle}>
            <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-[1.75rem] border border-[#ff8a6b]/30 bg-[#170c26] p-5 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-[#ffb84d]/15 text-[#ffb84d]">
                <GraduationCap size={28} aria-hidden />
              </span>
              <h2 className="font-display text-2xl leading-none text-cream">{tt.offerTitle}</h2>
              <p className="text-sm leading-relaxed text-cream/70">{tt.offerText}</p>
              <div className="mt-1 flex w-full flex-col gap-2">
                <button type="button" onClick={() => answerOffer(true)} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#ffb84d] text-sm font-bold text-void">
                  <GraduationCap size={17} aria-hidden />
                  {tt.offerYes}
                </button>
                <button type="button" onClick={() => answerOffer(false)} className="h-11 rounded-full border border-white/15 bg-white/[0.05] text-sm font-semibold text-cream/85">
                  {tt.offerNo}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {tutorial && (
        <Suspense fallback={null}>
          <GravityTutorial
            onClose={closeTutorial}
            onPlayLevels={() => {
              closeTutorial()
              go('levels')
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

/** Ce que rapporte le mode, expliqué d'un coup d'œil sur l'accueil. */
function RewardsGuide() {
  const t = useT()
  const r = t.gravity.home.rewards
  return (
    <section data-gravity-in className="shrink-0 rounded-[1.5rem] border border-gold/20 bg-gold/[0.05] p-4">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-gold uppercase">
        <Gift size={14} aria-hidden />
        {r.title}
      </h3>
      <ul className="mt-3 grid grid-cols-4 gap-1.5" aria-label={r.clear}>
        {TIERS.map((tier) => (
          <li key={tier} className="flex flex-col items-center rounded-xl bg-black/25 px-1 py-1.5">
            <span className="max-w-full truncate text-[10px] text-cream/55">{t.gravity.home.tiers[tier]}</span>
            <span className="inline-flex items-center gap-0.5 text-sm font-bold text-gold tabular-nums">
              <Sparkle size={11} className="fill-gold" aria-hidden />
              {CLEAR_STARDUST[tier]}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-2 text-xs text-cream/80">
        <ScrollText size={14} className="shrink-0 text-[#ffd66b]" aria-hidden />
        {r.scrolls}
      </p>
      <p className="mt-1.5 flex items-center gap-2 text-xs text-cream/80">
        <Gift size={14} className="shrink-0 text-gold" aria-hidden />
        {r.tier}
      </p>
      <p className="mt-2 text-[11px] text-cream/45">{r.once}</p>
    </section>
  )
}

/** Les plaquettes des niveaux : papier, liseré, encre des numéros, vermillon du sceau, cordelette. */
const PAPER = '#f4e7c9'
const PAPER_EDGE = '#c7ae7f'
const INK = '#2a1a14'
const VERMILION = '#d2412e'
const TWINE = '#a8916a'
/** La silhouette d'un ema, la plaquette votive des sanctuaires : un rectangle au toit en pointe. */
const EMA = 'polygon(50% 0, 100% 20%, 100% 100%, 0 100%, 0 20%)'

/**
 * Une case de la sélection : un ema suspendu à sa cordelette, le numéro du niveau à l'encre, ses
 * rouleaux, la bande de couleur de son décor, et le sceau vermillon une fois réussi. Choisie, elle
 * se soulève et prend la couleur du décor pour liseré.
 */
function LevelTile({ level, rank, progress, selected, onSelect }: { level: GravityLevelSummary; rank: number; progress: GravityProgress | null; selected: boolean; onSelect: () => void }) {
  const t = useT()
  const theme = THEMES[level.theme] ?? THEMES.konoha
  const percent = progress?.bestPercent ?? 0
  const completed = progress?.completed ?? false
  const scrolls = Math.min(progress?.scrolls ?? 0, level.scrolls)
  return (
    <button
      type="button"
      onClick={() => {
        vibrate(6)
        onSelect()
      }}
      aria-pressed={selected}
      aria-label={t.gravity.home.tile(rank, level.name)}
      className={`relative block aspect-[5/6] w-full transition-transform duration-200 active:scale-95 ${selected ? '-translate-y-1.5' : ''}`}
    >
      {/* Ombre dure, liseré, papier : trois aplats découpés en ema. */}
      <span aria-hidden className="absolute inset-0 translate-y-[3px] bg-black/50" style={{ clipPath: EMA }} />
      <span aria-hidden className="absolute inset-0" style={{ clipPath: EMA, background: selected ? theme.accent : PAPER_EDGE }} />
      <span aria-hidden className={`absolute ${selected ? 'inset-[3px]' : 'inset-[2px]'}`} style={{ clipPath: EMA, background: PAPER }} />
      {/* La bande du décor, en pied de plaquette. */}
      <span aria-hidden className={`absolute h-[13%] ${selected ? 'inset-x-[3px] bottom-[3px]' : 'inset-x-[2px] bottom-[2px]'}`} style={{ background: theme.accent }} />
      {/* La cordelette, jusqu'au trou de la plaquette. */}
      <span aria-hidden className="absolute -top-3 bottom-[85%] left-1/2 w-px -translate-x-1/2" style={{ background: TWINE }} />
      <span aria-hidden className="absolute top-[13%] left-1/2 size-1.5 -translate-x-1/2 rounded-full" style={{ background: INK, opacity: 0.55 }} />

      <span className="absolute inset-x-0 top-[22%] bottom-[13%] flex flex-col items-center justify-center">
        <span className="font-display text-[1.9rem] leading-none" style={{ color: INK }}>
          {rank}
        </span>
        <span className="mt-1 flex h-3 items-center gap-0.5" aria-hidden>
          {!completed && percent > 0 ? (
            <span className="text-[10px] font-bold tabular-nums" style={{ color: INK, opacity: 0.6 }}>
              {percent} %
            </span>
          ) : (
            Array.from({ length: level.scrolls }, (_, index) => <ScrollText key={index} size={10} color={index < scrolls ? VERMILION : INK} opacity={index < scrolls ? 1 : 0.25} />)
          )}
        </span>
      </span>

      {completed && (
        <span aria-hidden className="absolute -right-1.5 -bottom-1.5 grid size-7 -rotate-12 place-items-center rounded-full border-2" style={{ borderColor: VERMILION, color: VERMILION, background: PAPER }}>
          <Check size={14} strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

/** La fiche du niveau choisi : son ema en petit, nom, décor, difficulté, records, ce qu'il reste à gagner, et « Jouer ». */
function LevelSheet({
  level,
  rank,
  tier,
  progress,
  loading,
  onPlay,
  onDelete,
}: {
  level: GravityLevelSummary
  rank: number
  tier: string
  progress: GravityProgress | null
  loading: boolean
  onPlay: () => void
  onDelete?: () => void
}) {
  const t = useT()
  const g = t.gravity.home
  const r = t.gravity.result.reward
  const theme = THEMES[level.theme] ?? THEMES.konoha
  const percent = progress?.bestPercent ?? 0
  const completed = progress?.completed ?? false
  const scrolls = Math.min(progress?.scrolls ?? 0, level.scrolls)
  const prize = CLEAR_STARDUST[tierOf(level.difficulty)]
  // Ce qu'il reste à gagner sur ce niveau (intégré seulement).
  const left = level.builtin ? [...(completed ? [] : [r.clear(prize)]), ...(scrolls < level.scrolls ? [r.scrolls(prize / 2)] : [])] : []
  return (
    <section data-gravity-in className="relative shrink-0 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-3.5">
        <span aria-hidden className="relative h-[3.6rem] w-12 shrink-0" style={{ clipPath: EMA, background: PAPER }}>
          <span className="absolute inset-x-0 top-[22%] bottom-[14%] grid place-items-center font-display text-2xl leading-none" style={{ color: INK }}>
            {rank}
          </span>
          <span className="absolute inset-x-0 bottom-0 h-[14%]" style={{ background: theme.accent }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-cream/55 uppercase">
            {tier} · {g.level(rank)}
          </p>
          <h3 className="truncate font-display text-2xl leading-tight text-cream">{level.name}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-cream/60">
            <span>{g.scenery(t.gravity.themes[level.theme] ?? level.theme)}</span>
            <Difficulty value={level.difficulty} color={theme.accent} />
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <span className="text-[10px] tracking-[0.14em] text-cream/55 uppercase">{g.record}</span>
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${percent}%`, background: theme.accent }} />
        </span>
        <span className="w-10 text-right text-xs font-bold text-cream tabular-nums">{percent} %</span>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-cream/70 tabular-nums">
        <span className="inline-flex items-center gap-1">
          {Array.from({ length: level.scrolls }, (_, index) => (
            <ScrollText key={index} size={13} aria-hidden className={index < scrolls ? 'text-[#ffd66b]' : 'text-white/25'} />
          ))}
          <span className="sr-only">{t.gravity.game.scrolls(scrolls, level.scrolls)}</span>
        </span>
        {progress?.bestTimeMs != null && (
          <span className="inline-flex items-center gap-1">
            <Timer size={12} aria-hidden />
            {formatTime(progress.bestTimeMs)}
          </span>
        )}
        {progress?.fewestDeaths != null && (
          <span className="inline-flex items-center gap-1">
            <Skull size={12} aria-hidden />
            {progress.fewestDeaths}
          </span>
        )}
        {!progress && <span className="text-cream/50">{g.untried}</span>}
      </p>

      {left.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-[11px] text-gold">
          {left.map((line) => (
            <li key={line} className="flex items-center gap-1.5">
              <Sparkle size={10} className="shrink-0 fill-gold" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onPlay}
          disabled={loading}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full font-display text-lg text-void shadow-[0_4px_0_rgba(0,0,0,0.45)] transition-transform active:translate-y-1 active:shadow-none disabled:opacity-60"
          style={{ background: theme.accent }}
        >
          {loading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Play size={18} className="fill-void" aria-hidden />}
          {g.play}
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} aria-label={g.delete(level.name)} className="grid size-12 shrink-0 place-items-center rounded-full bg-white/[0.06] text-cream/60 hover:text-nope">
            <Trash2 size={16} aria-hidden />
          </button>
        )}
      </div>
    </section>
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

/** Ce que la réussite rapporte : des ✦ (première réussite, rouleaux), un booster au bout d'un palier. */
function RewardPanel({ reward }: { reward: GravityReward }) {
  const t = useT()
  const r = t.gravity.result.reward
  const ref = useRef<HTMLDivElement>(null)
  const total = reward.clear + reward.scrolls
  useGSAP(
    () => {
      playChime(true)
      gsap.fromTo('[data-reward-line]', { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, stagger: 0.12, ease: EASE.glide })
      const node = ref.current?.querySelector('[data-reward-total]')
      const counter = { value: 0 }
      if (node && total > 0) gsap.to(counter, { value: total, duration: 0.9, delay: 0.15, ease: 'power2.out', onUpdate: () => void (node.textContent = `+${Math.round(counter.value)}`) })
      gsap.fromTo('[data-reward-gift]', { scale: 0.4, rotation: -12, autoAlpha: 0 }, { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.6, delay: 0.55, ease: EASE.spring })
    },
    { scope: ref },
  )
  const tier = t.gravity.home.tiers[reward.tier]
  return (
    <div ref={ref} className="relative mt-3 rounded-2xl border border-gold/30 bg-gold/[0.08] p-3 text-left">
      <p className="text-[10px] font-semibold tracking-[0.18em] text-gold uppercase">{r.title}</p>
      {total > 0 && (
        <p data-reward-line className="mt-1 flex items-center gap-1.5 font-display text-2xl text-cream">
          <Sparkle size={18} className="fill-gold text-gold" aria-hidden />
          <span data-reward-total className="tabular-nums">
            {`+${total}`}
          </span>
        </p>
      )}
      <ul className="mt-1 flex flex-col gap-0.5 text-xs text-cream/75">
        {reward.clear > 0 && <li data-reward-line>{r.clear(reward.clear)}</li>}
        {reward.scrolls > 0 && <li data-reward-line>{r.scrolls(reward.scrolls)}</li>}
      </ul>
      {reward.tierComplete && (
        <p data-reward-gift className="mt-2 flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2 text-sm font-semibold text-cream">
          <Gift size={18} className="shrink-0 text-gold" aria-hidden />
          {reward.legendaryPacks > 0 ? r.legendary(tier) : r.booster(tier)}
        </p>
      )}
    </div>
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
  result: RunResult
  trial: boolean
  onNext?: () => void
  onReplay: () => void
  onHome: () => void
}) {
  const t = useT()
  const r = t.gravity.result
  const ref = useRef<HTMLDivElement>(null)
  const theme = THEMES[level.theme] ?? THEMES.konoha
  const { run, progress, reward } = result
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
        {reward && !trial && <RewardPanel reward={reward} />}
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
