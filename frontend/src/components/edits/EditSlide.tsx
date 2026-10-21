import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ExternalLink, Loader2, Play } from 'lucide-react'
import { useT } from '../../i18n'
import { YT_STATE, loadYouTubeApi, type YTPlayer } from '../../lib/youtube/iframeApi'
import type { EditVideo } from '../../services/editsApi'

/*
 * Une vidéo du fil « Edits », avec NOTRE lecteur par-dessus celui de YouTube :
 *
 *  - Le lecteur YouTube (API IFrame, sans cookie, sans commandes) n'est qu'une surface vidéo.
 *    Il est plus haut que l'écran : ses bandeaux (titre, « Plus de vidéos »…) tombent hors
 *    du cadre, seule l'image reste visible.
 *  - Un voile couvre tout : le glissé fait défiler le fil, un toucher met en pause (▶ affiché
 *    tant que c'est en pause), un second relance et l'icône disparaît aussitôt.
 *  - Une barre de progression, tout en bas, se saisit au doigt : on avance ou recule dans
 *    l'edit, le temps s'affiche en grand pendant le glissé.
 *  - Préchargement : les deux vidéos suivantes ont déjà leur lecteur, lancé sans le son puis
 *    arrêté sur la première image — en arrivant dessus, la lecture part sans écran noir.
 */

/** Hauteur rognée en haut et en bas du lecteur YouTube (ses bandeaux). */
const CHROME_PX = 72
const thumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

const clock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

interface EditSlideProps {
  item: EditVideo
  index: number
  /** À l'écran : elle joue. */
  active: boolean
  /** Lecteur monté (la vidéo à l'écran, sa voisine d'avant et les deux suivantes). */
  mounted: boolean
  muted: boolean
  paused: boolean
  failed: boolean
  onToggle: () => void
  onFailed: () => void
}

export function EditSlide({ item, index, active, mounted, muted, paused, failed, onToggle, onFailed }: EditSlideProps) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [scrub, setScrub] = useState<{ ratio: number; duration: number } | null>(null)
  // Relus par les événements du lecteur, qui vivent hors du rendu.
  const live = useRef({ active, muted, paused, onFailed })
  useEffect(() => {
    live.current = { active, muted, paused, onFailed }
  }, [active, muted, paused, onFailed])

  // Le lecteur : créé quand la vidéo entre dans la fenêtre de préchargement, détruit en sortant.
  useEffect(() => {
    if (!mounted || failed) return
    let cancelled = false
    let player: YTPlayer | null = null
    void loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return
        const target = document.createElement('div')
        hostRef.current.replaceChildren(target)
        player = new YT.Player(target, {
          width: '100%',
          height: '100%',
          videoId: item.id,
          host: 'https://www.youtube-nocookie.com',
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, origin: window.location.origin },
          events: {
            onReady: (event) => {
              if (cancelled) return
              playerRef.current = event.target
              event.target.mute()
              // À l'écran : la lecture. Préchargée : lancée sans le son, puis arrêtée sur la première image.
              event.target.playVideo()
              setReady(true)
            },
            onStateChange: (event) => {
              if (cancelled) return
              const { active: isActive, paused: isPaused } = live.current
              if (event.data === YT_STATE.Playing) {
                if (!isActive || isPaused) {
                  event.target.pauseVideo()
                  if (!isActive) event.target.seekTo(0, true)
                }
                if (isActive) setPlaying(true)
              } else if (event.data === YT_STATE.Ended) {
                // En boucle, comme sur TikTok.
                event.target.seekTo(0, true)
                event.target.playVideo()
              }
            },
            onError: () => {
              if (!cancelled) live.current.onFailed()
            },
          },
        })
      })
      .catch(() => {
        if (!cancelled) live.current.onFailed()
      })
    return () => {
      cancelled = true
      player?.destroy()
      playerRef.current = null
      setReady(false)
      setPlaying(false)
    }
  }, [mounted, failed, item.id])

  // À l'écran : de zéro, au son choisi ; hors de l'écran : arrêtée et rembobinée.
  useEffect(() => {
    const player = playerRef.current
    if (!ready || !player) return
    if (active) {
      player.seekTo(0, true)
      player.playVideo()
    } else if (player.getPlayerState() === YT_STATE.Playing) {
      // Préchargée qui tamponne encore : elle s'arrêtera seule sur sa première image (cf. onStateChange).
      player.pauseVideo()
      player.seekTo(0, true)
    }
    return () => setPlaying(false)
  }, [active, ready])

  useEffect(() => {
    const player = playerRef.current
    if (!ready || !player || !active) return
    if (muted) player.mute()
    else player.unMute()
  }, [active, muted, ready])

  useEffect(() => {
    const player = playerRef.current
    if (!ready || !player || !active) return
    if (paused) player.pauseVideo()
    else player.playVideo()
  }, [active, paused, ready])

  // Progression : lue à chaque image (sans rendu React), tant que la vidéo est à l'écran.
  useEffect(() => {
    if (!active || !ready || scrub) return
    let frame = 0
    const tick = () => {
      const player = playerRef.current
      const bar = barRef.current
      if (player && bar) {
        const duration = player.getDuration()
        bar.style.transform = `scaleX(${duration > 0 ? Math.min(1, player.getCurrentTime() / duration) : 0})`
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, ready, scrub])

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
    const player = playerRef.current
    if (!player || !ready) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const ratio = ratioAt(event)
    setBar(ratio)
    setScrub({ ratio, duration: player.getDuration() })
  }
  const moveScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrub) return
    const ratio = ratioAt(event)
    setBar(ratio)
    setScrub({ ...scrub, ratio })
  }
  const endScrub = useCallback(() => {
    if (!scrub) return
    playerRef.current?.seekTo(scrub.ratio * scrub.duration, true)
    setScrub(null)
  }, [scrub])

  const showPoster = !(active && playing)

  return (
    <section data-index={index} aria-label={item.title} className="relative h-full snap-start snap-always overflow-hidden bg-black">
      {/* Surface vidéo : plus haute que l'écran, les bandeaux de YouTube sont hors cadre. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0" style={{ top: -CHROME_PX, bottom: -CHROME_PX }}>
        <div ref={hostRef} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />
      </div>

      {/* Affiche : tant que la vidéo ne joue pas (chargement, préchargée, hors de l'écran). */}
      <img
        src={thumbnail(item.id)}
        alt=""
        loading="lazy"
        decoding="async"
        className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${showPoster ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Voile : le glissé fait défiler le fil, un toucher met en pause ou relance. */}
      <button type="button" onClick={onToggle} aria-label={paused ? t.edits.play : t.edits.pause} className="absolute inset-0 z-10 cursor-pointer">
        {paused && active && (
          <span className="animate-pop absolute top-1/2 left-1/2 grid size-[4.5rem] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/40 backdrop-blur-sm">
            <Play size={32} className="ml-1 fill-white text-white" aria-hidden />
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
