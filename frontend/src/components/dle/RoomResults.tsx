import { useEffect, useRef, useState } from 'react'
import { Handshake, Loader2, RotateCcw, Sparkle, UserPlus } from 'lucide-react'
import { useNow } from '../../hooks/useNow'
import { useLanguage, useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { formatSolveTime, msUntil, podiumOrder, standingOf } from '../../lib/dle'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playChime, playReveal } from '../../lib/sfx'
import type { RoomView, Standing } from '../../services/dleApi'
import { useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { ParticleBurst, type Burst } from '../boosters/ParticleBurst'
import { AnswerCard } from './AnswerCard'
import { STARDUST_GRADIENT, modeLabel } from './dleStyle'
import { PlayerAvatar } from './PlayerToken'

/** Hauteur des marches du podium (1ᵉʳ, 2ᵉ, 3ᵉ), et leur métal. */
const STEP: Record<number, { height: string; metal: string; glow: string }> = {
  1: { height: 'h-32', metal: 'linear-gradient(180deg, #fff0b0, #e0a82e 55%, #8a5a10)', glow: '0 0 40px -6px rgba(255,196,107,0.75)' },
  2: { height: 'h-24', metal: 'linear-gradient(180deg, #f4f6fb, #aeb6c6 55%, #5b6272)', glow: '0 0 30px -10px rgba(220,226,240,0.6)' },
  3: { height: 'h-16', metal: 'linear-gradient(180deg, #ffd2a8, #c27a45 55%, #6b3a17)', glow: '0 0 30px -10px rgba(214,140,80,0.6)' },
}

/**
 * Fin de manche : l'œuvre révélée, le podium (marches qui montent, avatars qui
 * tombent dessus, confettis), le reste du classement et les Poussières gagnées.
 * L'hôte peut lancer une revanche avec les mêmes joueurs.
 */
export function RoomResults({ room }: { room: RoomView }) {
  const t = useT()
  const language = useLanguage()
  const rematch = useDleStore((state) => state.rematch)
  const notify = useUiStore((state) => state.notify)
  const rootRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [burst, setBurst] = useState<Burst | null>(null)
  const results = room.results
  const mine = standingOf(room, room.you)
  const isHost = room.hostId === room.you
  const coop = room.kind === 'coop'
  const offset = useDleStore((state) => state.offset)
  const now = useNow(room.nextStageAt !== null, 500)
  const nextIn = msUntil(room.nextStageAt, offset, now)
  const nextMode = room.modes[room.stage + 1]
  const openAuth = useUiStore((state) => state.openAuth)
  const byId = new Map(room.players.map((player) => [player.id, player]))

  useGSAP(
    () => {
      if (!results) return
      const timeline = gsap.timeline()
      timeline
        .fromTo('[data-answer]', { rotationY: 180, scale: 0.7, autoAlpha: 0, transformPerspective: 900 }, { rotationY: 0, scale: 1, autoAlpha: 1, duration: 0.9, ease: 'back.out(1.3)' })
        .fromTo('[data-step]', { scaleY: 0 }, { scaleY: 1, duration: 0.6, stagger: 0.12, ease: EASE.swift, transformOrigin: '50% 100%' }, '-=0.3')
        .fromTo('[data-podium-avatar]', { y: -60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, stagger: 0.12, ease: 'bounce.out' }, '-=0.35')
        .fromTo('[data-standing]', { x: -14, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.4, stagger: 0.05, ease: EASE.swift }, '-=0.3')
        .fromTo('[data-my-reward]', { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.6, ease: EASE.snap }, '-=0.2')
    },
    { scope: rootRef, dependencies: [room.round, results === null] },
  )

  // Arrivée sur les résultats : confettis pour tous, fanfare pour le vainqueur. Une fois par manche.
  const ready = results !== null
  const winner = mine?.rank === 1 && mine.solved
  useEffect(() => {
    if (!ready) return
    if (winner) playReveal('LEGENDARY')
    else playChime(true)
    vibrate(winner ? [30, 50, 80] : 12)
    const timer = window.setTimeout(() => {
      setBurst({ id: Date.now(), x: window.innerWidth / 2, y: window.innerHeight * 0.45, colors: ['#ffc46b', '#ff5ec4', '#7c5cff', '#3fe0a0', '#fff4c8'], count: winner ? 200 : 110, kind: 'confetti', spread: Math.PI * 2 })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [room.round, ready, winner])

  if (!results) {
    return (
      <div className="grid flex-1 place-items-center">
        <Loader2 size={26} className="animate-spin text-glow" aria-hidden />
      </div>
    )
  }

  const again = async () => {
    vibrate(12)
    setBusy(true)
    try {
      await rematch()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  const podium = podiumOrder(results.standings)
  const rest = results.standings.slice(3)
  const nameOf = (standing: Standing) => standing.name?.trim() || t.dle.room.anonymous
  const detail = (standing: Standing) =>
    standing.solved ? formatSolveTime(standing.solvedMs ?? 0, language) : standing.left ? t.dle.room.left : t.dle.room.notFound

  return (
    <div ref={rootRef} className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-16">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-7">
        <div className="flex flex-col items-center gap-3 text-center">
          <div data-answer>
            <AnswerCard work={results.answer} width={132} />
          </div>
          <p className="max-w-sm font-display text-2xl text-cream">{results.answer.name}</p>
        </div>

        {coop ? (
          /* COOP : un bandeau d'équipe, puis chacun avec ses essais et ses gains. */
          <div className="flex w-full max-w-md flex-col items-center gap-4">
            <p
              data-podium-avatar
              className={`inline-flex items-center gap-2 font-display text-3xl ${mine?.solved ? '' : 'text-cream/70'}`}
              style={mine?.solved ? { backgroundImage: 'linear-gradient(135deg, #dcfff1, #3fe0a0 50%, #4cc9f0)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } : undefined}
            >
              <Handshake size={26} className={mine?.solved ? 'text-like' : 'text-mist'} aria-hidden />
              {results.standings.some((standing) => standing.solved) ? t.dle.room.teamWin : t.dle.room.teamLoss}
            </p>
            <ol className="flex w-full flex-col gap-1.5">
              {results.standings.map((standing) => {
                const player = byId.get(standing.id)
                return (
                  <li key={standing.id} data-standing className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
                    {player ? <PlayerAvatar player={player} size={30} /> : <GhostAvatar name={nameOf(standing)} size={30} />}
                    <span className="min-w-0 flex-1 truncate text-sm text-cream">{nameOf(standing)}</span>
                    <span className="text-xs text-mist tabular-nums">{t.dle.room.tries(standing.attempts)}</span>
                    {standing.reward > 0 && <span className="text-xs font-semibold text-gold tabular-nums">+{standing.reward}</span>}
                  </li>
                )
              })}
            </ol>
          </div>
        ) : (
          <>
          {/* Podium : 2ᵉ, 1ᵉʳ, 3ᵉ. */}
          <div className="flex w-full max-w-md items-end justify-center gap-3">
            {podium.map((standing) => {
              const step = STEP[standing.rank] ?? STEP[3]!
              const player = byId.get(standing.id)
              return (
                <div key={standing.id} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <div data-podium-avatar className="flex flex-col items-center gap-1.5">
                    {player ? <PlayerAvatar player={player} size={standing.rank === 1 ? 64 : 52} /> : <GhostAvatar name={nameOf(standing)} size={52} />}
                    <span className="max-w-full truncate text-xs font-semibold text-cream">{nameOf(standing)}</span>
                    <span className={`text-[11px] tabular-nums ${standing.solved ? 'text-like' : 'text-mist'}`}>{detail(standing)}</span>
                  </div>
                  <div
                    data-step
                    className={`relative grid w-full place-items-start justify-center rounded-t-2xl pt-2 ${step.height}`}
                    style={{ background: step.metal, boxShadow: `${step.glow}, inset 0 1px 0 rgba(255,255,255,0.6)` }}
                  >
                    <span className="font-display text-2xl text-black/60">{standing.rank}</span>
                    {standing.reward > 0 && (
                      <span className="absolute bottom-2 inline-flex items-center gap-0.5 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-[#fff4c8] tabular-nums">
                        <Sparkle size={9} className="fill-current" aria-hidden />+{standing.reward}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {rest.length > 0 && (
            <ol className="flex w-full max-w-md flex-col gap-1.5">
              {rest.map((standing) => (
                <li key={standing.id} data-standing className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
                  <span className="w-7 text-sm font-semibold text-mist tabular-nums">{t.dle.room.rank(standing.rank)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-cream">{nameOf(standing)}</span>
                  <span className={`text-xs tabular-nums ${standing.solved ? 'text-like' : 'text-mist'}`}>{detail(standing)}</span>
                  {standing.reward > 0 && <span className="text-xs font-semibold text-gold tabular-nums">+{standing.reward}</span>}
                </li>
              ))}
            </ol>
          )}
          </>
        )}

        {mine && (
          <div data-my-reward className="flex flex-col items-center gap-1 text-center">
            {!coop && (
              <p className="text-sm text-cream/85">
                {t.dle.room.rank(mine.rank)} · {mine.solved ? t.dle.room.tries(mine.attempts) : t.dle.room.notFound}
              </p>
            )}
            {mine.reward > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-base font-bold text-[#1a0b1f] tabular-nums" style={{ background: STARDUST_GRADIENT, boxShadow: '0 0 26px -4px rgba(255,94,196,0.6)' }}>
                <Sparkle size={16} className="fill-current" aria-hidden />
                {t.dle.earned(mine.reward)}
              </span>
            ) : (
              <span className="text-xs text-mist">{room.rewarded ? t.dle.room.capped : t.dle.room.training}</span>
            )}
            {/* Invité : ses Poussières attendent sur l'appareil ; un compte les garde. */}
            {mine.guest && mine.reward > 0 && (
              <div className="mt-2 flex flex-col items-center gap-2">
                <span className="text-xs text-cream/70">{t.dle.guest.earned(mine.reward)}</span>
                <button type="button" onClick={openAuth} className="inline-flex items-center gap-1.5 rounded-full bg-cream px-4 py-2 text-xs font-semibold text-void">
                  <UserPlus size={14} aria-hidden />
                  {t.dle.guest.keepCta}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Partie en plusieurs formats : le classement général, à la fin. */}
        {results.overall && (
          <section data-standing className="flex w-full max-w-md flex-col gap-2">
            <p className="text-center text-[11px] font-semibold tracking-[0.16em] text-mist uppercase">{t.dle.room.overall}</p>
            <ol className="flex flex-col gap-1.5">
              {results.overall.map((entry) => {
                const player = byId.get(entry.id)
                return (
                  <li key={entry.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${entry.rank === 1 ? 'border-gold/50 bg-gold/10' : 'border-white/[0.07] bg-white/[0.03]'}`}>
                    <span className="w-7 text-sm font-bold text-mist tabular-nums">{t.dle.room.rank(entry.rank)}</span>
                    {player ? <PlayerAvatar player={player} size={28} /> : <GhostAvatar name={entry.name?.trim() || t.dle.room.anonymous} size={28} />}
                    <span className="min-w-0 flex-1 truncate text-sm text-cream">{entry.name?.trim() || t.dle.room.anonymous}</span>
                    <span className="text-sm font-bold text-gold tabular-nums">{t.dle.room.points(entry.points)}</span>
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {nextIn !== null && nextMode ? (
          // Manche suivante : elle part d'elle-même, pour tout le monde.
          <p className="inline-flex items-center gap-2 rounded-full bg-[#ff5ec4]/15 px-4 py-2 text-sm font-semibold text-[#ff9ad8] tabular-nums" aria-live="polite">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            {t.dle.room.nextStage(modeLabel(t, room.category, nextMode), Math.ceil(nextIn / 1000))}
          </p>
        ) : isHost ? (
          <button
            type="button"
            onClick={() => void again()}
            disabled={busy}
            className="inline-flex h-12 items-center gap-2 rounded-full px-7 text-sm font-semibold text-[#2a1a02] transition-transform active:scale-95 disabled:opacity-70"
            style={{ background: 'linear-gradient(135deg, #fff0b0, #e0a82e 55%, #c8901c)', boxShadow: '0 0 26px rgba(255,196,107,0.5), inset 0 1px 0 rgba(255,255,255,0.7)' }}
          >
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RotateCcw size={16} aria-hidden />}
            {t.dle.room.rematch}
          </button>
        ) : null}
      </div>
      <ParticleBurst burst={burst} />
    </div>
  )
}

/** Joueur parti avant la fin : son initiale, sans avatar. */
function GhostAvatar({ name, size }: { name: string; size: number }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-[30%] bg-white/10 font-display text-cream/70" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

