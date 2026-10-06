import { useEffect, useRef, useState } from 'react'
import { Check, Crown, Flame, Heart, Loader2, LogOut, Play, RotateCcw, Share2, Sparkle, Timer, Users, X } from 'lucide-react'
import { useCountUp } from '../../hooks/useCountUp'
import { useNow } from '../../hooks/useNow'
import { useLanguage, useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { displayRoomCode } from '../../lib/dle'
import { coopLink, flameLevel, formatHlValue } from '../../lib/higherLower'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playChime, playClockTick, playHlOver, playHlPress, playHlRight, playHlSelect, playHlStart, playHlTier, playHlWrong, playJoin, playLeave } from '../../lib/sfx'
import { HL_METRICS, type CoopPlayer, type CoopTurn, type CoopView, type HlCard as HlCardData, type HlChoice, type HlMetric } from '../../services/higherLowerApi'
import { hlSound, useHigherLowerStore, useStardustBalance } from '../../store/useHigherLowerStore'
import { useHlCoopStore } from '../../store/useHlCoopStore'
import { useUiStore } from '../../store/useUiStore'
import { DleBar } from '../dle/DleBar'
import { StardustBadge } from '../dle/StardustBadge'
import { CardAvatar } from '../profile/CardAvatar'
import { HlCard } from './HlCard'
import { MetricIcon } from './MetricIcon'
import { SoundToggle } from './SoundToggle'
import { HL_DOWN, HL_GRADIENT, HL_UP, METRIC_STYLE } from './hlStyle'
import { inkText } from '../../lib/ink'

/** Couleur de la flamme selon la série (comme en solo). */
const FLAME_COLORS = ['#ffc46b', '#ff8a3d', '#ff5e8a', '#c86bff'] as const
/** Le tic-tac commence dans les dernières secondes de mon tour. */
const TICK_FROM_S = 5

const nameOf = (player: CoopPlayer | undefined, fallback: string) => player?.name?.trim() || fallback

/**
 * Higher or Lower en COOP : salon d'attente, partie tour par tour (chances communes),
 * bilan. Le salon est suivi en attente longue tant que l'écran est ouvert.
 */
export function HlCoop({ room }: { room: CoopView }) {
  const watch = useHlCoopStore((state) => state.watch)
  // La partie reste à l'écran le temps de rejouer la dernière réponse, même si le bilan est déjà là.
  const [inGame, setInGame] = useState(room.phase === 'playing')
  const [phase, setPhase] = useState(room.phase)
  if (phase !== room.phase) {
    // Ajusté pendant le rendu (et non dans un effet) : aucune image intermédiaire.
    setPhase(room.phase)
    if (room.phase === 'playing') setInGame(true)
    if (room.phase === 'lobby') setInGame(false)
  }

  useEffect(() => watch(), [room.code, watch])

  if (room.phase === 'lobby') return <CoopLobby room={room} />
  if (inGame && room.current) return <CoopPlay room={room} onOver={() => setInGame(false)} />
  return <CoopResults room={room} />
}

/* ---- Salon d'attente ---------------------------------------------------------------- */

function useShare(code: string) {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  return async () => {
    vibrate(6)
    const url = coopLink(code, window.location.origin, window.location.pathname)
    try {
      await navigator.clipboard.writeText(url)
      notify(t.hl.coop.copied, 'like')
    } catch {
      // Presse-papiers refusé : le lien s'affiche, à copier à la main.
      notify(url, 'neutral')
    }
  }
}

/** Un « pop » quand quelqu'un entre ou sort (pas pour soi-même). */
function useRosterSounds(room: CoopView) {
  const roster = room.players
    .filter((player) => !player.left)
    .map((player) => player.id)
    .join('|')
  const before = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = new Set(roster ? roster.split('|') : [])
    const previous = before.current
    before.current = ids
    if (!previous) return
    if ([...ids].some((id) => !previous.has(id) && id !== room.you)) hlSound(playJoin)
    else if ([...previous].some((id) => !ids.has(id) && id !== room.you)) hlSound(playLeave)
  }, [roster, room.you])
}

