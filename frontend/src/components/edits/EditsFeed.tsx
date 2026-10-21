import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronUp, ExternalLink, Loader2, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { useT } from '../../i18n'
import { ambientPlayer } from '../../lib/audio/youtubePlayer'
import { vibrate } from '../../lib/haptics'
import { EDIT_UNIVERSES, editsApi, type EditUniverse, type EditVideo } from '../../services/editsApi'
import { useUiStore } from '../../store/useUiStore'

/*
 * Fil « Edits » : des edits, AMV et MMV d'anime (YouTube Shorts), une vidéo par écran, qu'on
 * fait défiler du doigt (ou des flèches) comme sur TikTok. En essai, réservé aux administrateurs.
 *
 *  - Seule la vidéo à l'écran a un lecteur (le lecteur officiel YouTube, sans cookie) ; les
 *    autres ne sont qu'une affiche. Une pellicule de vingt lecteurs mettrait un téléphone à genoux.
 *  - Un voile transparent couvre le lecteur : le glissé fait défiler le fil (une iframe avalerait
 *    le geste) et un toucher met en pause ou relance.
 *  - Le son démarre coupé (seule lecture automatique permise par les navigateurs) ; le réglage
 *    suit d'une vidéo à l'autre.
 *  - Le fil se charge par pages en approchant de la fin ; une vidéo qui refuse d'être intégrée
 *    est sautée toute seule.
 */

const YT_ORIGIN = 'https://www.youtube-nocookie.com'
/** Pages demandées quand il ne reste plus que ce nombre de vidéos devant soi. */
const PREFETCH_AHEAD = 3

const newSeed = () => Math.random().toString(36).slice(2, 10)
const thumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

type Status = 'loading' | 'ready' | 'error'

