import { useRef } from 'react'
import { Loader2, Music, Pause, Play, SkipForward, X } from 'lucide-react'
import { useAmbientLabel, useAmbientPlayer } from '../../hooks/useAmbientMusic'
import { useT } from '../../i18n'
import { ambientPlayer } from '../../lib/audio/youtubePlayer'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { useUiStore } from '../../store/useUiStore'
import { Pressable } from '../ui/Pressable'

/** Bouton 🎵 de l'en-tête : ouvre la feuille « Musique », pastille quand ça joue. */
export function MusicHeaderButton() {
  const t = useT()
  const openMusic = useUiStore((state) => state.openMusic)
  const { state } = useAmbientPlayer()
  return (
    <Pressable
      onClick={openMusic}
      aria-label={t.ambient.openPlayer}
      title={t.ambient.open}
      className="glass relative grid size-11 place-items-center rounded-full text-cream/70"
    >
      <Music size={17} />
      {state === 'playing' && <span aria-hidden className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-glow" />}
    </Pressable>
  )
}

/**
 * Mini-lecteur flottant, présent sur toutes les vues tant qu'une musique est
 * lancée : titre, lecture / pause, suivant, arrêt. Un tap sur le titre ouvre
 * la feuille complète. Masqué dans le lecteur (il a son propre bouton).
 */
export function AmbientMiniPlayer() {
  const snapshot = useAmbientPlayer()
  const readerOpen = useUiStore((state) => state.reader !== null)
  const musicOpen = useUiStore((state) => state.musicOpen)
  if (snapshot.state === 'idle' || readerOpen || musicOpen) return null
  return <MiniPlayerBar />
}

function MiniPlayerBar() {
  const t = useT()
  const copy = t.ambient
  const snapshot = useAmbientPlayer()
  const { title, detail } = useAmbientLabel()
  const openMusic = useUiStore((state) => state.openMusic)
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    gsap.from(ref.current, { autoAlpha: 0, y: 16, duration: 0.35, ease: EASE.swift })
  })

  const active = snapshot.state === 'playing' || snapshot.state === 'loading'
  const canSkip = snapshot.length > 1 || snapshot.source?.kind === 'playlist'

  return (
    <div
      ref={ref}
      // Au-dessus de la barre de navigation mobile ; en bas à droite sur grand écran.
      className="fixed right-4 bottom-[calc(5rem+max(0.75rem,env(safe-area-inset-bottom)))] z-[45] flex w-[min(19rem,calc(100vw-2rem))] items-center gap-1 rounded-full border border-glow/30 bg-[#09090b]/95 p-1.5 shadow-[0_12px_32px_-12px_rgb(124_92_255/0.6)] md:bottom-6 md:right-6"
    >
      <button
        type="button"
        onClick={openMusic}
        aria-label={copy.openPlayer}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full py-0.5 pl-0.5 text-left"
      >
        <span
          aria-hidden
          className={`grid size-9 shrink-0 place-items-center rounded-full bg-glow/20 text-glow ${active ? 'animate-pulse' : ''}`}
        >
          <Music size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-cream">{title}</span>
          {detail && <span className="block truncate text-[10px] text-mist">{detail}</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={active ? ambientPlayer.pause : ambientPlayer.resume}
        aria-label={active ? copy.pause : copy.play}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-cream text-void"
      >
        {snapshot.state === 'loading' ? (
          <Loader2 size={15} className="animate-spin" />
        ) : active ? (
          <Pause size={15} />
        ) : (
          <Play size={15} className="translate-x-px" />
        )}
      </button>
      {canSkip && (
        <button
          type="button"
          onClick={ambientPlayer.next}
          aria-label={copy.next}
          className="grid size-8 shrink-0 place-items-center rounded-full text-cream/75 hover:bg-white/10"
        >
          <SkipForward size={14} />
        </button>
      )}
      <button
        type="button"
        onClick={ambientPlayer.stop}
        aria-label={copy.stop}
        className="grid size-8 shrink-0 place-items-center rounded-full text-cream/60 hover:bg-white/10"
      >
        <X size={14} />
      </button>
    </div>
  )
}
