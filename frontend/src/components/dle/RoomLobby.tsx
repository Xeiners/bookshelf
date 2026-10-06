import { useEffect, useRef, useState } from 'react'
import { Loader2, Play, Share2, UserPlus } from 'lucide-react'
import { useHoloTilt } from '../../hooks/useHoloTilt'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { displayRoomCode } from '../../lib/dle'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playJoin, playLeave } from '../../lib/sfx'
import { DLE_MODES, DURATION_OPTIONS, GUESS_OPTIONS, type DleMode, type RoomPlayer, type RoomSettings, type RoomView } from '../../services/dleApi'
import { useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { STARDUST_GRADIENT, auraOf, modeLabel, playerName } from './dleStyle'
import { ModeIcon } from './ModeIcon'
import { KindPicker } from './KindPicker'
import { PlayerAvatar } from './PlayerToken'
import { inkText } from '../../lib/ink'

/**
 * Salle d'attente : le code à partager, les réglages de la partie (type, essais,
 * durée : l'hôte choisit, les autres voient), les joueurs arrivés (chacun sur sa
 * carte flottante, inclinable, aux couleurs de son avatar), et le départ — lancé
 * par l'hôte, quand il le décide.
 */
export function RoomLobby({ room, onShare }: { room: RoomView; onShare: () => void }) {
  const t = useT()
  const startRoom = useDleStore((state) => state.startRoom)
  const setRoomSettings = useDleStore((state) => state.setRoomSettings)
  const notify = useUiStore((state) => state.notify)
  const [starting, setStarting] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const isHost = room.hostId === room.you
  // Places libres affichées : de quoi compléter la rangée (3 par ligne sur téléphone).
  const slots = Math.min(room.maxPlayers, Math.max(3, room.players.length + 1)) - room.players.length
  const settle = (settings: RoomSettings) => setRoomSettings(settings).catch((error: unknown) => notify(apiErrorMessage(error, t), 'nope'))

  // Chaque nouvel arrivant entre en scène ; ceux déjà là ne bougent pas.
  const shown = useRef(new Set<string>())
  const roster = room.players.map((player) => player.id).join('|')
  useGSAP(
    () => {
      const fresh = gsap.utils.toArray<HTMLElement>('[data-player]').filter((node) => !shown.current.has(node.dataset.player ?? ''))
      for (const node of fresh) shown.current.add(node.dataset.player ?? '')
      if (fresh.length > 0) gsap.fromTo(fresh, { y: 30, scale: 0.8, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.7, stagger: 0.08, ease: EASE.snap })
    },
    { scope: rootRef, dependencies: [roster] },
  )

  // Quelqu'un entre ou sort du salon : un « pop » qui monte ou qui descend (pas pour soi-même).
  const present = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = new Set(roster ? roster.split('|') : [])
    const before = present.current
    present.current = ids
    if (!before) return
    const joined = [...ids].some((id) => !before.has(id) && id !== room.you)
    const left = [...before].some((id) => !ids.has(id) && id !== room.you)
    if (joined) playJoin()
    else if (left) playLeave()
  }, [roster, room.you])

  const start = async () => {
    vibrate(14)
    setStarting(true)
    try {
      await startRoom()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div ref={rootRef} className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 sm:gap-7">
        <header className="flex flex-col items-center gap-3 pt-1 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 text-xs font-semibold text-cream/80">
            <ModeIcon category={room.category} mode={room.mode} size={13} />
            {t.dle.categories[room.category].title} · {room.modes.map((mode) => modeLabel(t, room.category, mode)).join(' → ')}
            <span className="text-mist tabular-nums">· {room.players.length}/{room.maxPlayers}</span>
          </span>
          <button type="button" onClick={onShare} className="group flex flex-col items-center gap-2">
            <span
              className="font-mono text-[2rem] font-bold tracking-[0.18em] sm:text-5xl sm:tracking-[0.22em]"
              style={inkText('linear-gradient(135deg, #fff4c8, #ffc46b 40%, #ff5ec4 75%, #b46cff)')}
            >
              {displayRoomCode(room.code)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-glow/40 bg-glow/10 px-3.5 py-1.5 text-xs font-semibold text-[#d9ccff] transition-colors group-hover:bg-glow/20">
              <Share2 size={13} aria-hidden />
              {t.dle.room.share}
            </span>
          </button>
        </header>

        {/* Réglages : l'hôte choisit, les autres voient. */}
        <div className="mx-auto flex w-full max-w-md flex-col gap-3">
          <KindPicker value={room.kind} disabled={!isHost} onChange={(kind) => void settle({ kind })} />
          <ModesRow
            label={t.dle.room.settings.modes}
            modes={room.modes}
            disabled={!isHost}
            labelOf={(mode) => modeLabel(t, room.category, mode)}
            onToggle={(mode) => {
              const next = room.modes.includes(mode) ? room.modes.filter((entry) => entry !== mode) : [...room.modes, mode]
              if (next.length > 0) void settle({ modes: DLE_MODES.filter((entry) => next.includes(entry)) })
            }}
          />
          <SettingRow
            label={t.dle.room.settings.guesses}
            options={GUESS_OPTIONS}
            value={room.maxGuesses}
            disabled={!isHost}
            format={(value) => (value === null ? t.dle.room.settings.unlimited : String(value))}
            onChange={(maxGuesses) => void settle({ maxGuesses })}
          />
          <SettingRow
            label={t.dle.room.settings.duration}
            options={DURATION_OPTIONS}
            value={room.roundSeconds}
            disabled={!isHost}
            format={(value) => t.dle.room.settings.minutes(value / 60)}
            onChange={(roundSeconds) => void settle({ roundSeconds })}
          />
        </div>

        <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-4 lg:grid-cols-5">
          {room.players.map((player, index) => (
            <li key={player.id} data-player={player.id}>
              <PlayerCard player={player} you={player.id === room.you} index={index} />
            </li>
          ))}
          {Array.from({ length: Math.max(0, slots) }, (_, index) => (
            <li key={`slot-${index}`}>
              <button
                type="button"
                onClick={onShare}
                aria-label={t.dle.room.share}
                className="grid aspect-[3/4] w-full place-items-center rounded-2xl border-2 border-dashed border-white/10 text-mist/60 transition-colors hover:border-glow/40 hover:text-cream sm:rounded-[1.4rem]"
              >
                <UserPlus size={24} aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-col items-center gap-4 text-center">
          {isHost ? (
            <button
              type="button"
              onClick={() => void start()}
              disabled={starting}
              className="relative inline-flex h-14 items-center gap-2.5 overflow-hidden rounded-full px-8 text-base font-semibold text-[#2a1a02] transition-transform active:scale-95 disabled:opacity-70"
              style={{ background: 'linear-gradient(135deg, #fff0b0, #e0a82e 55%, #c8901c)', boxShadow: '0 0 30px rgba(255,196,107,0.5), inset 0 1px 0 rgba(255,255,255,0.7)' }}
            >
              <span aria-hidden className="absolute inset-y-0 left-0 w-1/2 -skew-x-12" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)', animation: 'shimmer 2.8s ease-in-out infinite' }} />
              <span className="relative inline-flex items-center gap-2.5">
                {starting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Play size={18} className="fill-current" aria-hidden />}
                {starting ? t.dle.room.starting : t.dle.room.start}
              </span>
            </button>
          ) : (
            <p className="inline-flex items-center gap-2 text-sm text-mist">
              <span aria-hidden className="flex gap-1">
                {[0, 1, 2].map((dot) => (
                  <span key={dot} className="size-1.5 animate-pulse rounded-full bg-glow" style={{ animationDelay: `${dot * 200}ms` }} />
                ))}
              </span>
              {t.dle.room.waitHost}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Un joueur du salon : sa carte flotte doucement et s'incline sous le doigt. */
function PlayerCard({ player, you, index }: { player: RoomPlayer; you: boolean; index: number }) {
  const t = useT()
  const floatRef = useRef<HTMLDivElement>(null)
  const tiltRef = useRef<HTMLDivElement>(null)
  useHoloTilt(tiltRef, true)
  const aura = auraOf(player)
  const name = playerName(player, t.dle.room.anonymous)

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.to(floatRef.current, { y: -7, duration: 2.2 + (index % 3) * 0.3, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: index * 0.35 })
    },
    { scope: floatRef },
  )

  return (
    <div ref={floatRef} className="will-change-transform" style={{ opacity: player.present ? 1 : 0.45 }}>
      <div
        ref={tiltRef}
        className="relative flex aspect-[3/4] flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 p-2 text-center sm:gap-3 sm:rounded-[1.4rem] sm:p-3"
        style={{
          borderColor: `${aura}aa`,
          background: `radial-gradient(circle at 50% 30%, ${aura}38, transparent 65%), linear-gradient(165deg, rgba(24,20,40,0.95), rgba(8,8,14,0.96))`,
          boxShadow: `0 0 0 1px rgba(0,0,0,0.6), 0 0 26px -6px ${aura}`,
          transform: 'perspective(700px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))',
          transition: 'transform 120ms linear',
        }}
      >
        {/* Reflet qui suit le pointeur. */}
        <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.18), transparent 50%)', opacity: 'var(--holo, 0)' }} />
        <span className="sm:hidden">
          <PlayerAvatar player={player} size={48} crown />
        </span>
        <span className="hidden sm:inline">
          <PlayerAvatar player={player} size={68} crown />
        </span>
        <span className="flex w-full min-w-0 flex-col items-center gap-0.5">
          <span className="w-full truncate text-xs font-semibold text-cream sm:text-sm">{name}</span>
          {player.title && <span className="w-full truncate text-[10px] text-gold/85">{t.profile.titles[player.title]}</span>}
          {player.guest && <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[9px] font-semibold tracking-[0.12em] text-mist uppercase">{t.dle.room.guestTag}</span>}
        </span>
        {you && (
          <span className="absolute top-2 left-2 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.14em] text-[#1a0b1f] uppercase" style={{ background: STARDUST_GRADIENT }}>
            {t.dle.room.you}
          </span>
        )}
      </div>
    </div>
  )
}

/** Un réglage de l'hôte : une rangée de pastilles (lecture seule pour les autres joueurs). */
function SettingRow<V extends number | null>({
  label,
  options,
  value,
  disabled,
  format,
  onChange,
}: {
  label: string
  options: readonly V[]
  value: V
  disabled: boolean
  format: (value: V) => string
  onChange: (value: V) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] font-semibold tracking-[0.12em] text-mist uppercase">{label}</span>
      <div role="radiogroup" aria-label={label} className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
        {options.map((option) => {
          const active = option === value
          return (
            <button
              key={String(option)}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled && !active}
              onClick={() => {
                if (disabled || active) return
                vibrate(6)
                onChange(option)
              }}
              className={`h-9 shrink-0 rounded-full px-3.5 text-sm font-semibold tabular-nums transition-colors disabled:opacity-35 ${active ? 'bg-cream text-void' : 'bg-white/[0.06] text-cream/80 hover:bg-white/[0.1]'} ${disabled ? 'cursor-default' : ''}`}
            >
              {format(option)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Formats de la partie : un, ou les deux à la suite (numérotés dans leur ordre de passage). */
function ModesRow({
  label,
  modes,
  disabled,
  labelOf,
  onToggle,
}: {
  label: string
  modes: DleMode[]
  disabled: boolean
  labelOf: (mode: DleMode) => string
  onToggle: (mode: DleMode) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] font-semibold tracking-[0.12em] text-mist uppercase">{label}</span>
      <div role="group" aria-label={label} className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {DLE_MODES.map((mode) => {
          const active = modes.includes(mode)
          const order = modes.length > 1 ? modes.indexOf(mode) + 1 : 0
          return (
            <button
              key={mode}
              type="button"
              role="checkbox"
              aria-checked={active}
              disabled={disabled && !active}
              onClick={() => {
                if (disabled) return
                vibrate(6)
                onToggle(mode)
              }}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors disabled:opacity-35 ${active ? 'bg-cream text-void' : 'bg-white/[0.06] text-cream/80 hover:bg-white/[0.1]'} ${disabled ? 'cursor-default' : ''}`}
            >
              {order > 0 && <span className="grid size-5 place-items-center rounded-full bg-void text-[10px] font-black text-cream">{order}</span>}
              {labelOf(mode)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