export function EditsFeed() {
  const t = useT()
  const close = useUiStore((state) => state.closeEdits)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [universe, setUniverse] = useState<EditUniverse | null>(null)
  const [seed, setSeed] = useState(newSeed)
  const [items, setItems] = useState<EditVideo[]>([])
  const [next, setNext] = useState<number | null>(0)
  const [status, setStatus] = useState<Status>('loading')
  const [active, setActive] = useState(0)
  const [muted, setMuted] = useState(true)
  const [paused, setPaused] = useState(false)
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const loadingRef = useRef(false)

  // La musique d'ambiance se tait pendant les edits, et reprend en sortant.
  useEffect(() => {
    const wasPlaying = ambientPlayer.getPlayingState() === 'playing'
    if (wasPlaying) ambientPlayer.pause()
    return () => {
      if (wasPlaying) ambientPlayer.resume()
    }
  }, [])

  const loadMore = useCallback(
    async (from: number, signal?: AbortSignal) => {
      if (loadingRef.current) return
      loadingRef.current = true
      try {
        const page = await editsApi.page({ universe, seed, offset: from }, signal)
        setItems((current) => {
          const known = new Set(current.map((item) => item.id))
          return [...current, ...page.items.filter((item) => !known.has(item.id))]
        })
        setNext(page.next)
        setStatus('ready')
      } catch {
        if (!signal?.aborted) setStatus((current) => (current === 'loading' ? 'error' : current))
      } finally {
        loadingRef.current = false
      }
    },
    [universe, seed],
  )

  // Nouveau fil (ouverture, univers, recommencer) : on repart du début.
  useEffect(() => {
    const controller = new AbortController()
    loadingRef.current = false
    const timer = window.setTimeout(() => {
      setItems([])
      setNext(0)
      setActive(0)
      setPaused(false)
      setStatus('loading')
      scrollerRef.current?.scrollTo({ top: 0 })
      void loadMore(0, controller.signal)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [loadMore])

  // La vidéo à l'écran : celle qui en occupe la plus grande part.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue
          const index = Number((entry.target as HTMLElement).dataset.index)
          setActive(index)
          setPaused(false)
        }
      },
      { root: scroller, threshold: [0.6] },
    )
    for (const slide of scroller.querySelectorAll('[data-index]')) observer.observe(slide)
    return () => observer.disconnect()
  }, [items.length])

  // À l'approche de la fin : la page suivante.
  useEffect(() => {
    if (status !== 'ready' || next === null || active < items.length - PREFETCH_AHEAD) return
    const timer = window.setTimeout(() => void loadMore(next), 0)
    return () => window.clearTimeout(timer)
  }, [active, items.length, next, status, loadMore])

  const goTo = useCallback((index: number) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollTo({ top: index * scroller.clientHeight, behavior: 'smooth' })
  }, [])

  // Vidéo refusée par YouTube (intégration interdite, supprimée) : signalée, puis sautée.
  const onFailed = useCallback(
    (id: string, index: number) => {
      setFailed((current) => new Set(current).add(id))
      window.setTimeout(() => goTo(index + 1), 1200)
    },
    [goTo],
  )

  // Clavier (ordinateur) : flèches pour défiler, M pour le son, Échap pour sortir.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      else if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault()
        goTo(active + 1)
      } else if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        goTo(Math.max(0, active - 1))
      } else if (event.key === 'm') setMuted((value) => !value)
      else if (event.key === ' ') {
        event.preventDefault()
        setPaused((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, close, goTo])

  const chooseUniverse = (value: EditUniverse | null) => {
    if (value === universe) return
    vibrate(6)
    setUniverse(value)
  }

  const current = items[active]

  return (
    <div role="dialog" aria-modal="true" aria-label={t.edits.title} className="fixed inset-0 z-[90] overflow-hidden bg-black text-cream">
      {/* Fond (ordinateur) : l'affiche de la vidéo en cours, floutée, autour de la colonne verticale. */}
      {current && (
        <div aria-hidden className="absolute inset-0 scale-110 bg-cover bg-center opacity-40 blur-3xl" style={{ backgroundImage: `url(${thumbnail(current.id)})` }} />
      )}

      <div className="relative mx-auto h-full w-full md:w-[min(100vw,calc(100dvh*9/16))] md:shadow-[0_0_80px_rgba(0,0,0,0.9)]">
        <div ref={scrollerRef} className="no-scrollbar h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain">
          {items.map((item, index) => (
            <EditSlide
              key={item.id}
              item={item}
              index={index}
              active={index === active}
              muted={muted}
              paused={paused && index === active}
              failed={failed.has(item.id)}
              onToggle={() => setPaused((value) => !value)}
              onFailed={() => onFailed(item.id, index)}
            />
          ))}
          {status === 'ready' && next === null && (
            <section data-index={items.length} className="grid h-full snap-start snap-always place-items-center px-8 text-center">
              <div className="flex flex-col items-center gap-3">
                <p className="font-display text-2xl">{items.length > 0 ? t.edits.end : t.edits.empty}</p>
                {items.length > 0 && <p className="text-sm text-cream/60">{t.edits.endBody}</p>}
                <button
                  type="button"
                  onClick={() => setSeed(newSeed())}
                  className="mt-2 inline-flex h-11 items-center gap-2 rounded-full bg-cream px-5 text-sm font-semibold text-void active:scale-95"
                >
                  <RotateCcw size={16} aria-hidden />
                  {t.edits.restart}
                </button>
              </div>
            </section>
          )}
          {status === 'ready' && next !== null && items.length > 0 && (
            <section data-index={items.length} className="grid h-full snap-start place-items-center">
              <Loader2 size={26} className="animate-spin text-cream/60" aria-hidden />
            </section>
          )}
        </div>

        {/* États du premier chargement. */}
        {status === 'loading' && items.length === 0 && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="inline-flex items-center gap-2 text-sm text-cream/70">
              <Loader2 size={18} className="animate-spin" aria-hidden />
              {t.edits.loading}
            </p>
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 grid place-items-center px-8 text-center">
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-cream/75">{t.edits.error}</p>
              <button type="button" onClick={() => setSeed(newSeed())} className="inline-flex h-10 items-center gap-2 rounded-full bg-cream px-4 text-sm font-semibold text-void">
                <RotateCcw size={15} aria-hidden />
                {t.edits.retry}
              </button>
            </div>
          </div>
        )}

        {/* En-tête : retour, titre, son ; puis les univers. */}
        <header className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/75 via-black/35 to-transparent pt-[max(0.75rem,env(safe-area-inset-top))] pb-6">
          <div className="pointer-events-auto flex items-center gap-3 px-3">
            <button type="button" onClick={close} aria-label={t.edits.close} className="grid size-10 place-items-center rounded-full bg-black/40 backdrop-blur active:scale-95">
              <ArrowLeft size={19} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] tracking-[0.28em] text-cream/60 uppercase">{t.edits.eyebrow}</p>
              <p className="flex items-center gap-2 font-display text-xl leading-tight">
                {t.edits.title}
                <span className="rounded-full bg-[#ff5ec4]/20 px-2 py-0.5 font-sans text-[9px] font-bold tracking-[0.14em] text-[#ff9ad8] uppercase">{t.edits.beta}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMuted((value) => !value)}
              aria-label={muted ? t.edits.unmute : t.edits.mute}
              aria-pressed={!muted}
              className="grid size-10 place-items-center rounded-full bg-black/40 backdrop-blur active:scale-95"
            >
              {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
          </div>
          <div role="group" aria-label={t.edits.filters} className="no-scrollbar pointer-events-auto mt-3 flex gap-2 overflow-x-auto px-3">
            <Chip selected={universe === null} onClick={() => chooseUniverse(null)} label={t.edits.all} />
            {EDIT_UNIVERSES.map((id) => (
              <Chip key={id} selected={universe === id} onClick={() => chooseUniverse(id)} label={t.edits.universes[id]} />
            ))}
          </div>
        </header>

        {/* Son coupé au départ : on le rappelle une fois, sur la première vidéo. */}
        {muted && active === 0 && current && (
          <button
            type="button"
            onClick={() => setMuted(false)}
            className="absolute top-36 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-xs font-semibold backdrop-blur active:scale-95"
          >
            <VolumeX size={14} aria-hidden />
            {t.edits.soundHint}
          </button>
        )}
        {active === 0 && items.length > 1 && (
          <p aria-hidden className="pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom)+7.5rem)] left-1/2 z-20 flex -translate-x-1/2 animate-bounce flex-col items-center text-[11px] text-cream/70">
            <ChevronUp size={18} />
            {t.edits.swipeHint}
          </p>
        )}
      </div>
    </div>
  )
}

