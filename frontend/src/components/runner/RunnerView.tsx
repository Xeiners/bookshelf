import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Cloud, Gamepad2, Gift, HelpCircle, Loader2, Magnet, Play, RotateCcw, Shirt, Sparkles, Trophy } from 'lucide-react'
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
import { loadRunnerAssets, type RunnerAssets } from './assets'
import { COVER_CELLS, coverAtlas, smallCover } from './covers'
import { HeroPreview } from './HeroPreview'
import { DEFAULT_LOOK, HERO_LOOKS, sourceOf, type HeroLookId } from './looks'
import { RunnerGame, type RunnerOutcome } from './RunnerGame'
import { Wardrobe } from './Wardrobe'
import { WARDROBE_ITEMS } from '../../lib/runner/wardrobe'
import { useRunnerWardrobe } from '../../store/useRunnerWardrobeStore'

/** Réglages du Runner, gardés sur l'appareil. */
interface RunnerPrefs {
  /** Tenue du coureur (cf. `looks.ts`). */
  look: HeroLookId
  buttons: boolean
  lite: boolean
  set: (patch: Partial<Pick<RunnerPrefs, 'look' | 'buttons' | 'lite'>>) => void
}

const modestDevice = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4

/** Tenue gardée sur l'appareil, si elle existe encore (sinon celle par défaut). */
const knownLook = (look: string): HeroLookId => ((HERO_LOOKS as readonly string[]).includes(look) ? (look as HeroLookId) : DEFAULT_LOOK)

const useRunnerPrefs = create<RunnerPrefs>()(
  persist(
    (set) => ({
      look: DEFAULT_LOOK,
      buttons: false,
      lite: modestDevice,
      set: (patch) => set(patch),
    }),
    { name: 'bookshelf:runner:v1', version: 4, partialize: ({ look, buttons, lite }) => ({ look, buttons, lite }), migrate: (persisted) => ({ ...(persisted as object), look: DEFAULT_LOOK }) as RunnerPrefs },
  ),
)

interface Session {
  key: number
  seed: number
  /** Course ouverte côté serveur ; `null` hors ligne (rien n'est enregistré). */
  runId: string | null
}

type Settled = { outcome: RunnerOutcome; result: RunnerResult | null; error: string | null; saving: boolean }

/** Univers du quiz, gardés sur l'appareil : le quiz marche aussi hors-ligne. */
const UNIVERSES_KEY = 'bookshelf:runner:universes'
function readUniverses(): QuizUniverse[] {
  try {
    const stored = JSON.parse(localStorage.getItem(UNIVERSES_KEY) ?? '[]') as unknown
    return Array.isArray(stored) ? (stored as QuizUniverse[]) : []
  } catch {
    return []
  }
}
function saveUniverses(universes: QuizUniverse[]): void {
  try {
    localStorage.setItem(UNIVERSES_KEY, JSON.stringify(universes))
  } catch {
    // Stockage plein ou interdit : le quiz se contentera du réseau.
  }
}

