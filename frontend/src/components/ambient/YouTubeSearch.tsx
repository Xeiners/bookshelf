import { useEffect, useId, useState, type FormEvent } from 'react'
import { Check, ListMusic, Loader2, Play, Plus, Search } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { fetchYouTubeTitle, playAmbient } from '../../lib/audio/ambientPlayback'
import { parseYouTubeSource, type AmbientSource } from '../../lib/audio/youtubePlayer'
import { apiErrorMessage } from '../../lib/apiErrors'
import { musicApi, type MusicSearchResult, type MusicSearchType } from '../../services/musicApi'

/** Morceau prêt à enregistrer dans une playlist. */
export interface PickedTrack {
  kind: 'video' | 'playlist'
  ref: string
  title: string | null
}

interface YouTubeSearchProps {
  /**
   * Ajout à une playlist ; absent, les résultats se jouent seulement. `false`
   * si l'ajout est refusé (playlist pleine).
   */
  onAdd?: (track: PickedTrack) => boolean
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
 * morceaux ou de playlists, dont chaque résultat s'écoute ou s'ajoute.
 */
export function YouTubeSearch({ onAdd }: YouTubeSearchProps) {
  const t = useT()
  const copy = t.ambient.search
  const language = useLanguage()
  const inputId = useId()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<MusicSearchType>('video')
  const [result, setResult] = useState<SearchState>({ status: 'idle' })
  /** Identifiants ajoutés depuis cette recherche : ✓ au lieu de +. */
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())
  const [adding, setAdding] = useState<string | null>(null)

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

  const add = async (source: AmbientSource, knownTitle: string | null) => {
    if (!onAdd || adding) return
    setAdding(source.id)
    const title = knownTitle ?? (await fetchYouTubeTitle(source))
    if (onAdd({ kind: source.kind, ref: source.id, title })) setAdded((current) => new Set(current).add(source.id))
    setAdding(null)
  }

  // Entrée sur un lien : ajout (ou lecture sans playlist) ; sur du texte, la recherche part déjà seule.
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!link) return
    if (onAdd) void add(link, null)
    else playAmbient(trimmed)
  }

  return (
    <div className="space-y-2">
      <form onSubmit={submit}>
        <label htmlFor={inputId} className="text-[10px] font-semibold tracking-[0.22em] text-mist uppercase">
          {copy.label}
        </label>
        <div className="relative mt-2">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mist" />
          <input
            id={inputId}
            type="search"
            enterKeyHint={link ? 'done' : 'search'}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.placeholder}
            className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-3.5 text-xs text-cream placeholder:text-mist/60 focus:border-glow/60 focus:outline-none"
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
        <ResultRow
          title={copy.link}
          meta={link.kind === 'playlist' ? copy.types.playlist : link.id}
          kind={link.kind}
          thumbnail={link.kind === 'video' ? `https://i.ytimg.com/vi/${link.id}/mqdefault.jpg` : null}
          onPlay={() => playAmbient(trimmed)}
          onAdd={onAdd ? () => void add(link, null) : undefined}
          added={added.has(link.id)}
          busy={adding === link.id}
        />
      ) : state.status === 'loading' ? (
        <p className="flex items-center gap-2 px-1 py-2 text-[11px] text-mist">
          <Loader2 size={13} className="animate-spin" />
          {copy.searching}
        </p>
      ) : state.status === 'error' ? (
        <p role="alert" className="px-1 py-2 text-[11px] text-nope">
          {state.message}
        </p>
      ) : state.status === 'done' && state.results.length === 0 ? (
        <p className="px-1 py-2 text-[11px] text-mist">{copy.empty}</p>
      ) : state.status === 'done' ? (
        <ul className="-mx-1 max-h-72 space-y-0.5 overflow-y-auto overscroll-contain px-1">
          {state.results.map((result) => (
            <li key={`${result.kind}-${result.id}`}>
              <ResultRow
                title={result.title}
                meta={[
                  result.channel,
                  result.live ? copy.live : result.kind === 'playlist' ? result.videoCount : result.duration,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                kind={result.kind}
                live={result.live}
                thumbnail={result.thumbnail}
                onPlay={() => playAmbient(result.id)}
                onAdd={onAdd ? () => void add({ kind: result.kind, id: result.id }, result.title) : undefined}
                added={added.has(result.id)}
                busy={adding === result.id}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

interface ResultRowProps {
  title: string
  meta: string
  kind: 'video' | 'playlist'
  live?: boolean
  thumbnail: string | null
  onPlay: () => void
  onAdd?: () => void
  added: boolean
  busy: boolean
}

function ResultRow({ title, meta, kind, live = false, thumbnail, onPlay, onAdd, added, busy }: ResultRowProps) {
  const t = useT()
  const copy = t.ambient.search
  return (
    <div className="flex items-center gap-2 rounded-xl p-1 hover:bg-white/[0.04]">
      <div className="relative aspect-video w-16 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
        {thumbnail && <img src={thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
        {kind === 'playlist' && (
          <span aria-hidden className="absolute inset-y-0 right-0 grid w-6 place-items-center bg-black/70 text-cream">
            <ListMusic size={12} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[11px] leading-snug text-cream">{title}</p>
        {meta && (
          <p className={`truncate text-[10px] ${live ? 'text-nope' : 'text-mist'}`}>
            {live && <span aria-hidden className="mr-1 inline-block size-1.5 rounded-full bg-nope align-middle" />}
            {meta}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onPlay}
        aria-label={copy.play(title)}
        className="grid size-8 shrink-0 place-items-center rounded-full text-cream/75 hover:bg-white/10"
      >
        <Play size={14} className="translate-x-px" />
      </button>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          disabled={added || busy}
          aria-label={added ? copy.added : copy.add(title)}
          className={`grid size-8 shrink-0 place-items-center rounded-full ${
            added ? 'bg-like/15 text-like' : 'bg-cream text-void disabled:opacity-50'
          }`}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : added ? <Check size={14} /> : <Plus size={14} />}
        </button>
      )}
    </div>
  )
}
