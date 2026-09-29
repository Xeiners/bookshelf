import { useState } from 'react'
import { AudioLines, ListMusic, Music, X } from 'lucide-react'
import { useAmbientLabel, useAmbientPlayer, useAmbientProgress } from '../../hooks/useAmbientMusic'
import { useT } from '../../i18n'
import { ambientPlayer } from '../../lib/audio/youtubePlayer'
import { vibrate } from '../../lib/haptics'
import { useUiStore } from '../../store/useUiStore'
import { FloatingPanel } from '../ui/FloatingPanel'
import { Pressable } from '../ui/Pressable'
import { SeekBar, TransportControls, VolumeButton } from './AmbientControls'

/** Rayon et périmètre de l'anneau d'avancement autour du bouton (SVG, 44 px). */
const RING_RADIUS = 20.5
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/**
 * Bouton 🎵 de l'en-tête, sur toutes les vues : c'est aussi le mini-lecteur.
 * Sans musique, il ouvre la feuille « Musique ». En lecture, un anneau montre
 * l'avancement et l'icône bat la mesure ; touché, il déplie sous lui une
 * bulle avec toutes les commandes (position, ±10 s, morceaux, volume). Rien
 * ne flotte par-dessus le contenu : la page reste entièrement accessible.
 */
export function MusicHeaderButton() {
  const t = useT()
  const copy = t.ambient
  const openMusic = useUiStore((state) => state.openMusic)
  const snapshot = useAmbientPlayer()
  const active = snapshot.state !== 'idle'
  const playing = snapshot.state === 'playing'
  const { progress } = useAmbientProgress(playing)
  const ratio = progress.duration > 0 ? Math.min(1, progress.current / progress.duration) : progress.live ? 1 : 0
  const [anchor, setAnchor] = useState<{ rect: DOMRect; trigger: HTMLElement } | null>(null)

  return (
    <>
      <Pressable
        onClick={(event) => {
          vibrate(6)
          if (!active) {
            openMusic()
            return
          }
          setAnchor(anchor ? null : { rect: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget })
        }}
        aria-label={active ? copy.mini.expand : copy.openPlayer}
        aria-expanded={active ? anchor !== null : undefined}
        title={copy.open}
        className={`glass relative grid size-11 place-items-center rounded-full ${active ? 'text-glow' : 'text-cream/70'}`}
      >
        {active && (
          <svg aria-hidden viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
            <circle
              cx="22"
              cy="22"
              r={RING_RADIUS}
              fill="none"
              stroke="var(--color-glow)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH * (1 - ratio)}
            />
          </svg>
        )}
        {playing ? <AudioLines size={17} className="animate-pulse" /> : <Music size={17} />}
      </Pressable>

      {anchor && active && (
        <FloatingPanel anchor={anchor.rect} trigger={anchor.trigger} width={340} label={copy.open} onClose={() => setAnchor(null)}>
          <MiniControls
            onOpenFull={() => {
              setAnchor(null)
              openMusic()
            }}
            onStop={() => {
              setAnchor(null)
              ambientPlayer.stop()
            }}
          />
        </FloatingPanel>
      )}
    </>
  )
}

function MiniControls({ onOpenFull, onStop }: { onOpenFull: () => void; onStop: () => void }) {
  const t = useT()
  const copy = t.ambient
  const { title, detail } = useAmbientLabel()
  return (
    <div className="space-y-2 p-1">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onOpenFull} aria-label={copy.mini.open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-glow/20 text-glow">
            <Music size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-cream">{title}</span>
            {detail && <span className="block truncate text-[10px] text-mist">{detail}</span>}
          </span>
        </button>
        <button type="button" onClick={onStop} aria-label={copy.stop} className="grid size-8 shrink-0 place-items-center rounded-full text-cream/60 hover:bg-white/10">
          <X size={15} />
        </button>
      </div>
      <SeekBar compact />
      <div className="flex items-center justify-between gap-1">
        <VolumeButton />
        <TransportControls size="sm" />
        <button type="button" onClick={onOpenFull} aria-label={copy.mini.open} className="grid size-9 shrink-0 place-items-center rounded-full text-cream/75 hover:bg-white/10">
          <ListMusic size={16} />
        </button>
      </div>
    </div>
  )
}