function Chip({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`h-8 shrink-0 rounded-full px-3.5 text-xs font-semibold whitespace-nowrap backdrop-blur transition-colors ${selected ? 'bg-cream text-void' : 'bg-black/45 text-cream/85 hover:bg-black/60'}`}
    >
      {label}
    </button>
  )
}

interface EditSlideProps {
  item: EditVideo
  index: number
  active: boolean
  muted: boolean
  paused: boolean
  failed: boolean
  onToggle: () => void
  onFailed: () => void
}

/** Une vidéo du fil : l'affiche, et — quand elle est à l'écran — le lecteur YouTube par-dessus. */
function EditSlide({ item, index, active, muted, paused, failed, onToggle, onFailed }: EditSlideProps) {
  const t = useT()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [playing, setPlaying] = useState(false)

  const command = useCallback((func: string) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), YT_ORIGIN)
  }, [])
  // Réglages du moment, relus quand le lecteur est prêt (un message envoyé avant serait perdu).
  const settingsRef = useRef({ muted, paused })
  useEffect(() => {
    settingsRef.current = { muted, paused }
  }, [muted, paused])
  const applySettings = useCallback(() => {
    command(settingsRef.current.muted ? 'mute' : 'unMute')
    command(settingsRef.current.paused ? 'pauseVideo' : 'playVideo')
  }, [command])

  // Le lecteur parle par messages : on s'abonne à ses événements (lecture, erreur).
  useEffect(() => {
    if (!active) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== YT_ORIGIN || event.source !== frameRef.current?.contentWindow || typeof event.data !== 'string') return
      let data: { event?: string; info?: unknown }
      try {
        data = JSON.parse(event.data) as typeof data
      } catch {
        return
      }
      if (data.event === 'onError') onFailed()
      if (data.event === 'onReady') applySettings()
      if (data.event === 'onStateChange' || data.event === 'infoDelivery') {
        const state = typeof data.info === 'number' ? data.info : (data.info as { playerState?: number } | null)?.playerState
        if (state === 1) setPlaying(true)
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      // Hors de l'écran, le lecteur disparaît : au retour, l'affiche revient le temps qu'il recharge.
      setPlaying(false)
    }
  }, [active, onFailed, applySettings])

  // Son et pause suivent les réglages du fil.
  useEffect(() => {
    if (active) command(muted ? 'mute' : 'unMute')
  }, [active, muted, command])
  useEffect(() => {
    if (active) command(paused ? 'pauseVideo' : 'playVideo')
  }, [active, paused, command])

  // Toujours lancée sans le son (seule lecture automatique sûre) ; le réglage du fil est appliqué
  // dès que le lecteur est prêt. La source ne dépend donc pas du son : le changer ne recharge rien.
  const src = `${YT_ORIGIN}/embed/${item.id}?autoplay=1&mute=1&playsinline=1&loop=1&playlist=${item.id}&controls=0&rel=0&modestbranding=1&iv_load_policy=3&fs=0&disablekb=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`

  return (
    <section data-index={index} aria-label={item.title} className="relative h-full snap-start snap-always overflow-hidden bg-black">
      {/* Affiche : visible tant que la vidéo ne joue pas encore (ou hors de l'écran). */}
      <img
        src={thumbnail(item.id)}
        alt=""
        loading="lazy"
        decoding="async"
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${active && playing ? 'opacity-0' : 'opacity-100'}`}
      />
      {active && !failed && (
        <iframe
          ref={frameRef}
          title={item.title}
          src={src}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: index, channel: 'widget' }), YT_ORIGIN)}
          className="absolute inset-0 h-full w-full border-0"
        />
      )}

      {/* Voile : le glissé fait défiler le fil, un toucher met en pause. */}
      <button type="button" onClick={onToggle} aria-label={paused ? t.edits.play : t.edits.pause} className="absolute inset-0 z-10 cursor-pointer">
        {paused && (
          <span className="absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 backdrop-blur">
            <Play size={28} className="ml-1 fill-current" aria-hidden />
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

      {/* Légende : univers, titre, chaîne, et le lien vers YouTube. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pt-16 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
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
          <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-3">
            <a
              href={`https://www.youtube.com/shorts/${item.id}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t.edits.youtube}
              title={t.edits.youtube}
              className="grid size-11 place-items-center rounded-full bg-black/45 backdrop-blur active:scale-95"
            >
              <ExternalLink size={18} />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
