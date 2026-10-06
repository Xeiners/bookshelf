import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Crown, Loader2, Play, Skull, Sparkle, WifiOff } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { angleTo, bombLink, seatPosition } from '../../lib/bomb'
import { displayRoomCode } from '../../lib/dle'
import { gsap } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playBombExplosion, playBombFail, playBombTurn, playBombWord, playCountdown, playJoin, playLeave } from '../../lib/sfx'
import { BOMB_MODES, bombApi, type BombEvent, type BombPlayer, type BombRoomView } from '../../services/bombApi'
import { useBombStore } from '../../store/useBombStore'
import { hlSound } from '../../store/useHigherLowerStore'
import { useUiStore } from '../../store/useUiStore'
import { CardAvatar } from '../profile/CardAvatar'
import { DleBar } from '../dle/DleBar'
import { STARDUST_GRADIENT } from '../dle/dleStyle'
import { SoundToggle } from '../higherlower/SoundToggle'
import { Bomb } from './Bomb'
import { Lives, TypedWord, WordInput } from './BombParts'
import { Explosion } from './Explosion'

/** Frappe en direct : un envoi toutes les … ms au plus. */
const TYPING_EVERY_MS = 70

/**
 * Salon de l'Anime Bomb Party, en temps réel : le flux du serveur (Server-Sent Events)
 * pousse l'état à chaque changement et la frappe du joueur qui tient la bombe, lettre par
 * lettre — tout le monde voit ce qu'il écrit.
 */
export function RoomScreen({ room, me }: { room: BombRoomView; me: string }) {
  const t = useT()
  const setRoom = useBombStore((state) => state.setRoom)
  const setTyping = useBombStore((state) => state.setTyping)
  const leaveRoom = useBombStore((state) => state.leaveRoom)
  const notify = useUiStore((state) => state.notify)

  // Le flux : ouvert une fois par salon, rouvert seul par le navigateur après une coupure.
  useEffect(() => {
    const source = bombApi.stream(room.code)
    let failures = 0
    source.addEventListener('state', (event) => {
      failures = 0
      setRoom(JSON.parse((event as MessageEvent<string>).data) as BombRoomView)
    })
    source.addEventListener('typing', (event) => setTyping(JSON.parse((event as MessageEvent<string>).data) as { playerId: string; text: string }))
    source.onerror = () => {
      failures += 1
      // Salon fermé (ou plus membre) : le navigateur abandonne, nous aussi.
      if (source.readyState === EventSource.CLOSED || failures > 6) {
        source.close()
        notify(t.bomb.room.closed, 'nope')
        void leaveRoom()
      }
    }
    return () => source.close()
    // Une connexion par salon : les fonctions du store sont stables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.code])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DleBar label={t.bomb.room.leave} onBack={() => void leaveRoom()} danger={room.phase === 'playing'}>
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 font-mono text-xs tracking-[0.18em] text-cream/85">{displayRoomCode(room.code)}</span>
        <SoundToggle />
      </DleBar>
      {room.phase === 'lobby' ? <Lobby room={room} me={me} /> : <Table room={room} me={me} />}
    </div>
  )
}

/* ---- Salle d'attente ---------------------------------------------------------------------- */

function Lobby({ room, me }: { room: BombRoomView; me: string }) {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const setRoom = useBombStore((state) => state.setRoom)
  const [copied, setCopied] = useState(false)
  const [starting, setStarting] = useState(false)
  const host = room.hostId === me
  const link = bombLink(room.code, window.location.origin, window.location.pathname)

  const copy = async () => {
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) await navigator.share({ title: t.bomb.title, text: t.bomb.room.inviteText, url: link })
      else await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Partage annulé.
    }
  }

  const start = async () => {
    setStarting(true)
    try {
      setRoom(await bombApi.start(room.code))
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <div className="flex flex-col items-center gap-2 pt-2 text-center">
          <p className="text-[11px] tracking-[0.2em] text-mist uppercase">{t.bomb.room.code}</p>
          <p className="font-mono text-4xl tracking-[0.25em] text-cream">{displayRoomCode(room.code)}</p>
          <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 rounded-full bg-glow/20 px-4 py-2 text-xs font-medium text-cream hover:bg-glow/30">
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied ? t.bomb.room.copied : t.bomb.room.invite}
          </button>
        </div>

        {/* Mode : l'hôte choisit, les autres voient. */}
        <div className="grid grid-cols-2 gap-2">
          {BOMB_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={!host}
              onClick={() => void bombApi.setMode(room.code, mode).then(setRoom).catch((error: unknown) => notify(apiErrorMessage(error, t), 'nope'))}
              className={`rounded-2xl border p-3 text-left transition-colors ${room.mode === mode ? 'border-glow/60 bg-glow/15' : 'border-white/10 bg-white/[0.03]'} ${host ? 'hover:border-glow/40' : 'cursor-default'}`}
            >
              <span className="block text-sm text-cream">{t.bomb.modes[mode].title}</span>
              <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-mist">{t.bomb.modes[mode].body}</span>
            </button>
          ))}
        </div>

        <div>
          <p className="mb-2 text-xs text-mist">{t.bomb.room.players(room.players.length, room.limits.max)}</p>
          <ul className="flex flex-col gap-1.5">
            {room.players.map((player) => (
              <li key={player.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2">
                <Avatar player={player} size={36} />
                <span className="min-w-0 flex-1 truncate text-sm text-cream">
                  {nameOf(player, t.bomb.room.anonymous)}
                  {player.id === me && <span className="ml-1.5 text-[11px] text-mist">{t.bomb.room.you}</span>}
                </span>
                {player.id === room.hostId && <Crown size={15} className="text-gold" aria-label={t.bomb.room.host} />}
                {!player.connected && <WifiOff size={14} className="text-mist" aria-label={t.bomb.room.away} />}
              </li>
            ))}
          </ul>
        </div>

        {host ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting || room.players.length < room.limits.min}
            className="flex items-center justify-center gap-2 rounded-full bg-cream py-3.5 text-sm font-semibold text-void disabled:opacity-45"
          >
            {starting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Play size={16} className="fill-current" aria-hidden />}
            {room.players.length < room.limits.min ? t.bomb.room.needPlayers : t.bomb.room.start}
          </button>
        ) : (
          <p className="text-center text-sm text-mist">{t.bomb.room.waitingHost}</p>
        )}
      </div>
    </div>
  )
}

