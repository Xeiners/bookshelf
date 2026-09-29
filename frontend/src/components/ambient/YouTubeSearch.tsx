import { useEffect, useId, useState, type FormEvent } from 'react'
import { AudioLines, Check, ListMusic, Loader2, Pause, Play, Plus, Search } from 'lucide-react'
import { useAmbientPlayer } from '../../hooks/useAmbientMusic'
import { useLanguage, useT } from '../../i18n'
import { fetchYouTubeTitle, playAmbient } from '../../lib/audio/ambientPlayback'
import { ambientPlayer, parseYouTubeSource, type AmbientSource } from '../../lib/audio/youtubePlayer'
import { apiErrorMessage } from '../../lib/apiErrors'
import { vibrate } from '../../lib/haptics'
import { musicApi, type MusicSearchResult, type MusicSearchType } from '../../services/musicApi'
import type { AddTrackResult } from '../../store/useAmbientStore'
import { AddToPlaylist, type PickedTrack } from './AddToPlaylist'

interface YouTubeSearchProps {
  /**
   * Ajout direct à une playlist précise (éditeur de playlist) : un tap suffit.
   * Absent : le « + » ouvre le choix de la playlist.
   */
  onAdd?: (track: PickedTrack) => AddTrackResult
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; results: MusicSearchResult[] }
  | { status: 'error'; message: string }

/** Délai de frappe avant de lancer la recherche. */
const DEBOUNCE_MS = 450

/**
 * Champ unique « recherche YouTube ou lien » : un lien (ou ID) se joue ou
 * s'ajoute tel quel ; du texte (« the cure ») lance une recherche de
 * morceaux ou de playlists. Le morceau en cours de lecture est mis en avant
 * (en tête, en couleur) et son bouton devient pause / reprise.
 */
export function YouTubeSearch({ onAdd }: YouTubeSearchProps) {
  const t = useT()
  const copy = t.ambient.search
  const language = useLanguage()
  const inputId = useId()
  const snapshot = useAmbientPlayer()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<MusicSearchType>('video')
  const [result, setResult] = useState<SearchState>({ status: 'idle' })

  const trimmed = query.trim()
  const link = parseYouTubeSource(trimmed)
  const searchable = link === null && trimmed.length >= 2
  // Champ vidé ou lien collé : plus de résultats affichés, sans remettre l'état à zéro dans l'effet.
  const state: SearchState = searchable ? result : { status: 'idle' }

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

  // Entrée sur un lien : lecture.
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (link) playAmbient(trimmed)
  }

  const currentId = snapshot.source?.id ?? null
  // Le morceau en cours d'abord : on sait toujours ce qu'on écoute.
  const results =
    state.status === 'done'
      ? [...state.results].sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId))
      : []

  return (
    <div className="space-y-2">
      <form onSubmit={submit}>
        <label htmlFor={inputId} className="text-[10px] font-semibold tracking-[0.22em] text-mist uppercase">
          {copy.label}
        </label>
        <div className="relative mt-2">
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-mist" />
          <input
            id={inputId}
            type="search"
            enterKeyHint={link ? 'go' : 'search'}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.placeholder}
            className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2 pr-3.5 pl-9 text-xs text-cream placeholder:text-mist/60 focus:border-glow/60 focus:outline-none"
          />
        </div>
      </form>

      {!link && (
        <div role="radiogroup" aria-label={copy.label} className="flex gap-1">
          {(['video', 'playlist'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              onClick={() => setType(value)}
              className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                type === value ? 'bg-glow/20 text-cream ring-1 ring-glow/50' : 'text-cream/60 hover:bg-white/[0.06]'
              }`}
            >
              {copy.types[value]}
            </button>
          ))}
        </div>
      )}

      {link ? (
        <LinkRow source={link} input={trimmed} onAdd={onAdd} />
      ) : state.status === 'loading' ? (
        <p className="flex items-center gap-2 px-1 py-2 text-[11px] text-mist">
          <Loader2 size={13} className="animate-spin" />
          {copy.searching}
        </p>
      ) : state.status === 'error' ? (
        <p role="alert" className="px-1 py-2 text-[11px] text-nope">
          {state.message}
        </p>
      ) : state.status === 'done' && results.length === 0 ? (
        <p className="px-1 py-2 text-[11px] text-mist">{copy.empty}</p>
      ) : results.length > 0 ? (
        <ul className="-mx-1 max-h-80 space-y-0.5 overflow-y-auto overscroll-contain px-1">
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
      ) : null}
    </div>
  )
}

/** Lien collé : une seule ligne, titre lu en ligne (oEmbed). */
function LinkRow({ source, input, onAdd }: { source: AmbientSource; input: string; onAdd?: (track: PickedTrack) => AddTrackResult }) {
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
  onAdd?: (track: PickedTrack) => AddTrackResult
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
      className={`flex items-center gap-2 rounded-xl p-1 transition-colors ${
        current ? 'bg-glow/12 ring-1 ring-glow/45' : 'hover:bg-white/[0.04]'
      }`}
    >
      <div className="relative aspect-video w-16 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
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
        <p className={`line-clamp-2 text-[11px] leading-snug ${current ? 'font-medium text-cream' : 'text-cream'}`}>{title}</p>
        {meta && (
          <p className={`truncate text-[10px] ${live ? 'text-nope' : 'text-mist'}`}>
            {live && <span aria-hidden className="mr-1 inline-block size-1.5 rounded-full bg-nope align-middle" />}
            {meta}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t.ambient.pause : copy.play(title)}
        className={`grid size-8 shrink-0 place-items-center rounded-full ${current ? 'bg-glow text-white' : 'text-cream/75 hover:bg-white/10'}`}
      >
        {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
      </button>
      {onAdd ? <DirectAdd track={track} onAdd={onAdd} /> : <AddToPlaylist track={track} importable={source.kind === 'playlist'} />}
    </div>
  )
}

/** Ajout d'un tap dans la playlist ouverte, avec son retour (✓, ou « déjà dedans »). */
function DirectAdd({ track, onAdd }: { track: PickedTrack; onAdd: (track: PickedTrack) => AddTrackResult }) {
  const t = useT()
  const [result, setResult] = useState<AddTrackResult | null>(null)
  const [busy, setBusy] = useState(false)
  const settled = result === 'added' || result === 'duplicate'

  const add = async () => {
    setBusy(true)
    // Lien collé sans titre encore lu : on le demande avant d'enregistrer.
    const title = track.title ?? (await fetchYouTubeTitle({ kind: track.kind, id: track.ref }))
    const outcome = onAdd({ ...track, title })
    setBusy(false)
    setResult(outcome)
    if (outcome === 'added') vibrate(12)
  }

  return (
    <button
      type="button"
      onClick={() => void add()}
      disabled={settled || busy}
      aria-label={settled ? (result === 'added' ? t.ambient.search.added : t.ambient.addTo.already) : t.ambient.search.add(track.title ?? t.ambient.youtube)}
      title={result === 'duplicate' ? t.ambient.addTo.already : undefined}
      className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors ${
        result === 'added' ? 'bg-like/20 text-like' : result === 'duplicate' ? 'bg-gold/15 text-gold' : 'bg-cream text-void disabled:opacity-50'
      }`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : settled ? <Check size={14} strokeWidth={2.6} /> : <Plus size={14} strokeWidth={2.4} />}
    </button>
  )
}
