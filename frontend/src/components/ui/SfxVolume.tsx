import { useRef, useState } from 'react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'
import { useT } from '../../i18n'
import { playHlSelect } from '../../lib/sfx'
import { useSfxStore } from '../../store/useSfxStore'
import { FloatingPanel } from './FloatingPanel'

/** Curseur du volume des bruitages ; `vertical` dans la bulle, horizontal dans les réglages. */
export function SfxSlider({ vertical = false }: { vertical?: boolean }) {
  const t = useT()
  const volume = useSfxStore((state) => state.volume)
  const setVolume = useSfxStore((state) => state.setVolume)
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={5}
      value={volume}
      onChange={(event) => setVolume(Number(event.target.value))}
      // Un petit son au relâché : on entend aussitôt le niveau choisi.
      onPointerUp={() => playHlSelect()}
      onKeyUp={() => playHlSelect()}
      aria-label={t.sfx.volume}
      aria-valuetext={`${volume} %`}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={`cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-cream [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cream ${
        vertical ? 'h-32 w-1.5 [direction:rtl] [writing-mode:vertical-lr]' : 'h-1.5 w-full'
      }`}
      style={{ background: `linear-gradient(to ${vertical ? 'top' : 'right'}, var(--color-glow) ${volume}%, rgb(255 255 255 / 0.14) ${volume}%)` }}
    />
  )
}

/**
 * Haut-parleur des jeux : touché, une bulle s'ouvre avec le volume des bruitages (curseur
 * vertical, pourcentage, couper / remettre). Le réglage vaut pour tous les jeux.
 */
export function SfxVolume({ placement = 'below' }: { placement?: 'below' | 'above' }) {
  const t = useT()
  const volume = useSfxStore((state) => state.volume)
  const setVolume = useSfxStore((state) => state.setVolume)
  const [anchor, setAnchor] = useState<{ rect: DOMRect; trigger: HTMLElement } | null>(null)
  /** Volume d'avant « couper » : rendu au deuxième appui. */
  const beforeMute = useRef(volume || 60)
  const Icon = volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2

  const toggleMute = () => {
    if (volume > 0) {
      beforeMute.current = volume
      setVolume(0)
    } else {
      setVolume(beforeMute.current)
      playHlSelect()
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(event) => setAnchor(anchor ? null : { rect: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget })}
        aria-label={t.sfx.volume}
        title={t.sfx.volume}
        aria-expanded={anchor !== null}
        className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:text-cream ${anchor ? 'bg-white/10 text-cream' : 'text-cream/60'}`}
      >
        <Icon size={17} aria-hidden />
      </button>
      {anchor && (
        <FloatingPanel anchor={anchor.rect} trigger={anchor.trigger} placement={placement} width={64} label={t.sfx.volume} onClose={() => setAnchor(null)}>
          {/* Les gestes dans la bulle ne remontent pas jusqu'au jeu (poser un tome, sauter…). */}
          <div className="flex flex-col items-center gap-2 py-1" onPointerDown={(event) => event.stopPropagation()}>
            <span className="text-[11px] font-medium text-cream tabular-nums">{volume}</span>
            <SfxSlider vertical />
            <button
              type="button"
              onClick={toggleMute}
              aria-label={volume > 0 ? t.sfx.mute : t.sfx.unmute}
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