/* ---- La table : la bombe au centre, les joueurs autour ------------------------------------- */

const nameOf = (player: BombPlayer, fallback: string) => player.name?.trim() || fallback

function Avatar({ player, size }: { player: BombPlayer; size: number }) {
  const name = player.name?.trim() || '?'
  return <CardAvatar card={player.avatar} avatarUrl={player.avatarUrl} initial={name.charAt(0).toUpperCase()} size={size} />
}

/** Bulle au-dessus d'un siège : le mot trouvé, ou ce qui n'allait pas. */
type Bubble = { id: number; playerId: string; tone: 'ok' | 'fail'; text: string }

function Table({ room, me }: { room: BombRoomView; me: string }) {
  const t = useT()
  const offset = useBombStore((state) => state.offset)
  const typing = useBombStore((state) => state.typing)
  const setRoom = useBombStore((state) => state.setRoom)
  const collect = useBombStore((state) => state.collect)
  const notify = useUiStore((state) => state.notify)
  const stageRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [burst, setBurst] = useState(0)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [hint, setHint] = useState<{ syllable: string; example: string } | null>(null)
  const [refused, setRefused] = useState(false)
  const seen = useRef<number | null>(null)
  const sentAt = useRef(0)
  const pending = useRef<number | null>(null)
  const collected = useRef(false)

  const players = room.players
  const meIndex = players.findIndex((player) => player.id === me)
  const seats = useMemo(() => players.map((_, index) => seatPosition(index, players.length, meIndex, 41)), [players, meIndex])
  const holder = players.find((player) => player.id === room.turn) ?? null
  const holderSeat = holder ? seats[players.indexOf(holder)] : null
  const myTurn = room.phase === 'playing' && room.turn === me
  const meAlive = players[meIndex]?.alive ?? false

  // Les événements du salon : sons, explosions, bulles. Ceux d'avant l'arrivée sont ignorés.
  useEffect(() => {
    const fresh = room.events.filter((event) => seen.current !== null && event.id > seen.current)
    seen.current = Math.max(seen.current ?? 0, ...room.events.map((event) => event.id))
    for (const event of fresh) react(event)
    // `react` ne dépend que de setters stables et de `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.events])

  const react = (event: BombEvent) => {
    const bubble = (tone: Bubble['tone'], text: string) => {
      const entry = { id: event.id, playerId: event.playerId, tone, text }
      setBubbles((list) => [...list.filter((item) => item.playerId !== event.playerId), entry])
      window.setTimeout(() => setBubbles((list) => list.filter((item) => item.id !== entry.id)), 1800)
    }
    if (event.kind === 'word') {
      hlSound(() => playBombWord(0))
      bubble('ok', `✓ ${(event.word ?? '').toUpperCase()}`)
      setHint(null)
    } else if (event.kind === 'fail') {
      if (event.playerId !== me) hlSound(playBombFail)
      bubble('fail', event.reason ? t.bomb.refused[event.reason] : '✗')
    } else if (event.kind === 'explode') {
      hlSound(playBombExplosion)
      setBurst((value) => value + 1)
      setHint(event.example && event.syllable ? { syllable: event.syllable, example: event.example } : null)
      const seat = tableRef.current?.querySelector(`[data-seat="${event.playerId}"]`)
      if (seat) gsap.fromTo(seat, { x: -10 }, { x: 0, duration: 0.6, ease: 'elastic.out(1, 0.25)' })
    } else if (event.kind === 'join') hlSound(playJoin)
    else if (event.kind === 'leave') hlSound(playLeave)
  }

  // La bombe arrive entre mes mains : un signal, le champ vide et prêt.
  useEffect(() => {
    if (!myTurn) return
    setInput('')
    hlSound(playBombTurn)
    vibrate(30)
    inputRef.current?.focus()
  }, [myTurn, room.fuseEndsAt])

  // Décompte de départ : 3, 2, 1… GO.
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    if (room.phase !== 'countdown') {
      setCount(null)
      return
    }
    let last = -1
    const timer = window.setInterval(() => {
      const left = Math.ceil((room.startsAt - offset - Date.now()) / 1000)
      if (left !== last && left > 0) {
        last = left
        setCount(left)
        hlSound(() => playCountdown(false))
      }
    }, 80)
    return () => window.clearInterval(timer)
  }, [room.phase, room.startsAt, offset])
  useEffect(() => {
    if (room.phase === 'playing' && count !== null) {
      hlSound(() => playCountdown(true))
      setCount(null)
    }
  }, [room.phase, count])

  // Fin : ma récompense (solde ou reçus d'invité), une fois.
  useEffect(() => {
    if (room.phase === 'over' && room.mine && !collected.current) {
      collected.current = true
      collect(room.mine)
    }
    if (room.phase !== 'over') collected.current = false
  }, [room.phase, room.mine, collect])

  /** Ma frappe part aux autres, lettre par lettre (au plus toutes les 70 ms). */
  const type = (value: string) => {
    setInput(value)
    setRefused(false)
    if (!myTurn) return
    const send = () => {
      pending.current = null
      sentAt.current = Date.now()
      void bombApi.typing(room.code, value).catch(() => undefined)
    }
    if (pending.current !== null) window.clearTimeout(pending.current)
    const wait = TYPING_EVERY_MS - (Date.now() - sentAt.current)
    if (wait <= 0) send()
    else pending.current = window.setTimeout(send, wait)
  }

  const submit = async () => {
    const word = input.trim()
    if (!word || busy || !myTurn) return
    setBusy(true)
    try {
      const { verdict, view } = await bombApi.word(room.code, word)
      if (verdict.ok) {
        vibrate(14)
        setInput('')
      } else {
        hlSound(playBombFail)
        setRefused(true)
        vibrate([20, 30, 20])
        gsap.fromTo(inputRef.current?.parentElement ?? null, { x: -8 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' })
      }
      setRoom(view)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const playing = room.phase === 'playing'
  const endsAt = playing ? room.fuseEndsAt - offset : null
  // Ce que tape le porteur : le mien en direct, celui des autres par le flux.
  const live = myTurn ? input : typing && typing.playerId === room.turn ? typing.text : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={stageRef} className="relative mx-auto flex w-full max-w-lg min-h-0 flex-1 flex-col items-center px-3 will-change-transform">
        {/* La table : un cercle, la bombe au centre, chaque joueur à sa place. */}
        <div ref={tableRef} className="relative aspect-square w-full max-w-[26rem]">
          <div aria-hidden className="absolute inset-[9%] rounded-full border border-white/[0.06]" style={{ background: 'radial-gradient(circle, rgba(124,92,255,0.12), transparent 70%)' }} />
          <div className="absolute inset-0 grid place-items-center">
            <Bomb
              syllable={playing ? room.syllable : null}
              endsAt={endsAt}
              totalMs={room.fuseMs}
              audible={playing}
              shakeRef={stageRef}
              pointTo={playing && holderSeat ? angleTo(holderSeat) : null}
              size={168}
            />
          </div>
          {players.map((player, index) => {
            const seat = seats[index] as { x: number; y: number }
            const active = playing && player.id === room.turn
            const bubble = bubbles.find((item) => item.playerId === player.id)
            return (
              <div
                key={player.id}
                data-seat={player.id}
                className="absolute flex w-[5.5rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center"
                style={{ left: `${seat.x}%`, top: `${seat.y}%` }}
              >
                {bubble && (
                  <span
                    // En haut de la table, la bulle passe sous le joueur (jamais sur la barre du haut).
                    className={`absolute z-10 max-w-[8rem] truncate rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${seat.y < 35 ? '-bottom-6' : '-top-7'} ${bubble.tone === 'ok' ? 'bg-like text-void' : 'bg-nope text-white'}`}
                  >
                    {bubble.text}
                  </span>
                )}
                <span
                  className={`relative rounded-full transition-all duration-300 ${active ? 'scale-110' : ''} ${!player.alive && room.phase !== 'countdown' ? 'opacity-35 grayscale' : ''}`}
                  style={active ? { boxShadow: '0 0 0 3px #ffd23f, 0 0 22px rgba(255,170,40,0.8)', borderRadius: 999 } : undefined}
                >
                  <Avatar player={player} size={44} />
                  {!player.alive && player.lives === 0 && room.phase !== 'countdown' && room.phase !== 'lobby' && (
                    <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-black/80 text-nope">
                      <Skull size={12} aria-hidden />
                    </span>
                  )}
                  {room.winnerId === player.id && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-gold">
                      <Crown size={18} className="fill-current" aria-hidden />
                    </span>
                  )}
                </span>
                <span className={`max-w-full truncate text-[11px] ${player.id === me ? 'font-semibold text-cream' : 'text-cream/75'}`}>
                  {nameOf(player, t.bomb.room.anonymous)}
                  {!player.connected && ' ·'}
                </span>
                <Lives lives={player.lives} size={8} />
              </div>
            )
          })}
          {count !== null && (
            <div className="absolute inset-0 grid place-items-center">
              <span key={count} className="font-display text-8xl text-white" style={{ textShadow: '0 0 30px #7c5cff' }}>
                {count}
              </span>
            </div>
          )}
        </div>

        {/* Ce qu'écrit le porteur, en grand, pour tout le monde. */}
        <div className="flex min-h-[5.5rem] w-full flex-col items-center justify-center gap-1 text-center">
          {playing && holder && (
            <>
              <p className="text-[11px] tracking-[0.16em] text-mist uppercase">
                {myTurn ? t.bomb.room.yourTurn : t.bomb.room.typing(nameOf(holder, t.bomb.room.anonymous))}
              </p>
              {!myTurn && <TypedWord text={live} syllable={room.syllable ?? ''} className="text-4xl text-cream" />}
              {myTurn && <p className="text-sm text-gold">{t.bomb.room.contains(room.syllable?.toUpperCase() ?? '')}</p>}
            </>
          )}
          {hint && playing && <p className="text-xs text-mist">{t.bomb.missed(hint.syllable.toUpperCase())} <span className="font-semibold text-gold uppercase">{hint.example}</span></p>}
          {room.phase === 'over' && <OverPanel room={room} me={me} />}
        </div>
      </div>

      {room.phase !== 'over' && (
        <div className="mx-auto w-full max-w-lg px-5 pb-5">
          <WordInput
            ref={inputRef}
            value={input}
            onChange={type}
            onSubmit={() => void submit()}
            busy={busy}
            disabled={!myTurn}
            error={refused}
            placeholder={
              !meAlive && playing
                ? t.bomb.room.spectating
                : myTurn
                  ? t.bomb.placeholder(room.syllable?.toUpperCase() ?? '')
                  : holder
                    ? t.bomb.room.waitTurn(nameOf(holder, t.bomb.room.anonymous))
                    : t.bomb.room.getReady
            }
          />
        </div>
      )}

      <Explosion burst={burst} label={t.bomb.boom} />
    </div>
  )
}

/* ---- Fin de partie ------------------------------------------------------------------------- */

function OverPanel({ room, me }: { room: BombRoomView; me: string }) {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const setRoom = useBombStore((state) => state.setRoom)
  const [starting, setStarting] = useState(false)
  const winner = room.players.find((player) => player.id === room.winnerId) ?? null
  const host = room.hostId === me

  const again = async () => {
    setStarting(true)
    try {
      setRoom(await bombApi.start(room.code))
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex w-full flex-col items-center gap-3 pb-4">
      <p className="font-display text-2xl text-cream">
        {winner ? (winner.id === me ? t.bomb.room.youWon : t.bomb.room.winner(nameOf(winner, t.bomb.room.anonymous))) : t.bomb.room.draw}
      </p>
      {room.mine && room.mine.reward > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold text-[#1a0b1f]" style={{ background: STARDUST_GRADIENT }}>
          <Sparkle size={14} className="fill-current" aria-hidden />+{room.mine.reward}
        </span>
      )}
      {host ? (
        <button
          type="button"
          onClick={() => void again()}
          disabled={starting || room.players.length < room.limits.min}
          className="flex items-center gap-2 rounded-full bg-cream px-6 py-3 text-sm font-semibold text-void disabled:opacity-45"
        >
          {starting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Play size={15} className="fill-current" aria-hidden />}
          {room.players.length < room.limits.min ? t.bomb.room.needPlayers : t.bomb.room.again}
        </button>
      ) : (
        <p className="text-xs text-mist">{t.bomb.room.waitingHost}</p>
      )}
    </div>
  )
}
