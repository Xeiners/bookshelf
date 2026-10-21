import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ExternalLink, Loader2, Pause, Play } from 'lucide-react'
import { useT } from '../../i18n'
import type { EditVideo } from '../../services/editsApi'

/*
 * Une vidéo du fil « Edits » : tout ce qui se pose PAR-DESSUS le lecteur YouTube (qui vit dans la
 * réserve de lecteurs, `editsPool.ts`) — notre lecteur à nous :
 *
 *  - l'affiche, tant que la vidéo ne joue pas encore (jamais d'écran noir) ;
 *  - un voile qui couvre tout : le glissé fait défiler le fil, un toucher met en pause (▶ affiché
 *    tant que c'est en pause), un second relance et l'icône disparaît aussitôt ;
 *  - une barre de progression, tout en bas, qu'on saisit au doigt pour avancer ou reculer dans
 *    l'edit (le temps s'affiche en grand pendant le glissé) ;
 *  - la légende (univers, titre, chaîne) et le lien vers YouTube.
 */

const thumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

const clock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export interface PlaybackControl {
  progress: () => { current: number; duration: number } | null
  seek: (seconds: number) => void
}

interface EditSlideProps {
  item: EditVideo
  index: number
  /** À l'écran. */
  active: boolean
  /** Sa vidéo joue vraiment : l'affiche s'efface. */
  playing: boolean
  paused: boolean
  failed: boolean
  playback: PlaybackControl
  onToggle: () => void
}

export function EditSlide({ item, index, active, playing, paused, failed, playback, onToggle }: EditSlideProps) {
  const t = useT()
  const barRef = useRef<HTMLDivElement>(null)
  const [scrub, setScrub] = useState<{ ratio: number; duration: number } | null>(null)
  const ready = active && playing

  // Progression : lue à chaque image (sans rendu React), tant que la vidéo est à l'écran.
  useEffect(() => {
    if (!active || !ready || scrub) return
    let frame = 0
    const tick = () => {
      const state = playback.progress()
      const bar = barRef.current
      if (state && bar) bar.style.transform = `scaleX(${state.duration > 0 ? Math.min(1, state.current / state.duration) : 0})`
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, ready, scrub, playback])

  // La barre n'est écrite que par ce code (jamais par le rendu) : aucun retour à zéro entre deux images.
  const setBar = (ratio: number) => {
    if (barRef.current) barRef.current.style.transform = `scaleX(${ratio})`
  }

  // Barre saisie au doigt : on suit, puis on saute à l'endroit relâché.
  const ratioAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
  }
  const startScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = playback.progress()
    if (!state || !ready) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const ratio = ratioAt(event)
    setBar(ratio)
    setScrub({ ratio, duration: state.duration })
  }
  const moveScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrub) return
    const ratio = ratioAt(event)
    setBar(ratio)
    setScrub({ ...scrub, ratio })
  }
  const endScrub = useCallback(() => {
    if (!scrub) return
    playback.seek(scrub.ratio * scrub.duration)
    setScrub(null)
  }, [scrub, playback])

  const showPoster = !(active && playing)

  // Toucher : l'icône de ce qui se passe (pause, ou lecture qui reprend), en éclair.
  const [flash, setFlash] = useState<{ kind: 'play' | 'pause'; key: number } | null>(null)
  const toggle = () => {
    setFlash({ kind: paused ? 'play' : 'pause', key: Date.now() })
    onToggle()
  }

  return (
    <section data-index={index} aria-label={item.title} className="relative z-[1] h-full snap-start snap-always overflow-hidden">
      {/* Affiche : tant que la vidéo ne joue pas (chargement, préchargée, hors de l'écran). */}
      <img
        src={thumbnail(item.id)}
        alt=""
        loading="lazy"
        decoding="async"
        className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${showPoster ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Voile : le glissé fait défiler le fil, un toucher met en pause ou relance. */}
      <button type="button" onClick={toggle} aria-label={paused ? t.edits.play : t.edits.pause} className="absolute inset-0 z-10 cursor-pointer">
        {/* L'icône ne reste pas : elle surgit au toucher (pause ou lecture) et s'efface aussitôt. */}
        {flash && active && (
          <span
            key={flash.key}
            className="animate-flash pointer-events-none absolute top-1/2 left-1/2 -mt-9 -ml-9 grid size-[4.5rem] place-items-center rounded-full bg-black/40"
          >
            {flash.kind === 'play' ? <Play size={32} className="ml-1 fill-white text-white" aria-hidden /> : <Pause size={30} className="fill-white text-white" aria-hidden />}
          </span>
        )}
        {!paused && active && !playing && !failed && (
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <Loader2 size={28} className="animate-spin text-cream/70" aria-hidden />
          </span>
        )}
      </button>

      {failed && (
        <p className="absolute inset-x-6 top-1/2 z-10 -translate-y-1/2 rounded-2xl bg-black/65 px-4 py-3 text-center text-sm text-cream/85 backdrop-blur">{t.edits.unavailable}</p>
      )}

      {/* Temps en grand pendant le glissé de la barre. */}
      {scrub && (
        <p className="pointer-events-none absolute inset-x-0 bottom-44 z-30 text-center font-display text-3xl tabular-nums drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
          {clock(scrub.ratio * scrub.duration)}
          <span className="text-cream/55"> / {clock(scrub.duration)}</span>
        </p>
      )}

      {/* Légende : univers, titre, chaîne, et le lien vers YouTube. Masquée pendant le glissé. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pt-16 pb-[max(1.75rem,calc(env(safe-area-inset-bottom)+1.25rem))] transition-opacity duration-200 ${scrub ? 'opacity-0' : 'opacity-100'}`}
      >
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            {item.universe && (
              <span className="mb-2 inline-block rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase backdrop-blur">
                {t.edits.universes[item.universe]}
              </span>
            )}
            <p className="line-clamp-2 text-[15px] leading-snug font-semibold drop-shadow">{item.title}</p>
            {item.channel && <p className="mt-1 truncate text-xs text-cream/70">@{item.channel}</p>}
          </div>
          <a
            href={`https://www.youtube.com/shorts/${item.id}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.edits.youtube}
            title={t.edits.youtube}
            className="pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full bg-black/45 backdrop-blur active:scale-95"
          >
            <ExternalLink size={18} />
          </a>
        </div>
      </div>

      {/* Notre barre de progression : fine, s'épaissit sous le doigt ; zone de prise généreuse. */}
      {active && !failed && (
        <div
          role="slider"
          aria-label={t.edits.seek}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={scrub ? Math.round(scrub.ratio * 100) : undefined}
          tabIndex={0}
          onPointerDown={startScrub}
          onPointerMove={moveScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          className="group absolute inset-x-0 bottom-0 z-30 flex h-7 touch-none items-end pb-[env(safe-area-inset-bottom)]"
        >
          <div className={`relative w-full overflow-visible bg-white/20 transition-[height] duration-150 ${scrub ? 'h-1.5' : 'h-[3px] group-hover:h-1.5'}`}>
            <div ref={barRef} className="absolute inset-0 origin-left bg-white [transform:scaleX(0)]" />
            {scrub && <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" style={{ left: `${scrub.ratio * 100}%` }} />}
          </div>
        </div>
      )}
    </section>
  )
}
