import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, DoorOpen, Eye, Flag, Timer } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { classicRevealSeconds, formatClock, formatSolveTime, mergeSweep, msUntil } from '../../lib/dle'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playChime, playClockTick, playCountdown, playDleMiss, playReveal, playTimeUp } from '../../lib/sfx'
import { dleApi, type GuessResult, type RoomGuess, type RoomPlayer, type RoomView, type SweepState } from '../../services/dleApi'
import { useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { ParticleBurst, type Burst } from '../boosters/ParticleBurst'
import { ClassicBoard, VerdictLegend, WrongGuesses } from './GuessBoard'
import { GuessInput } from './GuessInput'
import { useNow } from '../../hooks/useNow'
import { CATEGORY_STYLE, accentOf, modeLabel, playerName, verdictDot } from './dleStyle'
import { PlayerAvatar } from './PlayerToken'
import { PixelFrame } from './PixelFrame'
import { SweepFrame } from './SweepFrame'
import { ZoomFrame } from './ZoomFrame'
import { inkText } from '../../lib/ink'

/** Sous ce seuil, le chrono passe au rouge et bat. */
const HURRY_MS = 30_000
/** Dans les dernières secondes, le chrono fait tic-tac (plus aigu sous `URGENT_S`). */
const TICK_S = 10
const URGENT_S = 3
const CONFIRM_MS = 3000

/**
 * Une manche : compte à rebours « 3, 2, 1, GO », chrono commun, mon plateau, et
 * la progression des autres en direct (les couleurs de leurs essais, jamais
 * leurs œuvres). Quand un adversaire trouve, tout le monde le sait.
 */
export function RoomPlay({ room }: { room: RoomView }) {
  const t = useT()
  const language = useLanguage()
  const offset = useDleStore((state) => state.offset)
  const works = useDleStore((state) => state.works[room.category] ?? null)
  const guessRoom = useDleStore((state) => state.guessRoom)
  const forfeit = useDleStore((state) => state.forfeit)
  const notify = useUiStore((state) => state.notify)
  const now = useNow(true, 200)
  const [armed, setArmed] = useState(false)
  const [burst, setBurst] = useState<Burst | null>(null)
  /** Chiffon : la vitre telle que les derniers coups de chiffon l'ont laissée, pour cette manche. */
  const [sweepLocal, setSweepLocal] = useState<{ round: number; state: SweepState } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const me = room.players.find((player) => player.id === room.you) ?? null
  const spectating = me?.spectating ?? false
  const total = room.roundSeconds * 1000
  const left = msUntil(room.endsAt, offset, now) ?? 0
  const rawStart = room.startsAt ? Date.parse(room.startsAt) - (now + offset) : -Infinity
  const playing = room.phase === 'playing' && rawStart <= 0
  const canGuess = playing && !spectating && !room.mine.done
  const excluded = useMemo(() => new Set(room.mine.guesses.map((guess) => guess.work.id)), [room.mine.guesses])
  const wrong = room.mine.guesses.filter((guess) => !guess.correct).length
  const solved = room.mine.guesses.some((guess) => guess.correct)

  // Chrono : une barre qui se vide d'un seul tween linéaire (pas un rendu par seconde).
  useGSAP(
    () => {
      if (!room.endsAt || !barRef.current) return
      // Pendant le « 3, 2, 1 », la barre reste pleine : elle part au top départ.
      const serverNow = Date.now() + offset
      const startsIn = room.startsAt ? Math.max(0, Date.parse(room.startsAt) - serverNow) : 0
      const remaining = Math.max(0, Date.parse(room.endsAt) - serverNow - startsIn)
      gsap.fromTo(barRef.current, { scaleX: Math.min(1, remaining / total) }, { scaleX: 0, duration: remaining / 1000, delay: startsIn / 1000, ease: 'none' })
    },
    { dependencies: [room.startsAt, room.endsAt, offset, total] },
  )

  // Un adversaire vient de trouver : bandeau, son, et sa ligne s'illumine.
  const solvedBefore = useRef(new Set(room.players.filter((player) => player.solved).map((player) => player.id)))
  useEffect(() => {
    for (const player of room.players) {
      if (!player.solved || solvedBefore.current.has(player.id)) continue
      solvedBefore.current.add(player.id)
      if (player.id === room.you) continue
      notify(t.dle.room.solvedToast(playerName(player, t.dle.room.anonymous)), 'neutral')
      playChime(true)
    }
  }, [room.players, room.you, notify, t])

  // Fin de manche : tic-tac des dernières secondes, puis la sirène du temps écoulé.
  const second = playing ? Math.ceil(left / 1000) : null
  const lastSecond = useRef<number | null>(null)
  useEffect(() => {
    const previous = lastSecond.current
    lastSecond.current = second
    if (second === null || previous === null || second >= previous || room.mine.done) return
    if (second === 0) playTimeUp()
    else if (second <= TICK_S) playClockTick(second <= URGENT_S)
  }, [second, room.mine.done])

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), CONFIRM_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  const onGuess = async (cardId: string) => {
    try {
      const view = await guessRoom(cardId)
      const last = view.mine.guesses.at(-1)
      if (last?.correct) {
        // Mode classique : la victoire attend que la dernière tuile soit posée.
        const after = room.mode === 'classic' ? classicRevealSeconds(room.category, view.mine.guesses.length) : 0
        gsap.delayedCall(after, () => {
          vibrate([20, 40, 60])
          playReveal(last.work.rarity ?? 'LEGENDARY')
          setBurst({ id: Date.now(), x: window.innerWidth / 2, y: window.innerHeight * 0.4, colors: [accentOf(last.work), '#3fe0a0', '#ffc46b', '#fff4c8'], count: 110, kind: 'sparks', spread: Math.PI * 2 })
        })
      } else {
        vibrate(8)
        if (room.mode === 'sweep') notify(t.dle.sweep.penalty, 'nope')
        if (room.mode !== 'classic') playDleMiss()
      }
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    }
  }

  const giveUp = async () => {
    if (!armed) {
      vibrate(10)
      setArmed(true)
      return
    }
    setArmed(false)
    try {
      await forfeit()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    }
  }

  // COOP : chaque essai de la grille commune porte l'avatar et le pseudo de son auteur.
  const coopAuthor =
    room.kind === 'coop'
      ? (guess: GuessResult) => {
          const { by, byName } = guess as RoomGuess
          const author = room.players.find((player) => player.id === by)
          const name = byName?.trim() || t.dle.room.anonymous
          return (
            <span className="flex w-12 flex-col items-center gap-0.5" title={name}>
              {author ? (
                <PlayerAvatar player={author} size={26} />
              ) : (
                <span className="grid size-[26px] place-items-center rounded-[30%] bg-white/10 text-[11px] font-bold text-cream/70">{name.charAt(0).toUpperCase()}</span>
              )}
              <span className={`w-full truncate text-center text-[9px] font-semibold ${by === room.you ? 'text-[#ff9ad8]' : 'text-mist'}`}>{by === room.you ? t.dle.room.you : name}</span>
            </span>
          )
        }
      : undefined
  const mySolve = me?.solvedMs ?? null
  const hurry = playing && left < HURRY_MS

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Chrono commun (et la manche, quand la partie enchaîne plusieurs formats). */}
      <div className="mx-auto w-full max-w-5xl shrink-0 px-5 pb-3">
        {room.modes.length > 1 && (
          <p className="mb-2 text-center text-[11px] font-semibold tracking-[0.14em] text-mist uppercase">
            {t.dle.room.stage(room.stage + 1, room.modes.length)} · {modeLabel(t, room.category, room.mode)}
          </p>
        )}
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 font-mono text-lg font-semibold tabular-nums ${hurry ? 'animate-pulse text-nope' : 'text-cream'}`} aria-label={t.dle.room.timeLeft}>
            <Timer size={16} aria-hidden />
            {formatClock(playing ? left : total)}
          </span>
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <div
              ref={barRef}
              className="absolute inset-0 origin-left rounded-full will-change-transform"
              style={{ background: hurry ? 'linear-gradient(90deg, #ff5c7a, #ffc46b)' : 'linear-gradient(90deg, #7c5cff, #4cc9f0 60%, #3fe0a0)' }}
            />
          </div>
          <span className="text-xs text-mist tabular-nums">{room.maxGuesses === null ? t.dle.game.attempts(room.mine.guesses.length) : t.dle.game.attemptsOf(room.mine.guesses.length, room.maxGuesses)}</span>
        </div>
      </div>

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-16">
        <div className="mx-auto grid w-full max-w-5xl grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <aside className="min-w-0 lg:order-2">
            <Opponents room={room} />
          </aside>

          <div className="flex min-w-0 flex-col gap-5 lg:order-1">
            {room.mode === 'pixel' && (
              <PixelFrame
                src={dleApi.roomImage(room.code, room.round)}
                errors={wrong}
                revealed={solved}
                glow={CATEGORY_STYLE[room.category].accent}
                portrait={room.category !== 'manga'}
              />
            )}
            {room.mode === 'sweep' && room.mine.sweep && (
              <SweepFrame
                key={room.round}
                category={room.category}
                sweep={mergeSweep(room.mine.sweep, sweepLocal?.round === room.round ? sweepLocal.state : null) ?? room.mine.sweep}
                reveal={(tiles) => dleApi.roomReveal(room.code, tiles)}
                onSweep={(state) =>
                  setSweepLocal((current) => ({ round: room.round, state: mergeSweep(current?.round === room.round ? current.state : null, state) ?? state }))
                }
                fullImage={solved || room.mine.done ? dleApi.roomImage(room.code, room.round) : null}
                disabled={!canGuess}
                glow={CATEGORY_STYLE[room.category].accent}
              />
            )}
            {room.mode === 'zoom' && (
              <ZoomFrame src={dleApi.roomImage(room.code, room.round)} focus={room.mine.focus} errors={wrong} revealed={solved} />
            )}

            {spectating ? (
              <Banner tone="neutral" icon={<Eye size={16} aria-hidden />}>
                {t.dle.room.spectating}
              </Banner>
            ) : mySolve !== null ? (
              <Banner tone="like" icon={<Check size={16} aria-hidden />}>
                <span className="font-semibold">{t.dle.room.solvedIn(formatSolveTime(mySolve, language))}</span>
              </Banner>
            ) : room.mine.done ? (
              <Banner tone="nope" icon={<Flag size={16} aria-hidden />}>
                {me?.gaveUp ? t.dle.room.gaveUp : t.dle.room.outOfGuesses}
              </Banner>
            ) : (
              <GuessInput works={works} excluded={excluded} disabled={!canGuess} onGuess={onGuess} />
            )}

            {room.mode === 'classic' ? (
              <>
                <ClassicBoard guesses={room.mine.guesses} category={room.category} renderAuthor={coopAuthor} />
                {room.mine.guesses.length > 0 && <VerdictLegend />}
              </>
            ) : (
              <WrongGuesses guesses={room.mine.guesses} renderAuthor={coopAuthor} />
            )}

            {canGuess && (
              <button
                type="button"
                onClick={() => void giveUp()}
                className={`inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-xs transition-colors ${armed ? 'bg-nope/20 text-nope' : 'text-mist hover:text-cream'}`}
              >
                <Flag size={13} aria-hidden />
                {armed ? t.dle.room.forfeitConfirm : t.dle.room.forfeit}
              </button>
            )}
          </div>
        </div>
      </div>

      {rawStart > -900 && <CountdownOverlay msLeft={rawStart} />}
      <ParticleBurst burst={burst} />
    </div>
  )
}

function Banner({ tone, icon, children }: { tone: 'like' | 'nope' | 'neutral'; icon: ReactNode; children: ReactNode }) {
  const tones = {
    like: 'border-like/40 bg-like/10 text-[#dcfff1]',
    nope: 'border-nope/40 bg-nope/10 text-[#ffe3e9]',
    neutral: 'border-white/10 bg-white/[0.05] text-cream/85',
  }[tone]
  return (
    <p role="status" className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm ${tones}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  )
}

/** « 3, 2, 1, GO ! » plein écran au départ de la manche. */
function CountdownOverlay({ msLeft }: { msLeft: number }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const label = msLeft > 0 ? String(Math.ceil(msLeft / 1000)) : t.dle.room.go

  // Chaque chiffre bipe au moment où il s'affiche ; le « GO » éclate.
  useGSAP(
    () => {
      gsap.fromTo('[data-count]', { scale: 2.4, autoAlpha: 0, rotation: -8 }, { scale: 1, autoAlpha: 1, rotation: 0, duration: 0.5, ease: EASE.snap })
      const go = label === t.dle.room.go
      playCountdown(go)
      vibrate(go ? 30 : 8)
    },
    { scope: rootRef, dependencies: [label] },
  )

  return (
    <div ref={rootRef} aria-live="assertive" className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-void/80">
      <span
        key={label}
        data-count
        className="font-display text-[7rem] leading-none sm:text-[9rem]"
        style={inkText('linear-gradient(135deg, #fff4c8, #ffc46b 40%, #ff5ec4 75%, #b46cff)')}
      >
        {label}
      </span>
    </div>
  )
}

/** La progression de chacun : essais, couleurs, et s'il a trouvé (en combien de temps). */
function Opponents({ room }: { room: RoomView }) {
  const t = useT()
  // Moi d'abord, puis ceux qui ont trouvé, puis les autres.
  const players = [...room.players].sort((a, b) => Number(b.id === room.you) - Number(a.id === room.you) || Number(b.solved) - Number(a.solved) || (a.solvedMs ?? 0) - (b.solvedMs ?? 0))
  return (
    <section aria-label={t.dle.room.opponents} className="flex flex-col gap-2">
      <ul className="no-scrollbar -mx-5 flex gap-2.5 overflow-x-auto px-5 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
        {players.map((player) => (
          <OpponentRow key={player.id} player={player} you={player.id === room.you} max={room.maxGuesses} mode={room.mode} coop={room.kind === 'coop'} />
        ))}
      </ul>
    </section>
  )
}

function OpponentRow({ player, you, max, mode, coop }: { player: RoomPlayer; you: boolean; max: number | null; mode: RoomView['mode']; coop: boolean }) {
  const t = useT()
  const language = useLanguage()
  const rowRef = useRef<HTMLLIElement>(null)
  const attempts = player.trail.length

  // Un nouvel essai fait pulser la ligne ; une victoire l'illumine.
  useGSAP(
    () => {
      if (attempts === 0) return
      gsap.fromTo(rowRef.current, { scale: player.solved ? 1.06 : 1.03 }, { scale: 1, duration: 0.5, ease: EASE.snap })
    },
    { dependencies: [attempts, player.solved] },
  )

  const recent = player.trail.slice(-3).reverse()
  const status = player.solved
    ? { text: `${t.dle.room.found} · ${formatSolveTime(player.solvedMs ?? 0, language)}`, className: 'text-like', icon: <Check size={11} aria-hidden /> }
    : player.left
      ? { text: t.dle.room.left, className: 'text-mist', icon: <DoorOpen size={11} aria-hidden /> }
      : player.gaveUp
        ? { text: t.dle.room.gaveUpShort, className: 'text-nope', icon: null }
        : // COOP : ses essais sur la grille commune ; VERSUS : où il en est de ses essais.
          { text: coop || max === null ? t.dle.room.tries(attempts) : t.dle.game.attemptsOf(attempts, max), className: 'text-cream/70', icon: null }

  return (
    <li
      ref={rowRef}
      className={`flex min-w-[12.5rem] shrink-0 items-center gap-3 rounded-2xl border px-3 py-2.5 will-change-transform lg:min-w-0 ${player.solved ? 'border-like/45 bg-like/[0.08]' : 'border-white/[0.08] bg-white/[0.03]'}`}
      style={{ opacity: player.left ? 0.5 : 1 }}
    >
      <PlayerAvatar player={player} size={34} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-cream">{playerName(player, t.dle.room.anonymous)}</span>
          {you && <span className="shrink-0 rounded-full bg-white/10 px-1.5 text-[9px] font-semibold tracking-wide text-cream/80 uppercase">{t.dle.room.you}</span>}
        </span>
        <span className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${status.className}`}>
          {status.icon}
          {status.text}
        </span>
        {mode === 'sweep' && player.dirt !== null && (
          // Chiffon : la part de SA vitre nettoyée, en direct (jamais son image).
          <span className="flex items-center gap-1.5" aria-label={t.dle.sweep.cleaned(player.dirt)}>
            <span aria-hidden className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full origin-left rounded-full bg-[#5ef2c2] transition-transform duration-300" style={{ transform: `scaleX(${player.dirt / 100})` }} />
            </span>
            <span className="text-[10px] text-mist tabular-nums">{t.dle.sweep.opponent(player.dirt)}</span>
          </span>
        )}
        {recent.length > 0 && (
          <span aria-hidden className={mode === 'classic' ? 'flex flex-col gap-[3px]' : 'flex flex-wrap gap-[3px]'}>
            {mode === 'classic'
              ? recent.map((trail, index) => (
                  <span key={index} className="flex gap-[3px]" style={{ opacity: 1 - index * 0.25 }}>
                    {trail.map((verdict, cell) => (
                      <span key={cell} className="size-[7px] rounded-[2px]" style={verdictDot(verdict)} />
                    ))}
                  </span>
                ))
              : player.trail.map((trail, index) => <span key={index} className="size-[7px] rounded-full" style={verdictDot(trail[0] ?? 'wrong')} />)}
          </span>
        )}
      </span>
    </li>
  )
}