function CoopLobby({ room }: { room: CoopView }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const leave = useHlCoopStore((state) => state.leave)
  const start = useHlCoopStore((state) => state.start)
  const setMetric = useHlCoopStore((state) => state.setMetric)
  const notify = useUiStore((state) => state.notify)
  const [starting, setStarting] = useState(false)
  const share = useShare(room.code)
  const isHost = room.hostId === room.you
  const players = room.players.filter((player) => !player.left)
  const enough = players.length >= room.minPlayers
  useRosterSounds(room)

  useGSAP(
    () => {
      gsap.fromTo('[data-coop-in]', { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.55, stagger: 0.07, ease: EASE.glide })
    },
    { scope: rootRef },
  )

  const go = async () => {
    vibrate(12)
    hlSound(playHlStart)
    setStarting(true)
    try {
      await start()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <DleBar label={t.hl.coop.leave} onBack={() => void leave()}>
        <SoundToggle />
      </DleBar>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-12">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 pt-2 text-center">
          <div data-coop-in className="flex flex-col items-center gap-2">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.28em] text-cream/55 uppercase">
              <Users size={13} aria-hidden />
              {t.hl.coop.lobby}
            </p>
            <p className="font-display text-5xl tracking-[0.08em] tabular-nums" style={inkText(HL_GRADIENT)} aria-label={`${t.hl.coop.code} ${room.code}`}>
              {displayRoomCode(room.code)}
            </p>
            <button
              type="button"
              onClick={() => void share()}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-cream transition-transform active:scale-95"
            >
              <Share2 size={14} aria-hidden />
              {t.hl.coop.share}
            </button>
          </div>

          {/* Les joueurs, dans l'ordre où ils joueront. */}
          <div data-coop-in className="w-full">
            <p className="mb-2 text-[11px] tracking-[0.18em] text-cream/45 uppercase tabular-nums">{t.hl.coop.players(players.length, room.maxPlayers)}</p>
            <ul className="grid grid-cols-3 gap-2">
              {players.map((player, index) => (
                <li key={player.id} className="flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-3">
                  <span className="relative">
                    <CardAvatar card={player.avatar} avatarUrl={player.avatarUrl} initial={nameOf(player, '?').charAt(0).toUpperCase()} size={44} />
                    {player.id === room.hostId && (
                      <span className="absolute -top-2 -right-1.5 grid size-5 place-items-center rounded-full bg-gold text-void shadow-[0_0_0_2px_#06060a]" title={t.hl.coop.host}>
                        <Crown size={11} aria-hidden />
                      </span>
                    )}
                  </span>
                  <span className="w-full truncate text-xs font-semibold text-cream">{player.id === room.you ? t.hl.coop.you : nameOf(player, t.hl.leaderboard.anonymous)}</span>
                  <span className="text-[10px] text-cream/40 tabular-nums">#{index + 1}</span>
                </li>
              ))}
              {Array.from({ length: Math.max(0, 3 - (players.length % 3 || 3)) }, (_, index) => (
                <li key={`free-${index}`} aria-hidden className="rounded-2xl border border-dashed border-white/10" />
              ))}
            </ul>
          </div>

          <MetricPicker metric={room.metric} editable={isHost} onPick={(metric) => setMetric(metric).catch((error: unknown) => notify(apiErrorMessage(error, t), 'nope'))} />

          <p data-coop-in className="text-xs leading-relaxed text-cream/55">
            {t.hl.coop.rules(room.maxLives)}
          </p>

          <div data-coop-in className="flex w-full flex-col items-center gap-2">
            {isHost ? (
              <>
                <button
                  type="button"
                  onClick={() => void go()}
                  disabled={!enough || starting}
                  className="relative inline-flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl text-base font-bold tracking-[0.1em] text-[#140c1f] uppercase transition-transform active:scale-[0.97] disabled:opacity-50"
                  style={{ background: METRIC_STYLE[room.metric].gradient, boxShadow: `0 14px 34px -14px ${METRIC_STYLE[room.metric].glow}, inset 0 1px 0 rgba(255,255,255,0.6)` }}
                >
                  {starting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Play size={17} className="fill-current" aria-hidden />}
                  {t.hl.coop.start}
                </button>
                {!enough && <p className="text-xs text-cream/50">{t.hl.coop.needPlayers}</p>}
              </>
            ) : (
              <p className="inline-flex items-center gap-2 text-sm text-cream/60">
                <Loader2 size={15} className="animate-spin" aria-hidden />
                {t.hl.coop.waitHost}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Le terrain de la partie : l'hôte choisit, les autres voient. */
function MetricPicker({ metric, editable, onPick }: { metric: HlMetric; editable: boolean; onPick: (metric: HlMetric) => void }) {
  const t = useT()
  return (
    <div data-coop-in role="radiogroup" aria-label={t.hl.coop.metric} className="grid w-full grid-cols-4 gap-2">
      {HL_METRICS.map((key) => {
        const chosen = key === metric
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={chosen}
            disabled={!editable}
            onClick={() => {
              if (key === metric) return
              vibrate(6)
              hlSound(playHlSelect)
              onPick(key)
            }}
            className="flex flex-col items-center gap-1.5 rounded-2xl py-2.5 transition-[transform,background-color] enabled:active:scale-95 disabled:cursor-default"
            style={chosen ? { background: `radial-gradient(circle at 50% 0%, ${METRIC_STYLE[key].glow}, rgba(255,255,255,0.04) 75%)` } : undefined}
          >
            <span
              className="grid size-9 place-items-center rounded-full"
              style={chosen ? { background: METRIC_STYLE[key].gradient, color: '#140c1f' } : { background: 'rgba(255,255,255,0.06)', color: 'rgba(247,245,240,0.55)' }}
            >
              <MetricIcon metric={key} size={17} />
            </span>
            <span className={`text-[11px] font-semibold ${chosen ? 'text-cream' : 'text-cream/45'}`}>{t.hl.metrics[key].title}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ---- Partie ----------------------------------------------------------------------- */

interface Shown {
  turn: number
  current: HlCardData
  next: HlCardData
  streak: number
  lives: number
}

const snapshot = (room: CoopView): Shown | null =>
  room.current && room.next ? { turn: room.turn, current: room.current, next: room.next, streak: room.streak, lives: room.lives } : null

/**
 * Un tour : le joueur actif répond (les autres le voient réfléchir, chrono à l'appui) ;
 * à la réponse, chacun voit la valeur défiler, le verdict, puis les cartes suivantes.
 * L'écran montre un état « figé » (`shown`) et ne le remplace par celui du serveur
 * qu'une fois la révélation jouée.
 */
function CoopPlay({ room, onOver }: { room: CoopView; onOver: () => void }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const offset = useHlCoopStore((state) => state.offset)
  const guess = useHlCoopStore((state) => state.guess)
  const leave = useHlCoopStore((state) => state.leave)
  const notify = useUiStore((state) => state.notify)
  const tiers = useHigherLowerStore((state) => state.overview?.tiers ?? [])
  const [shown, setShown] = useState<Shown | null>(() => snapshot(room))
  const [reveal, setReveal] = useState<CoopTurn | null>(null)
  const [verdict, setVerdict] = useState<'right' | 'wrong' | null>(null)
  const [sending, setSending] = useState(false)
  const now = useNow(true, 200)
  const { contextSafe } = useGSAP({ scope: rootRef })
  const players = new Map(room.players.map((player) => [player.id, player]))

  // Le serveur a avancé : on rejoue la réponse du tour affiché, ou (tours manqués) on rattrape.
  // Ajusté pendant le rendu ; seul le passage au bilan (état du parent) attend un effet.
  const moved = !reveal && shown !== null && (room.turn !== shown.turn || room.phase === 'results')
  const replay = moved && room.last !== null && room.last.turn === shown?.turn ? room.last : null
  const missedOver = moved && !replay && room.phase === 'results'
  if (moved && replay) setReveal(replay)
  else if (moved && !missedOver) setShown(snapshot(room))
  useEffect(() => {
    if (missedOver) onOver()
  }, [missedOver, onOver])

  // Nouvelles cartes : elles entrent en scène.
  useGSAP(
    () => {
      gsap.fromTo('[data-coop-card]', { y: 24, autoAlpha: 0, scale: 0.96 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.5, stagger: 0.08, ease: EASE.glide })
    },
    { scope: rootRef, dependencies: [shown?.turn] },
  )

  const serverNow = now + offset
  const startsAt = room.turnStartsAt ? Date.parse(room.turnStartsAt) : 0
  const endsAt = room.turnEndsAt ? Date.parse(room.turnEndsAt) : 0
  const settled = !reveal && shown !== null && room.phase === 'playing' && room.turn === shown.turn
  const myTurn = settled && room.active === room.you
  const open = settled && serverNow >= startsAt
  const canAnswer = myTurn && open && !sending
  const secondsLeft = Math.max(0, Math.ceil((endsAt - serverNow) / 1000))
  const active = room.active ? players.get(room.active) : undefined
  const activeName = room.active === room.you ? t.hl.coop.you : nameOf(active, t.hl.leaderboard.anonymous)

  // Mon tour arrive : un carillon et une vibration.
  const announced = useRef<number | null>(null)
  useEffect(() => {
    if (!myTurn || !open || announced.current === room.turn) return
    announced.current = room.turn
    vibrate([12, 40, 12])
    hlSound(() => playChime(true))
  }, [myTurn, open, room.turn])

  // Mes dernières secondes : tic-tac.
  const lastTick = useRef<number | null>(null)
  useEffect(() => {
    if (!canAnswer || secondsLeft > TICK_FROM_S || secondsLeft === 0 || lastTick.current === secondsLeft) return
    lastTick.current = secondsLeft
    hlSound(() => playClockTick(secondsLeft <= 2))
  }, [canAnswer, secondsLeft])

  const choose = (choice: HlChoice) => {
    if (!canAnswer) return
    vibrate(10)
    hlSound(() => playHlPress(choice))
    setSending(true)
    guess(choice)
      .catch((error: unknown) => notify(apiErrorMessage(error, t), 'nope'))
      .finally(() => setSending(false))
  }

  // Au clavier, à mon tour : ↑ plus haut, ↓ plus bas.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      choose(event.key === 'ArrowUp' ? 'higher' : 'lower')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** Valeur dévoilée : verdict pour tout le monde, puis les cartes suivantes (ou le bilan). */
  const onRevealed = contextSafe(() => {
    if (!reveal || !shown) return
    const right = reveal.correct
    setVerdict(right ? 'right' : 'wrong')
    if (right) {
      vibrate([8, 40, 14])
      hlSound(() => playHlRight(shown.streak + 1))
      if (tiers.some((tier) => tier.streak === shown.streak + 1)) gsap.delayedCall(0.3, () => hlSound(playHlTier))
      gsap.fromTo('[data-coop-slot="1"] [data-hl-flash]', { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.9, ease: 'power2.out' })
    } else {
      vibrate([30, 60, 30])
      hlSound(playHlWrong)
      gsap.fromTo('[data-coop-slot="1"] [data-hl-flash]', { autoAlpha: 1 }, { autoAlpha: 0.4, duration: 1.1 })
      gsap.to('[data-coop-slot="1"]', { keyframes: { x: [0, -12, 11, -8, 6, -3, 0] }, duration: 0.5, ease: 'power1.inOut' })
      gsap.fromTo(`[data-coop-heart="${Math.max(0, shown.lives - 1)}"]`, { scale: 1.8, rotation: -25 }, { scale: 1, rotation: 0, duration: 0.6, ease: EASE.snap })
    }
    gsap.fromTo('[data-coop-orb]', { scale: 1.35 }, { scale: 1, duration: 0.6, ease: EASE.snap })
    gsap.delayedCall(right ? 1.2 : 1.6, () => {
      const latest = useHlCoopStore.getState().room
      setVerdict(null)
      setReveal(null)
      if (!latest || latest.phase !== 'playing') onOver()
      else setShown(snapshot(latest))
    })
  })

  if (!shown) return null
  // Pendant la révélation, série et chances restent celles d'avant la réponse, puis basculent au verdict.
  const streak = verdict === 'right' ? shown.streak + 1 : shown.streak
  const lives = verdict === 'wrong' ? Math.max(0, shown.lives - 1) : shown.lives
  const level = flameLevel(streak)
  const metric = room.metric
  const by = reveal ? players.get(reveal.by) : undefined
  const byName = reveal?.by === room.you ? t.hl.coop.you : nameOf(by, t.hl.leaderboard.anonymous)
  const status = reveal
    ? verdict === null
      ? t.hl.coop.thinking(byName)
      : reveal.choice === null
        ? t.hl.coop.timeout(byName)
        : reveal.correct
          ? t.hl.coop.right(byName)
          : t.hl.coop.wrong(byName)
    : myTurn
      ? t.hl.coop.yourTurn
      : t.hl.coop.turnOf(activeName)

  const waiting =
    myTurn && open ? undefined : (
      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/55 px-3.5 py-2 text-xs font-semibold text-cream/80">
        {active && <CardAvatar card={active.avatar} avatarUrl={active.avatarUrl} initial={nameOf(active, '?').charAt(0).toUpperCase()} size={22} />}
        {reveal ? byName : myTurn ? t.hl.coop.yourTurn : t.hl.coop.thinking(activeName)}
      </span>
    )

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <DleBar label={t.hl.coop.leave} onBack={() => void leave()}>
        <SoundToggle />
        <span className="inline-flex items-center gap-0.5" aria-label={t.hl.coop.livesAria(lives)}>
          {Array.from({ length: room.maxLives }, (_, index) => (
            <span key={index} data-coop-heart={index} className="grid will-change-transform">
              <Heart size={16} className={index < lives ? 'fill-[#ff5e8a] text-[#ff5e8a]' : 'text-cream/25'} aria-hidden />
            </span>
          ))}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border bg-black/50 px-3 py-1 text-sm font-semibold tabular-nums"
          style={{ borderColor: `${FLAME_COLORS[level]}66`, color: FLAME_COLORS[level] }}
          aria-label={`${t.hl.streak} ${streak}`}
        >
          <Flame size={15} className={level > 0 ? 'fill-current' : ''} aria-hidden />
          {streak}
        </span>
      </DleBar>

      {/* À qui le tour : l'ordre de passage, le joueur actif mis en avant, et son chrono. */}
      <div className="mx-auto flex w-full max-w-5xl shrink-0 flex-col gap-2 px-5 pb-3">
        <ul className="no-scrollbar flex items-center gap-2 overflow-x-auto">
          {room.order.map((id) => {
            const player = players.get(id)
            if (!player) return null
            const current = id === (reveal ? reveal.by : room.active)
            return (
              <li
                key={id}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 text-[11px] font-semibold transition-colors ${current ? 'border-[#5ef2c2]/60 bg-[#5ef2c2]/10 text-cream' : 'border-white/10 text-cream/55'}`}
                style={{ opacity: player.left ? 0.4 : 1 }}
              >
                <CardAvatar card={player.avatar} avatarUrl={player.avatarUrl} initial={nameOf(player, '?').charAt(0).toUpperCase()} size={22} />
                <span className="max-w-[6rem] truncate">{id === room.you ? t.hl.coop.you : nameOf(player, t.hl.leaderboard.anonymous)}</span>
                <span className="text-cream/45 tabular-nums">{player.correct}</span>
              </li>
            )
          })}
        </ul>
        <div className="flex items-center gap-3">
          <p className={`min-w-0 flex-1 truncate text-sm font-semibold ${myTurn && !reveal ? 'text-[#5ef2c2]' : 'text-cream/80'}`} aria-live="polite">
            {status}
          </p>
          {settled && open && (
            <span className={`inline-flex shrink-0 items-center gap-1 font-mono text-sm tabular-nums ${secondsLeft <= TICK_FROM_S ? 'animate-pulse text-nope' : 'text-cream/70'}`}>
              <Timer size={14} aria-hidden />
              {t.hl.coop.timeLeft(secondsLeft)}
            </span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
          {settled && open && (
            <TurnBar key={room.turn} endsAt={endsAt} total={endsAt - startsAt} offset={offset} urgent={secondsLeft <= TICK_FROM_S} />
          )}
        </div>
      </div>

      <div className="relative mx-auto grid min-h-0 w-full max-w-5xl flex-1 grid-rows-2 gap-3 px-4 pb-4 md:grid-cols-2 md:grid-rows-1 md:gap-6 md:px-6 md:pb-6">
        <div key={`a-${shown.turn}`} data-coop-card data-coop-slot={0} className="row-start-1 col-start-1 min-h-0 will-change-transform">
          <HlCard card={shown.current} metric={metric} role="current" />
        </div>
        <div key={`b-${shown.turn}`} data-coop-card data-coop-slot={1} className="row-start-2 col-start-1 min-h-0 will-change-transform md:row-start-1 md:col-start-2">
          <HlCard
            card={shown.next}
            metric={metric}
            role="next"
            revealed={reveal ? reveal.guessed.value : null}
            onRevealed={onRevealed}
            verdict={verdict}
            onChoose={choose}
            disabled={!canAnswer}
            waiting={waiting}
          />
        </div>

        <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <div
            data-coop-orb
            className="grid size-16 place-items-center rounded-full border-2 md:size-20"
            style={{
              borderColor: verdict === 'right' ? HL_UP.color : verdict === 'wrong' ? HL_DOWN.color : 'rgba(255,255,255,0.25)',
              background:
                verdict === 'right'
                  ? `radial-gradient(circle at 50% 35%, ${HL_UP.glow}, #06110d 70%)`
                  : verdict === 'wrong'
                    ? `radial-gradient(circle at 50% 35%, ${HL_DOWN.glow}, #14060b 70%)`
                    : 'radial-gradient(circle at 50% 35%, rgba(124,92,255,0.45), #08080f 70%)',
              boxShadow: '0 0 0 6px #050508',
            }}
          >
            {verdict === 'right' ? (
              <Check size={30} strokeWidth={3} style={{ color: HL_UP.color }} aria-label={t.hl.right} />
            ) : verdict === 'wrong' ? (
              <X size={30} strokeWidth={3} style={{ color: HL_DOWN.color }} aria-label={t.hl.wrong} />
            ) : (
              <span className="font-display text-xl md:text-2xl" style={inkText(HL_GRADIENT)}>
                {t.hl.vs}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Chrono du tour : une barre qui se vide d'un seul tween linéaire. */
function TurnBar({ endsAt, total, offset, urgent }: { endsAt: number; total: number; offset: number; urgent: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      const remaining = Math.max(0, endsAt - (Date.now() + offset))
      gsap.fromTo(ref.current, { scaleX: Math.min(1, remaining / Math.max(1, total)) }, { scaleX: 0, duration: remaining / 1000, ease: 'none' })
    },
    { dependencies: [endsAt] },
  )
  return (
    <div
      ref={ref}
      className="h-full origin-left rounded-full will-change-transform"
      style={{ background: urgent ? 'linear-gradient(90deg, #ff5c7a, #ffc46b)' : HL_GRADIENT }}
    />
  )
}

/* ---- Bilan ---------------------------------------------------------------------------- */

function CoopResults({ room }: { room: CoopView }) {
  const t = useT()
  const locale = useLanguage()
  const rootRef = useRef<HTMLDivElement>(null)
  const leave = useHlCoopStore((state) => state.leave)
  const start = useHlCoopStore((state) => state.start)
  const setMetric = useHlCoopStore((state) => state.setMetric)
  const notify = useUiStore((state) => state.notify)
  const tiers = useHigherLowerStore((state) => state.overview?.tiers ?? [])
  const balance = useStardustBalance()
  const [starting, setStarting] = useState(false)
  const result = room.result
  const streak = result?.streak ?? room.streak
  const scoreRef = useCountUp(streak, { duration: 1, delay: 0.35 })
  const isHost = room.hostId === room.you
  const reward = result?.reward ?? 0
  const missing = tiers[0] ? tiers[0].streak - streak : 0
  const last = room.last
  useRosterSounds(room)

  useGSAP(
    () => {
      gsap.fromTo('[data-coop-in]', { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.08, ease: EASE.glide })
      gsap.fromTo('[data-coop-score]', { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.8, ease: EASE.spring, delay: 0.15 })
      gsap.delayedCall(0.3, () => hlSound(playHlOver))
      if (reward > 0) gsap.delayedCall(1, () => hlSound(playHlTier))
    },
    { scope: rootRef },
  )

  const again = async () => {
    vibrate(12)
    hlSound(playHlStart)
    setStarting(true)
    try {
      await start()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setStarting(false)
    }
  }

  const ranked = [...room.players].filter((player) => room.order.includes(player.id)).sort((a, b) => b.correct - a.correct || a.misses - b.misses)
  const nextHigher = last && last.guessed.value !== null && last.current.value !== null ? last.guessed.value > last.current.value : null

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <DleBar label={t.hl.coop.leave} onBack={() => void leave()}>
        <SoundToggle />
        <StardustBadge balance={balance} />
      </DleBar>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 pt-2 text-center">
          <p data-coop-in className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.28em] uppercase" style={{ color: METRIC_STYLE[room.metric].accent }}>
            <Users size={13} aria-hidden />
            {t.hl.coop.over}
          </p>

          <div className="relative grid size-48 place-items-center">
            <div aria-hidden className="absolute inset-8 rounded-full" style={{ background: `radial-gradient(closest-side, ${METRIC_STYLE[room.metric].glow}, transparent)` }} />
            <div data-coop-score className="relative flex flex-col items-center">
              <span className="font-display text-[6rem] leading-none tabular-nums" style={inkText(HL_GRADIENT)}>
                <span ref={scoreRef}>0</span>
              </span>
              <span className="mt-1 flex items-center gap-1 text-xs text-cream/60">
                <Flame size={13} className="fill-[#ff8a3d] text-[#ff8a3d]" aria-hidden />
                {t.hl.coop.teamStreak(streak)}
              </span>
            </div>
          </div>

          <div data-coop-in className="flex flex-col items-center gap-1.5">
            {result?.endedBy === 'exhausted' && <span className="text-sm text-[#5ef2c2]">{t.hl.coop.exhausted}</span>}
            {reward > 0 ? (
              <span className="inline-flex items-center gap-2 font-display text-3xl" style={inkText('linear-gradient(135deg, #fff4c8, #ffc46b 45%, #ff5ec4)')}>
                <Sparkle size={22} className="fill-[#ffc46b] text-[#ffc46b]" aria-hidden />
                {t.hl.coop.reward(reward)}
              </span>
            ) : (
              missing > 0 && <span className="text-sm text-cream/60">{t.hl.coop.noReward(missing)}</span>
            )}
            {result?.capped && <span className="text-xs text-[#ff9ad8]">{t.hl.over.capped}</span>}
          </div>

          {/* Le duel qui a coûté la série. */}
          {last && last.current.value !== null && last.guessed.value !== null && (
            <div data-coop-in className="w-full rounded-[1.5rem] border border-white/10 bg-[#08080f] p-3">
              <p className="mb-2 text-[10px] tracking-[0.22em] text-cream/40 uppercase">{t.hl.over.answer}</p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <DuelSide card={last.current} value={formatHlValue(last.current.value, room.metric, locale)} />
                <span className="font-display text-2xl" style={{ color: nextHigher ? HL_UP.color : HL_DOWN.color }}>
                  {nextHigher ? '<' : '>'}
                </span>
                <DuelSide card={last.guessed} value={formatHlValue(last.guessed.value, room.metric, locale)} highlight />
              </div>
            </div>
          )}

          {/* L'équipe : bonnes et mauvaises réponses de chacun. */}
          <ul data-coop-in className="flex w-full flex-col gap-1.5">
            {ranked.map((player) => (
              <li key={player.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-2" style={{ opacity: player.left ? 0.5 : 1 }}>
                <CardAvatar card={player.avatar} avatarUrl={player.avatarUrl} initial={nameOf(player, '?').charAt(0).toUpperCase()} size={30} />
                <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-cream">
                  {player.id === room.you ? t.hl.coop.you : nameOf(player, t.hl.leaderboard.anonymous)}
                  {player.left && <span className="ml-1.5 text-[10px] font-normal text-cream/45">{t.hl.coop.left}</span>}
                </span>
                <span className="text-xs text-cream/65 tabular-nums">{t.hl.coop.tally(player.correct, player.misses)}</span>
              </li>
            ))}
          </ul>

          {isHost ? (
            <>
              <MetricPicker metric={room.metric} editable onPick={(metric) => setMetric(metric).catch((error: unknown) => notify(apiErrorMessage(error, t), 'nope'))} />
              <div data-coop-in className="flex w-full flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => void again()}
                  disabled={starting}
                  className="relative inline-flex h-13 w-full shrink-0 items-center justify-center gap-2 overflow-hidden rounded-2xl text-sm font-bold tracking-[0.06em] text-[#04241a] uppercase transition-transform active:scale-95 disabled:opacity-70"
                  style={{ background: HL_GRADIENT, boxShadow: '0 12px 30px -12px rgba(76,201,240,0.6), inset 0 1px 0 rgba(255,255,255,0.6)' }}
                >
                  {starting ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <RotateCcw size={17} aria-hidden />}
                  {t.hl.coop.again}
                </button>
              </div>
            </>
          ) : (
            <p data-coop-in className="inline-flex items-center gap-2 text-sm text-cream/60">
              <Loader2 size={15} className="animate-spin" aria-hidden />
              {t.hl.coop.waitAgain}
            </p>
          )}
          <button
            type="button"
            onClick={() => void leave()}
            className="inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 text-sm font-semibold text-cream transition-transform active:scale-95"
          >
            <LogOut size={16} aria-hidden />
            {t.hl.coop.leave}
          </button>
        </div>
      </div>
    </div>
  )
}

function DuelSide({ card, value, highlight = false }: { card: HlCardData; value: string; highlight?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <span className="block size-14 overflow-hidden rounded-xl border border-white/10 bg-[#0b0b12]">
        {card.image && <img src={card.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" />}
      </span>
      <span className="w-full truncate text-xs text-cream/80">{card.name}</span>
      <span className={`text-sm font-semibold tabular-nums ${highlight ? 'text-[#ffc46b]' : 'text-cream/70'}`}>{value}</span>
    </div>
  )
}
