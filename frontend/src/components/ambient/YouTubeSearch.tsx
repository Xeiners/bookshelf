import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, AudioLines, Check, ListMusic, Loader2, Pause, Play, Plus, Search, X } from 'lucide-react'
import { useAmbientLabel, useAmbientPlayer } from '../../hooks/useAmbientMusic'
import { useLanguage, useT } from '../../i18n'
import { fetchYouTubeTitle, playAmbient, tracksOf } from '../../lib/audio/ambientPlayback'
import { ambientPlayer, parseYouTubeSource, type AmbientSource } from '../../lib/audio/youtubePlayer'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { musicApi, type MusicSearchResult, type MusicSearchType } from '../../services/musicApi'
import type { AddTracksReport } from '../../store/useAmbientStore'
import { useUiStore } from '../../store/useUiStore'
import { AddToPlaylist, type PickedTrack } from './AddToPlaylist'
import { SeekBar, TransportControls, VolumeButton } from './AmbientControls'

type OnAdd = (tracks: PickedTrack[]) => AddTracksReport | null

interface YouTubeSearchProps {
  /**
   * Ajout direct à une playlist précise (éditeur de playlist) : un tap suffit,
   * une playlist YouTube y verse tous ses morceaux. Absent : le « + » ouvre le
   * choix de la playlist.
   */
  onAdd?: OnAdd
  /** Nom de la playlist qui reçoit les ajouts directs, rappelé dans l'écran de recherche. */
  target?: string
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; results: MusicSearchResult[] }
  | { status: 'error'; message: string }

/** Délai de frappe avant de lancer la recherche. */
const DEBOUNCE_MS = 450

/**
 * Recherche YouTube ou lien. Dans le panneau, un simple champ ; touché, il
 * ouvre un écran de recherche sur toute la hauteur (plein écran sur mobile) :
 * champ, type (morceaux / playlists), résultats qui défilent seuls, et le
 * lecteur en bas pour garder la main sur la musique. Un lien (ou ID) se joue
 * ou s'ajoute tel quel ; du texte (« the cure ») lance une recherche. Le
 * morceau en cours est mis en avant (en tête, en couleur), son bouton devient
 * pause / reprise. La recherche est gardée d'une ouverture à l'autre.
 */
export function YouTubeSearch({ onAdd, target }: YouTubeSearchProps) {
  const t = useT()
  const copy = t.ambient.search
  const language = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<MusicSearchType>('video')
  const [result, setResult] = useState<SearchState>({ status: 'idle' })
  const triggerRef = useRef<HTMLButtonElement>(null)

  const trimmed = query.trim()
  const searchable = parseYouTubeSource(trimmed) === null && trimmed.length >= 2

  useEffect(() => {
    if (!searchable) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setResult({ status: 'loading' })
      musicApi
        .search(trimmed, type, language, controller.signal)
        .then((results) => setResult({ status: 'done', results }))
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setResult({ status: 'error', message: apiErrorMessage(reason, t) })
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [searchable, trimmed, type, language, t])

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.22em] text-mist uppercase">{copy.label}</p>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="mt-2 flex w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-left text-xs transition-colors hover:border-glow/50"
      >
        <Search size={14} aria-hidden className="shrink-0 text-mist" />
        <span className={`truncate ${trimmed ? 'text-cream' : 'text-mist/60'}`}>{trimmed || copy.placeholder}</span>
      </button>
      {open && (
        <SearchScreen
          query={query}
          onQuery={setQuery}
          type={type}
          onType={setType}
          result={searchable ? result : { status: 'idle' }}
          onAdd={onAdd}
          target={target}
          onClose={close}
        />
      )}
    </div>
  )
}

interface SearchScreenProps {
  query: string
  onQuery: (query: string) => void
  type: MusicSearchType
  onType: (type: MusicSearchType) => void
  /** Déjà ramené à « rien » quand le champ est vide ou contient un lien. */
  result: SearchState
  onAdd?: OnAdd
  target?: string
  onClose: () => void
}

