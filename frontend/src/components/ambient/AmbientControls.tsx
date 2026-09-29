import { useRef, useState } from 'react'
import { Loader2, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useAmbientPlayer, useAmbientProgress } from '../../hooks/useAmbientMusic'
import { useT } from '../../i18n'
import { playAmbient } from '../../lib/audio/ambientPlayback'
import { formatClock } from '../../lib/audio/clock'
import { ambientPlayer } from '../../lib/audio/youtubePlayer'
import { useAmbientStore } from '../../store/useAmbientStore'
import { FloatingPanel } from '../ui/FloatingPanel'
import { Pressable } from '../ui/Pressable'

/** Pas des boutons « reculer » / « avancer ». */
const JUMP_SECONDS = 10

/** Piste de curseur remplie jusqu'à `ratio` (0 → 1). */
const trackFill = (ratio: number) =>
  `linear-gradient(to right, var(--color-glow) ${ratio * 100}%, rgb(255 255 255 / 0.14) ${ratio * 100}%)`

/** Classes du curseur de position : pouce rond, piste fine. */
const RANGE =
  // i18n-ignore : classes CSS
  'h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full disabled:cursor-default [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-cream [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cream'

/**
 * Position dans le morceau : temps écoulé, curseur (glisser pour avancer ou
 * reculer), durée. Un direct n'a pas de durée : « En direct », sans curseur.
 */
