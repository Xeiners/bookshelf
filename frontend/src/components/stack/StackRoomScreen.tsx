import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Crown, Loader2, LogOut, Play, RotateCcw, Share2, Swords, Users } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playChime } from '../../lib/sfx'
import { PLAYER_COLORS, stackLink, type StackMode, type StackRoom } from '../../lib/stack/net'
import { useStackRoom } from '../../store/useStackRoom'
import { useUiStore } from '../../store/useUiStore'
import { StackArena } from './StackArena'

/**
 * Le salon d'une partie à plusieurs : connexion, salon d'attente (code, invitation, mode, joueurs),
 * l'arène une fois la partie lancée, puis les résultats avec la revanche. Plein écran, par-dessus
 * l'accueil de Page Stack.
 */
export function StackRoomScreen({ meId }: { meId: string }) {
  const t = useT()
  const room = useStackRoom((state) => state.room)
  const status = useStackRoom((state) => state.status)
  const error = useStackRoom((state) => state.error)
  const leave = useStackRoom((state) => state.leave)
  const notify = useUiStore((state) => state.notify)

  // Une erreur du serveur (salon plein, déjà commencé, introuvable) : dite une fois.
  useEffect(() => {
    if (!error) return
    notify(t.stack.room.errors[error as keyof typeof t.stack.room.errors] ?? t.stack.room.errors.error, 'nope')
    useStackRoom.getState().clearError()
    if (!useStackRoom.getState().room) leave()
  }, [error, notify, leave, t])

  if (status === 'closed' && !room) {
    return (
      <Shell>
        <p className="text-sm text-cream/80">{t.stack.room.lost}</p>
        <button type="button" onClick={leave} className="mt-4 h-12 rounded-full bg-white/10 px-8 text-sm font-semibold text-cream">
          {t.stack.over.home}
        </button>
      </Shell>
    )
  }
  if (!room) {
    return (
      <Shell>
        <Loader2 size={26} className="animate-spin text-[#ff9a5c]" aria-hidden />
        <p className="mt-3 text-sm text-cream/70">{t.stack.room.connecting}</p>
      </Shell>
    )
  }
  if (room.phase === 'lobby') return <Lobby room={room} meId={meId} />
  return (
    <>
      <StackArena key={room.seed} room={room} meId={meId} onLeave={leave} />
      {room.phase === 'over' && room.results && <Results room={room} meId={meId} />}
      {status === 'closed' && (
        <div className="fixed inset-x-0 top-0 z-[95] bg-nope/90 px-4 py-2 text-center text-xs font-semibold text-white">{t.stack.room.lost}</div>
      )}
    </>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[85] flex flex-col items-center justify-center bg-[#120a28] px-6 text-center">{children}</div>
}

function Lobby({ room, meId }: { room: StackRoom; meId: string }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const notify = useUiStore((state) => state.notify)
  const store = useStackRoom.getState()
  const host = room.hostId === meId
  const link = stackLink(room.code, window.location.origin, window.location.pathname)
  const [copied, setCopied] = useState(false)
  const connected = room.players.filter((player) => player.connected).length
  const ready = connected >= 2
  const starting = useRef(false)

  useGSAP(
    () => {
      gsap.fromTo('[data-lobby-in]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.06, ease: EASE.glide })
    },
    { scope: ref },
  )

  const share = async () => {
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) await navigator.share({ title: t.stack.title, text: t.stack.room.inviteText, url: link })
      else await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Partage annulé.
    }
  }

  const modes: { id: StackMode; label: string; hint: string; icon: typeof Swords }[] = [
    { id: 'versus', label: t.stack.room.versus, hint: t.stack.room.versusHint, icon: Swords },
    { id: 'coop', label: t.stack.room.coop, hint: t.stack.room.coopHint, icon: Users },
  ]

  return (
    <div ref={ref} className="fixed inset-0 z-[85] flex flex-col overflow-y-auto bg-[#120a28] px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4">
        <div data-lobby-in className="flex items-center justify-between">
          <h2 className="font-display text-3xl text-cream">{t.stack.title}</h2>
          <button type="button" onClick={() => useStackRoom.getState().leave()} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-2 text-xs font-semibold text-cream">
            <LogOut size={14} aria-hidden />
            {t.stack.room.leave}
          </button>
        </div>

        <section data-lobby-in className="rounded-[1.5rem] border border-[#ff9a5c]/30 bg-[#1b1038] p-4 text-center">
          <p className="text-[11px] font-semibold tracking-[0.24em] text-[#ffb98a] uppercase">{t.stack.room.code}</p>
          <p className="mt-1 font-display text-5xl tracking-[0.18em] text-cream tabular-nums">{room.code}</p>
          <button
            type="button"
            onClick={() => void share()}
            className="mx-auto mt-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-xs font-semibold text-cream"
          >
            {copied ? <Check size={14} className="text-like" aria-hidden /> : typeof navigator.share === 'function' ? <Share2 size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied ? t.stack.room.copied : t.stack.room.invite}
          </button>
        </section>

        <section data-lobby-in className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t.stack.room.mode}>
          {modes.map((mode) => {
            const active = room.mode === mode.id
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!host}
                onClick={() => store.setMode(mode.id)}
                className={`flex flex-col items-center gap-1 rounded-2xl border px-3 py-3 text-center transition-colors disabled:cursor-default ${active ? 'border-[#ff9a5c] bg-[#ff9a5c]/15' : 'border-white/10 bg-white/[0.04] opacity-70'}`}
              >
                <mode.icon size={20} className={active ? 'text-[#ffb98a]' : 'text-cream/60'} aria-hidden />
                <span className="text-sm font-bold text-cream">{mode.label}</span>
                <span className="text-[11px] leading-snug text-cream/60">{mode.hint}</span>
              </button>
            )
          })}
        </section>

        <section data-lobby-in className="flex flex-col gap-1.5">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">{t.stack.room.players(connected, room.max)}</p>
          {room.players.map((player, index) => (
            <div key={player.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.05] px-3 py-2">
              <span className="size-3 shrink-0 rounded-full" style={{ background: PLAYER_COLORS[index % PLAYER_COLORS.length] }} />
              {player.avatarUrl ? (
                <img src={player.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-white/10 text-xs font-semibold text-cream/80">{(player.name ?? '?').charAt(0).toUpperCase()}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-cream">
                {player.name ?? '—'}
                {player.id === meId && <span className="ml-1.5 text-xs text-[#ff9a5c]">({t.stack.home.you})</span>}
              </span>
              {player.id === room.hostId && <Crown size={15} className="shrink-0 text-gold" aria-label={t.stack.room.host} />}
            </div>
          ))}
          {Array.from({ length: Math.max(0, room.max - room.players.length) }, (_, index) => (
            <div key={`empty-${index}`} className="rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-center text-xs text-cream/35">
              {t.stack.room.empty}
            </div>
          ))}
        </section>

        <div data-lobby-in className="mt-auto flex flex-col gap-2 pt-2">
          {host ? (
            <button
              type="button"
              disabled={!ready}
              onClick={() => {
                if (starting.current) return
                starting.current = true
                vibrate(10)
                playChime(true)
                store.start()
                window.setTimeout(() => (starting.current = false), 1500)
              }}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full text-base font-bold text-void shadow-[0_0_30px_rgba(255,154,92,0.4)] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #ffd35c, #ff9a5c 55%, #ff6fb5)' }}
            >
              <Play size={20} className="fill-void" aria-hidden />
              {ready ? t.stack.room.start : t.stack.room.needTwo}
            </button>
          ) : (
            <p className="rounded-full bg-white/[0.06] py-3.5 text-center text-sm text-cream/70">{t.stack.room.waitHost}</p>
          )}
          {!ready && host && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => notify(t.stack.room.copied, 'like'))
              }}
              className="text-xs text-cream/50 underline-offset-4 hover:underline"
            >
              {t.stack.room.shareHint}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Résultats : classement (versus) ou score d'équipe (coop), revanche pour l'hôte. */
function Results({ room, meId }: { room: StackRoom; meId: string }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const results = room.results!
  const host = room.hostId === meId
  const won = results.winnerIds.includes(meId)
  const coop = results.mode === 'coop'
  const nameOf = (id: string) => room.players.find((player) => player.id === id)?.name ?? '—'
  const rows = results.ranking

  useGSAP(
    () => {
      playChime(won)
      vibrate(won ? [20, 40, 20, 40, 80] : 12)
      gsap.fromTo('[data-res-card]', { y: 40, scale: 0.92, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.55, ease: EASE.spring, delay: 0.5 })
      gsap.fromTo('[data-res-row]', { x: -12, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.35, stagger: 0.07, delay: 0.8, ease: EASE.glide })
    },
    { scope: ref },
  )

  return (
    <div ref={ref} className="fixed inset-0 z-[90] grid place-items-center bg-black/55 px-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t.stack.room.results}>
      <div data-res-card className="relative w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-[#ff9a5c]/30 bg-[#140a2e] p-5 text-center opacity-0">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(100% 60% at 50% 0%, rgba(255,154,92,0.3), transparent 70%)' }} />
        <p className="relative text-[11px] font-semibold tracking-[0.24em] text-[#ffb98a] uppercase">{coop ? t.stack.room.team : won ? `🏆 ${t.stack.room.victory}` : t.stack.room.results}</p>
        {coop && results.team ? (
          <>
            <p className="relative mt-2 font-display text-5xl text-cream tabular-nums">{results.team.score.toLocaleString()}</p>
            <p className="relative text-xs text-cream/55">{t.stack.room.teamLine(results.team.pages, results.team.bestCombo)}</p>
          </>
        ) : (
          <p className="relative mt-2 font-display text-3xl text-cream">
            {results.winnerIds.length > 1 ? t.stack.room.tie : t.stack.room.winner(nameOf(results.winnerIds[0] ?? ''))}
          </p>
        )}
        <div className="relative mt-4 flex flex-col gap-1.5 text-left">
          {rows.map((row, index) => (
            <div key={row.id} data-res-row className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${row.id === meId ? 'bg-[#ff9a5c]/15' : 'bg-white/[0.05]'}`}>
              <span className="w-5 text-center font-bold text-cream/60 tabular-nums">{index + 1}</span>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: PLAYER_COLORS[Math.max(0, room.players.findIndex((player) => player.id === row.id)) % PLAYER_COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate text-cream">{nameOf(row.id)}</span>
              <span className="font-bold text-gold tabular-nums">{coop ? t.stack.room.placed(row.placed) : row.score.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="relative mt-5 flex flex-col gap-2">
          {host ? (
            <button
              type="button"
              onClick={() => useStackRoom.getState().rematch()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold text-void"
              style={{ background: 'linear-gradient(135deg, #ffd35c, #ff9a5c 55%, #ff6fb5)' }}
            >
              <RotateCcw size={17} aria-hidden />
              {t.stack.room.rematch}
            </button>
          ) : (
            <p className="rounded-full bg-white/[0.06] py-3 text-center text-xs text-cream/60">{t.stack.room.waitRematch}</p>
          )}
          <button type="button" onClick={() => useStackRoom.getState().leave()} className="h-12 rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-cream">
            {t.stack.room.leave}
          </button>
        </div>
      </div>
    </div>
  )
}