/** Couvertures des tomes géants (œuvres du BookshelfDLE), gardées sur l'appareil elles aussi. */
const COVERS_KEY = 'bookshelf:runner:covers'
function readCovers(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(COVERS_KEY) ?? '[]') as unknown
    return Array.isArray(stored) ? stored.filter((url): url is string => typeof url === 'string') : []
  } catch {
    return []
  }
}

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
  const [universes, setUniverses] = useState<QuizUniverse[]>(readUniverses)
  const [session, setSession] = useState<Session | null>(null)
  /** Modèles 3D (personnages, monstres, décor) : chargés à l'ouverture du Runner. */
  const [assets, setAssets] = useState<RunnerAssets | null>(null)
  const [loading, setLoading] = useState(0)
  const [assetsFailed, setAssetsFailed] = useState(false)
  useEffect(() => {
    let alive = true
    loadRunnerAssets((share) => alive && setLoading(share))
      .then((loaded) => alive && setAssets(loaded))
      .catch(() => alive && setAssetsFailed(true))
    return () => {
      alive = false
    }
  }, [])
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
      const fresh = lists.flatMap((list, index) =>
        list.status === 'fulfilled' && list.value.length > 0
          ? [{ title: t.dle.categories[categories[index]!].title, characters: list.value.slice(0, 40).map((work) => ({ name: work.name, image: work.imageUrl })) }]
          : [],
      )
      // Hors-ligne (ou serveur injoignable) : on garde les univers déjà connus.
      if (fresh.length === 0) return
      setUniverses(fresh)
      saveUniverses(fresh)
    })
    return () => controller.abort()
  }, [t])

  // Couvertures manga des tomes géants et des publicités des trains : téléchargées dès
  // l'entrée (petite taille), d'abord celles déjà connues (en cache, même hors-ligne).
  useEffect(() => {
    coverAtlas().load(readCovers())
    const controller = new AbortController()
    dleApi
      .works('manga', controller.signal)
      .then((works) => {
        const urls = works
          .filter((work) => work.imageUrl)
          .slice(0, COVER_CELLS)
          .map((work) => smallCover(work.imageUrl))
        if (urls.length === 0) return
        coverAtlas().load(urls)
        try {
          localStorage.setItem(COVERS_KEY, JSON.stringify(urls))
        } catch {
          // Stockage plein : les couvertures seront retéléchargées.
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

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
        <RunnerHome overview={overview} starting={starting} onStart={() => void start()} assets={assets} loading={assetsFailed ? null : loading} />
      ) : (
        <div className="grid flex-1 place-items-center pb-16">
          <Loader2 size={26} className="animate-spin text-glow" aria-hidden />
        </div>
      )}

      {session &&
        assets &&
        createPortal(
          <>
            <RunnerGame
              key={session.key}
              seed={session.seed}
              look={knownLook(prefs.look)}
              assets={assets}
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

function RunnerHome({
  overview,
  starting,
  onStart,
  assets,
  loading,
}: {
  overview: RunnerOverview | null
  starting: boolean
  onStart: () => void
  assets: RunnerAssets | null
  /** Part des modèles chargés (0 à 1) ; `null` : échec du chargement. */
  loading: number | null
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const prefs = useRunnerPrefs()
  const signedIn = useAuthStore((state) => state.user !== null)
  const outfit = useRunnerWardrobe((state) => state.outfit)
  const wardrobe = useRunnerWardrobe((state) => state.view)
  const loadWardrobe = useRunnerWardrobe((state) => state.load)
  const [dressing, setDressing] = useState<{ box: boolean } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const me = overview?.me
  const look = knownLook(prefs.look)
  const owned = wardrobe ? Object.keys(wardrobe.owned).length : 0
  const freeAt = wardrobe?.freeAt ? Date.parse(wardrobe.freeAt) : null
  const freeReady = wardrobe !== null && (freeAt === null || freeAt <= now)

  useEffect(() => {
    if (signedIn) void loadWardrobe()
  }, [signedIn, loadWardrobe])
  // Compte à rebours de la boîte gratuite (à la minute suffit ici).
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useGSAP(
    () => {
      gsap.fromTo('[data-runner-in]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.06, ease: EASE.glide })
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.to('[data-home-box]', { y: -4, rotation: -3, duration: 0.9, ease: 'sine.inOut', repeat: -1, yoyo: true })
        gsap.fromTo('[data-home-sleepers]', { backgroundPositionY: '0px' }, { backgroundPositionY: '36px', duration: 0.45, ease: 'none', repeat: -1 })
      }
    },
    { scope: ref },
  )

  const openDressing = (box: boolean) => {
    vibrate(8)
    // La garde-robe habille l'aventurier.
    if (look !== 'adventurer') prefs.set({ look: 'adventurer' })
    setDressing({ box })
  }

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-28">
      {/* La scène : ciel du soir, voie qui file, le coureur en 3D ; tout se joue d'ici. */}
      <section data-runner-in className="relative shrink-0 overflow-hidden rounded-[1.75rem] border border-[#ff6fb5]/30 bg-[#140a2e]">
        <div className="relative h-[46vh] max-h-[26rem] min-h-72 overflow-hidden" style={{ background: 'linear-gradient(180deg, #5b3aa8 0%, #b06ad0 38%, #ffb2c8 62%, #ffd9b8 70%, #2a1650 70.5%, #1a0d33 100%)' }}>
          <span aria-hidden className="absolute top-[34%] left-1/2 size-28 -translate-x-1/2 rounded-full" style={{ background: 'radial-gradient(circle, #fff3c4 0%, #ffd27a 45%, transparent 70%)' }} />
          <span
            aria-hidden
            className="absolute inset-x-0 top-[52%] h-[18%]"
            style={{ background: '#3b2270', clipPath: 'polygon(0 100%, 0 55%, 12% 30%, 22% 52%, 34% 18%, 46% 48%, 55% 30%, 63% 46%, 74% 10%, 86% 44%, 94% 32%, 100% 50%, 100% 100%)' }}
          />
          {/* Voie : trois couloirs en perspective, traverses qui défilent. */}
          <span
            aria-hidden
            data-home-sleepers
            className="absolute inset-x-0 bottom-0 h-[30%]"
            style={{
              clipPath: 'polygon(44% 0, 56% 0, 100% 100%, 0 100%)',
              backgroundColor: '#2a1650',
              backgroundImage: 'linear-gradient(0deg, rgba(255,255,255,0.12) 30%, transparent 30%)',
              backgroundSize: '100% 36px',
            }}
          />
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[30%]"
            style={{ background: 'linear-gradient(90deg, transparent 32.5%, #ff6fb5 32.5%, #ff6fb5 33.5%, transparent 33.5%, transparent 66.5%, #ff6fb5 66.5%, #ff6fb5 67.5%, transparent 67.5%)', clipPath: 'polygon(44% 0, 56% 0, 100% 100%, 0 100%)', opacity: 0.7 }}
          />
          <HeroPreview look={look} assets={dressing ? null : assets} outfit={outfit} className="absolute inset-0" />

          {/* Titre et choix du coureur. */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-4">
            <div className="min-w-0">
              <h2 className="font-display text-[1.7rem] leading-none text-white drop-shadow-[0_2px_10px_rgba(40,0,80,0.6)]">{t.runner.title}</h2>
              <p className="mt-1 max-w-[15rem] text-[11px] leading-snug text-white/80">{t.runner.home.tagline}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5" role="radiogroup" aria-label={t.runner.home.pick}>
              {HERO_LOOKS.map((option) => {
                const active = look === option
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => prefs.set({ look: option })}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold backdrop-blur-sm transition-colors ${active ? 'bg-white text-[#2a1150]' : 'bg-black/30 text-white/80'}`}
                  >
                    {t.runner.looks[option]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Garde-robe et boîte mystère. */}
          {sourceOf(look).kind === 'vrm' || signedIn ? (
            <div className="absolute bottom-3 left-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => openDressing(false)}
                className="flex items-center gap-2 rounded-2xl border border-white/20 bg-black/40 py-1.5 pr-3 pl-1.5 text-left backdrop-blur-md"
              >
                <span className="grid size-9 place-items-center rounded-xl text-white" style={{ background: 'linear-gradient(135deg, #ff6fb5, #b05cff)' }}>
                  <Shirt size={18} aria-hidden />
                </span>
                <span>
                  <span className="block text-xs font-bold text-white">{t.runner.wardrobe.open}</span>
                  <span className="block text-[10px] text-white/70 tabular-nums">{t.runner.wardrobe.collection(owned, WARDROBE_ITEMS.length)}</span>
                </span>
              </button>
              {signedIn && (
                <button
                  type="button"
                  onClick={() => openDressing(true)}
                  className="flex items-center gap-2 rounded-2xl border bg-black/40 py-1.5 pr-3 pl-1.5 text-left backdrop-blur-md"
                  style={{ borderColor: freeReady ? '#ffd35c' : 'rgba(255,255,255,0.2)', boxShadow: freeReady ? '0 0 22px -4px #ffc23a' : undefined }}
                >
                  <span data-home-box className="relative grid size-9 place-items-center rounded-xl will-change-transform" style={{ background: 'linear-gradient(160deg, #5a24a8, #2a1150)', boxShadow: 'inset 0 0 0 2px #ffc93c' }}>
                    <span className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 bg-[#ffc93c]" />
                    <Gift size={16} className="relative text-[#ffe9a8]" aria-hidden />
                    {freeReady && <span className="absolute -top-1 -right-1 size-2.5 animate-ping rounded-full bg-like" />}
                  </span>
                  <span>
                    <span className="block text-xs font-bold text-white">{t.runner.wardrobe.box.title}</span>
                    <span className={`block text-[10px] tabular-nums ${freeReady ? 'font-bold text-gold' : 'text-white/70'}`}>
                      {freeReady ? t.runner.wardrobe.box.freeReady : freeAt ? t.runner.wardrobe.box.freeIn(shortCountdown(freeAt - now)) : '…'}
                    </span>
                  </span>
                </button>
              )}
            </div>
          ) : null}
        </div>

        <div className="relative p-4">
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t.runner.home.best} value={me ? me.best.toLocaleString() : '—'} />
            <Stat label={t.runner.over.distance} value={me ? `${me.bestDistance.toLocaleString()} m` : '—'} />
            <Stat label={t.runner.home.todayShort} value={overview ? `${overview.me.earnedToday}/${overview.dailyCap}` : '—'} />
          </div>
          <button
            type="button"
            onClick={onStart}
            disabled={starting || !assets}
            className="relative mt-3 inline-flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-full text-base font-bold text-void shadow-[0_0_30px_rgba(255,111,181,0.45)] transition-transform active:scale-[0.98] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #ffd35c, #ff6fb5 60%, #c58bff)' }}
          >
            {starting || !assets ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Play size={20} className="fill-void" aria-hidden />}
            {assets ? t.runner.home.play : loading === null ? t.runner.home.loadFailed : t.runner.home.loading(Math.round(loading * 100))}
          </button>
          {overview && <p className="mt-2 text-center text-[11px] text-cream/50">{t.runner.home.games(overview.me.games)}</p>}
          {!signedIn && <p className="mt-2 text-[11px] leading-relaxed text-cream/55">{t.runner.home.guest}</p>}
          {sourceOf(look).kind === 'vrm' && <p className="mt-2 text-center text-[10px] text-cream/35">{t.runner.home.modelCredit}</p>}
        </div>
      </section>

      {/* Commandes, bonus et réglages : repliés, pour laisser la place au jeu. */}
      <details data-runner-in className="group shrink-0 rounded-[1.5rem] border border-white/8 bg-white/[0.03]">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">
          <Gamepad2 size={14} aria-hidden />
          <span className="flex-1">{t.runner.home.howTo}</span>
          <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="flex flex-col gap-2 px-4 pb-4 text-sm text-cream/75">
          <p>{t.runner.home.swipe}</p>
          <p className="text-cream/55">{t.runner.home.keys}</p>
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
          <div className="mt-2 flex flex-col gap-2 border-t border-white/8 pt-3">
            <Toggle label={t.runner.home.buttons} hint={t.runner.home.buttonsHint} checked={prefs.buttons} onChange={(buttons) => prefs.set({ buttons })} />
            <Toggle label={t.runner.home.lite} hint={t.runner.home.liteHint} checked={prefs.lite} onChange={(lite) => prefs.set({ lite })} />
          </div>
        </div>
      </details>

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

      {dressing && <Wardrobe assets={assets} openBox={dressing.box} onClose={() => setDressing(null)} />}
    </div>
  )
}

/** Compte à rebours court : « 5 h 12 » ou « 12 min ». */
function shortCountdown(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`
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