export function SeekBar({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const snapshot = useAmbientPlayer()
  const { progress, refresh } = useAmbientProgress(snapshot.state === 'playing')
  /** Position tenue sous le doigt : appliquée au lâcher, pas à chaque pixel. */
  const [held, setHeld] = useState<number | null>(null)

  if (snapshot.state === 'idle' || snapshot.state === 'error') return null
  if (progress.live) {
    return (
      <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-nope uppercase">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-nope" />
        {t.ambient.search.live}
      </p>
    )
  }

  const duration = progress.duration
  const value = held ?? Math.min(progress.current, duration)
  const commit = () => {
    if (held === null) return
    ambientPlayer.seek(held)
    setHeld(null)
    refresh()
  }

  return (
    <div className={`flex items-center gap-2 text-[10px] text-mist tabular-nums ${compact ? '' : 'pt-1'}`}>
      <span className="w-9 shrink-0 text-right">{formatClock(value)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration))}
        step={1}
        value={Math.floor(value)}
        disabled={duration <= 0}
        onChange={(event) => setHeld(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label={t.ambient.seek}
        aria-valuetext={`${formatClock(value)} / ${formatClock(duration)}`}
        className={RANGE}
        style={{ background: trackFill(duration > 0 ? value / duration : 0) }}
      />
      <span className="w-9 shrink-0">{duration > 0 ? formatClock(duration) : '–:––'}</span>
    </div>
  )
}

/**
 * Lecture : reculer / avancer de 10 s, morceau précédent / suivant, lecture
 * ou pause au centre. `fallback` : ce que lance « Lecture » quand rien n'est chargé.
 */
export function TransportControls({ fallback, size = 'md' }: { fallback?: string; size?: 'md' | 'sm' }) {
  const t = useT()
  const copy = t.ambient
  const snapshot = useAmbientPlayer()
  const { progress, refresh } = useAmbientProgress(snapshot.state === 'playing')
  const active = snapshot.state === 'playing' || snapshot.state === 'loading'
  const idle = snapshot.state === 'idle'
  const canSkip = snapshot.length > 1 || snapshot.source?.kind === 'playlist'
  const canJump = !idle && !progress.live && progress.duration > 0
  const big = size === 'md' ? 'size-12' : 'size-10'

  const toggle = () => {
    if (active) ambientPlayer.pause()
    else if (snapshot.source && snapshot.state !== 'error') ambientPlayer.resume()
    else if (fallback) playAmbient(fallback)
  }
  const jump = (delta: number) => {
    ambientPlayer.seek(ambientPlayer.getProgress().current + delta)
    refresh()
  }
  const small = 'grid size-9 shrink-0 place-items-center rounded-full text-cream/75 hover:bg-white/10 disabled:opacity-25' // i18n-ignore : classes CSS

  return (
    <div className="flex items-center justify-center gap-1">
      <button type="button" onClick={() => jump(-JUMP_SECONDS)} disabled={!canJump} aria-label={copy.back10} className={small}>
        <RotateCcw size={15} />
      </button>
      <button type="button" onClick={ambientPlayer.previous} disabled={!canSkip} aria-label={copy.previous} className={small}>
        <SkipBack size={16} />
      </button>
      <Pressable
        onClick={toggle}
        disabled={idle && !fallback}
        aria-label={active ? copy.pause : copy.play}
        press={0.92}
        className={`mx-1 grid ${big} shrink-0 place-items-center rounded-full bg-glow text-white shadow-[0_0_18px_-2px_rgb(124_92_255/0.8)] disabled:opacity-40`}
      >
        {snapshot.state === 'loading' ? (
          <Loader2 size={20} className="animate-spin" />
        ) : active ? (
          <Pause size={20} />
        ) : (
          <Play size={20} className="translate-x-px" />
        )}
      </Pressable>
      <button type="button" onClick={ambientPlayer.next} disabled={!canSkip} aria-label={copy.next} className={small}>
        <SkipForward size={16} />
      </button>
      <button type="button" onClick={() => jump(JUMP_SECONDS)} disabled={!canJump} aria-label={copy.forward10} className={small}>
        <RotateCw size={15} />
      </button>
    </div>
  )
}

/**
 * Volume : une icône ; touchée, une bulle s'ouvre avec un curseur vertical
 * (haut : plus fort), le pourcentage et « couper le son ».
 */
export function VolumeButton({ placement = 'below' }: { placement?: 'below' | 'above' }) {
  const t = useT()
  const copy = t.ambient
  const volume = useAmbientStore((state) => state.volume)
  const setVolume = useAmbientStore((state) => state.setVolume)
  const [anchor, setAnchor] = useState<{ rect: DOMRect; trigger: HTMLElement } | null>(null)
  /** Volume d'avant « couper le son » : rendu au deuxième appui. */
  const beforeMute = useRef(volume || 40)
  const Icon = volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2

  const apply = (next: number) => {
    setVolume(next)
    ambientPlayer.setVolume(next)
  }
  const toggleMute = () => {
    if (volume > 0) {
      beforeMute.current = volume
      apply(0)
    } else apply(beforeMute.current)
  }

  return (
    <>
      <button
        type="button"
        onClick={(event) => setAnchor(anchor ? null : { rect: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget })}
        aria-label={copy.volume}
        aria-expanded={anchor !== null}
        className={`grid size-9 shrink-0 place-items-center rounded-full hover:bg-white/10 ${anchor ? 'bg-white/10 text-cream' : 'text-cream/75'}`}
      >
        <Icon size={17} />
      </button>
      {anchor && (
        <FloatingPanel anchor={anchor.rect} trigger={anchor.trigger} placement={placement} width={64} label={copy.volume} onClose={() => setAnchor(null)}>
          <div className="flex flex-col items-center gap-2 py-1">
            <span className="text-[11px] font-medium text-cream tabular-nums">{volume}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={volume}
              onChange={(event) => apply(Number(event.target.value))}
              aria-label={copy.volume}
              aria-orientation="vertical"
              // Curseur vertical natif (haut : plus fort) : clavier et lecteurs d'écran gérés d'office.
              className="h-32 w-1.5 cursor-pointer appearance-none rounded-full [direction:rtl] [writing-mode:vertical-lr] [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-cream [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cream"
              style={{ background: `linear-gradient(to top, var(--color-glow) ${volume}%, rgb(255 255 255 / 0.14) ${volume}%)` }}
            />
            <button
              type="button"
              onClick={toggleMute}
              aria-label={volume > 0 ? copy.mute : copy.unmute}
              className="grid size-8 place-items-center rounded-full text-cream/75 hover:bg-white/10"
            >
              {volume > 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
          </div>
        </FloatingPanel>
      )}
    </>
  )
}