/**
 * Écran de recherche : plein écran sur mobile, grand panneau centré sur
 * ordinateur, au-dessus de la feuille (ou du lecteur). Échap le ferme — après
 * une éventuelle bulle ouverte (choix de playlist, volume), qui part d'abord.
 */
function SearchScreen({ query, onQuery, type, onType, result, onAdd, target, onClose }: SearchScreenProps) {
  const t = useT()
  const copy = t.ambient.search
  const inputId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Champ vide à l'ouverture : le clavier s'ouvre tout de suite. Recherche reprise : les résultats d'abord.
  const [focusOnOpen] = useState(query === '')
  const snapshot = useAmbientPlayer()

  const trimmed = query.trim()
  const link = parseYouTubeSource(trimmed)

  useGSAP(
    () => {
      gsap
        .timeline({ defaults: { ease: EASE.glide } })
        .fromTo('[data-search-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 0)
        // Opacité seule (pas `autoAlpha`) : un panneau `visibility: hidden` refuserait le focus du champ.
        .fromTo('[data-search-panel]', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, clearProps: 'transform' }, 0)
    },
    { scope: rootRef },
  )

  useEffect(() => {
    if (focusOnOpen) inputRef.current?.focus({ preventScroll: true })
  }, [focusOnOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[data-floating-panel]')) return
      // Ni la feuille ni le lecteur derrière ne se ferment avec.
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  // Entrée : un lien se joue ; une recherche range le clavier pour laisser voir les résultats.
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (link) playAmbient(trimmed)
    else inputRef.current?.blur()
  }

  const currentId = snapshot.source?.id ?? null
  // Le morceau en cours d'abord : on sait toujours ce qu'on écoute.
  const results =
    result.status === 'done'
      ? [...result.results].sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId))
      : []

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[110] flex justify-center md:items-center md:p-6" role="dialog" aria-modal aria-label={copy.label}>
      <div data-search-backdrop aria-hidden onClick={onClose} className="absolute inset-0 bg-void/90 opacity-0" />
      <div
        data-search-panel
        className="glass-strong relative flex h-dvh w-full flex-col text-cream opacity-0 md:h-[min(52rem,90dvh)] md:max-w-xl md:rounded-[2.25rem]"
      >
        <form onSubmit={submit} className="flex shrink-0 items-center gap-2 px-3 pt-safe pb-2 md:px-5 md:pt-5">
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="grid size-10 shrink-0 place-items-center rounded-full text-cream/75 hover:bg-white/10"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="relative min-w-0 flex-1">
            <label htmlFor={inputId} className="sr-only">
              {copy.label}
            </label>
            <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-mist" />
            <input
              ref={inputRef}
              id={inputId}
              type="search"
              enterKeyHint={link ? 'go' : 'search'}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder={copy.placeholder}
              className="w-full rounded-full border border-white/10 bg-white/[0.05] py-2.5 pr-10 pl-10 text-sm text-cream placeholder:text-mist/60 focus:border-glow/60 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  onQuery('')
                  inputRef.current?.focus()
                }}
                aria-label={copy.clear}
                className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-full text-mist hover:bg-white/10 hover:text-cream"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </form>

        <div className="flex shrink-0 items-center gap-2 px-4 pb-3 md:px-6">
          {!link && (
            <div role="radiogroup" aria-label={copy.label} className="flex gap-1">
              {(['video', 'playlist'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={type === value}
                  onClick={() => onType(value)}
                  className={`rounded-full px-3.5 py-1.5 text-xs transition-colors ${
                    type === value ? 'bg-glow/20 text-cream ring-1 ring-glow/50' : 'text-cream/60 hover:bg-white/[0.06]'
                  }`}
                >
                  {copy.types[value]}
                </button>
              ))}
            </div>
          )}
          {onAdd && target && (
            <p className="ml-auto flex min-w-0 items-center gap-1.5 text-[11px] text-mist">
              <ListMusic size={12} aria-hidden className="shrink-0" />
              <span className="truncate">{copy.addingTo(target)}</span>
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-white/8 px-2 py-2 md:px-4">
          {link ? (
            <LinkRow source={link} input={trimmed} onAdd={onAdd} />
          ) : result.status === 'loading' ? (
            <p className="flex items-center gap-2 px-2 py-3 text-xs text-mist">
              <Loader2 size={14} className="animate-spin" />
              {copy.searching}
            </p>
          ) : result.status === 'error' ? (
            <p role="alert" className="px-2 py-3 text-xs text-nope">
              {result.message}
            </p>
          ) : result.status === 'done' && results.length === 0 ? (
            <p className="px-2 py-3 text-xs text-mist">{copy.empty}</p>
          ) : results.length > 0 ? (
            <ul className="space-y-1">
              {results.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <ResultRow
                    source={{ kind: item.kind, id: item.id }}
                    title={item.title}
                    meta={[item.channel, item.live ? copy.live : item.kind === 'playlist' ? item.videoCount : item.duration].filter(Boolean).join(' · ')}
                    live={item.live}
                    thumbnail={item.thumbnail}
                    onAdd={onAdd}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid h-full place-items-center px-8 text-center">
              <div className="space-y-2 text-mist">
                <Search size={26} aria-hidden className="mx-auto opacity-40" />
                <p className="text-xs">{copy.hint}</p>
              </div>
            </div>
          )}
        </div>

        {snapshot.state !== 'idle' && <SearchPlayer />}
      </div>
    </div>,
    document.body,
  )
}

/** Lecteur au pied de l'écran de recherche : on écoute, on avance, on règle le son sans le quitter. */
function SearchPlayer() {
  const { title, detail } = useAmbientLabel()
  return (
    <div className="shrink-0 space-y-1.5 border-t border-white/10 px-4 pt-2.5 pb-safe md:px-6 md:pb-5">
      <div className="flex items-center gap-2.5">
        <AudioLines size={16} aria-hidden className="shrink-0 text-glow" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-cream">{title}</p>
          {detail && <p className="truncate text-[10px] text-mist">{detail}</p>}
        </div>
        <VolumeButton placement="above" />
      </div>
      <SeekBar compact />
      <TransportControls size="sm" />
    </div>
  )
}

/** Lien collé : une seule ligne, titre lu en ligne (oEmbed). */
function LinkRow({ source, input, onAdd }: { source: AmbientSource; input: string; onAdd?: OnAdd }) {
  const t = useT()
  const [title, setTitle] = useState<string | null>(null)
  const { kind, id } = source
  // Dépend de l'identifiant, pas de l'objet (recréé à chaque rendu : la requête repartirait sans fin).
  useEffect(() => {
    const controller = new AbortController()
    void fetchYouTubeTitle({ kind, id } as AmbientSource, controller.signal).then((found) => {
      if (!controller.signal.aborted) setTitle(found)
    })
    return () => controller.abort()
  }, [kind, id])
  return (
    <ResultRow
      source={source}
      title={title ?? t.ambient.search.link}
      meta={source.kind === 'playlist' ? t.ambient.search.types.playlist : input}
      thumbnail={source.kind === 'video' ? `https://i.ytimg.com/vi/${source.id}/mqdefault.jpg` : null}
      onAdd={onAdd}
      knownTitle={title}
    />
  )
}

interface ResultRowProps {
  source: AmbientSource
  title: string
  meta: string
  live?: boolean
  thumbnail: string | null
  onAdd?: OnAdd
  /** Titre réel (lien collé) : `title` peut n'être qu'un libellé d'attente. */
  knownTitle?: string | null
}

function ResultRow({ source, title, meta, live = false, thumbnail, onAdd, knownTitle }: ResultRowProps) {
  const t = useT()
  const copy = t.ambient.search
  const snapshot = useAmbientPlayer()
  const current = snapshot.source?.id === source.id
  const playing = current && (snapshot.state === 'playing' || snapshot.state === 'loading')
  const track: PickedTrack = { kind: source.kind, ref: source.id, title: knownTitle === undefined ? title : knownTitle }

  const toggle = () => {
    vibrate(6)
    if (playing) ambientPlayer.pause()
    else if (current && snapshot.state === 'paused') ambientPlayer.resume()
    else playAmbient(source.id)
  }

  return (
    <div
      className={`flex items-center gap-2.5 rounded-xl p-1.5 transition-colors ${
        current ? 'bg-glow/12 ring-1 ring-glow/45' : 'hover:bg-white/[0.04]'
      }`}
    >
      <div className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
        {thumbnail && <img src={thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
        {source.kind === 'playlist' && (
          <span aria-hidden className="absolute inset-y-0 right-0 grid w-6 place-items-center bg-black/70 text-cream">
            <ListMusic size={12} />
          </span>
        )}
        {current && (
          <span aria-hidden className="absolute inset-0 grid place-items-center bg-void/55 text-glow">
            <AudioLines size={18} className={playing ? 'animate-pulse' : ''} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {current && <p className="text-[9px] font-semibold tracking-[0.16em] text-glow uppercase">{copy.nowPlaying}</p>}
        <p className={`line-clamp-2 text-xs leading-snug ${current ? 'font-medium text-cream' : 'text-cream'}`}>{title}</p>
        {meta && (
          <p className={`mt-0.5 truncate text-[11px] ${live ? 'text-nope' : 'text-mist'}`}>
            {live && <span aria-hidden className="mr-1 inline-block size-1.5 rounded-full bg-nope align-middle" />}
            {meta}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t.ambient.pause : copy.play(title)}
        className={`grid size-9 shrink-0 place-items-center rounded-full ${current ? 'bg-glow text-white' : 'text-cream/75 hover:bg-white/10'}`}
      >
        {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
      </button>
      {onAdd ? <DirectAdd track={track} onAdd={onAdd} /> : <AddToPlaylist track={track} />}
    </div>
  )
}

/** Issue d'un ajout direct, pour le bouton : ajouté, déjà là, playlist pleine, ou échec. */
type DirectResult = 'added' | 'duplicate' | 'full' | 'error'

/**
 * Ajout d'un tap dans la playlist ouverte, avec son retour : ✓ vert (ajouté),
 * ✓ doré (déjà dedans). Une playlist YouTube y verse tous ses morceaux.
 */
function DirectAdd({ track, onAdd }: { track: PickedTrack; onAdd: OnAdd }) {
  const t = useT()
  const language = useLanguage()
  const notify = useUiStore((state) => state.notify)
  const [result, setResult] = useState<DirectResult | null>(null)
  const [busy, setBusy] = useState(false)
  const settled = result === 'added' || result === 'duplicate'

  const add = async () => {
    setBusy(true)
    try {
      // Lien collé sans titre encore lu : on le demande avant d'enregistrer.
      const picked =
        track.kind === 'video' && !track.title ? { ...track, title: await fetchYouTubeTitle({ kind: 'video', id: track.ref }) } : track
      const { tracks } = await tracksOf(picked, language)
      const report = onAdd(tracks)
      const outcome: DirectResult = !report ? 'error' : report.added > 0 ? 'added' : report.overflow > 0 ? 'full' : 'duplicate'
      setResult(outcome)
      if (report && report.added > 0) {
        vibrate(12)
        if (track.kind === 'playlist') notify(t.ambient.addTo.addedHere(report.added), 'like')
      }
    } catch {
      setResult('error')
      notify(t.ambient.addTo.fetchError, 'nope')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void add()}
      disabled={settled || busy}
      aria-label={settled ? (result === 'added' ? t.ambient.search.added : t.ambient.addTo.already) : t.ambient.search.add(track.title ?? t.ambient.youtube)}
      title={result === 'duplicate' ? t.ambient.addTo.already : undefined}
      className={`grid size-9 shrink-0 place-items-center rounded-full transition-colors ${
        result === 'added' ? 'bg-like/20 text-like' : result === 'duplicate' ? 'bg-gold/15 text-gold' : 'bg-cream text-void disabled:opacity-50'
      }`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : settled ? <Check size={14} strokeWidth={2.6} /> : <Plus size={14} strokeWidth={2.4} />}
    </button>
  )
}
