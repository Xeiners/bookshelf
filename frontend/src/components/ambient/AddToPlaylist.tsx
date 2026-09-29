import { useState, type FormEvent } from 'react'
import { Check, ListMusic, ListPlus, Loader2, Plus } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { musicApi } from '../../services/musicApi'
import { AMBIENT_LIMITS, useAmbientStore, type AddTrackResult, type AmbientTrack } from '../../store/useAmbientStore'
import { useUiStore } from '../../store/useUiStore'
import { FloatingPanel } from '../ui/FloatingPanel'

/** Morceau prêt à enregistrer dans une playlist. */
export type PickedTrack = Omit<AmbientTrack, 'id'>

interface AddToPlaylistProps {
  track: PickedTrack
  /** Playlist YouTube : on peut aussi la recréer telle quelle, morceau par morceau. */
  importable?: boolean
  /** Bulle au-dessus du bouton (mini-lecteur en bas d'écran). */
  placement?: 'below' | 'above'
  className?: string
}

/**
 * « + » d'un morceau : une bulle liste les playlists (la dernière utilisée
 * d'abord, ✓ si le morceau y est déjà), en crée une au passage, ou importe une
 * playlist YouTube entière. Retour immédiat : le bouton passe en ✓, un
 * message dit où le morceau est parti.
 */
export function AddToPlaylist({ track, importable = false, placement = 'below', className = '' }: AddToPlaylistProps) {
  const t = useT()
  const copy = t.ambient.addTo
  const [anchor, setAnchor] = useState<{ rect: DOMRect; trigger: HTMLElement } | null>(null)
  /** Ajouté pendant cette session d'écran : le bouton le montre. */
  const [done, setDone] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          vibrate(6)
          setAnchor(anchor ? null : { rect: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget })
        }}
        aria-label={copy.button(track.title ?? t.ambient.youtube)}
        aria-expanded={anchor !== null}
        className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors ${
          done ? 'bg-like/20 text-like' : anchor ? 'bg-glow text-white' : 'bg-cream text-void'
        } ${className}`}
      >
        {done ? <Check size={14} strokeWidth={2.6} /> : <Plus size={14} strokeWidth={2.4} />}
      </button>
      {anchor && (
        <FloatingPanel anchor={anchor.rect} trigger={anchor.trigger} placement={placement} width={280} label={copy.title} onClose={() => setAnchor(null)}>
          <PlaylistChooser
            track={track}
            importable={importable}
            onDone={() => {
              setDone(true)
              setAnchor(null)
            }}
          />
        </FloatingPanel>
      )}
    </>
  )
}

function PlaylistChooser({ track, importable, onDone }: { track: PickedTrack; importable: boolean; onDone: () => void }) {
  const t = useT()
  const copy = t.ambient.addTo
  const language = useLanguage()
  const notify = useUiStore((state) => state.notify)
  const playlists = useAmbientStore((state) => state.playlists)
  const lastPlaylistId = useAmbientStore((state) => state.lastPlaylistId)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [importing, setImporting] = useState(false)

  // La dernière playlist servie en tête : un deuxième ajout ne demande qu'un tap.
  const ordered = [...playlists].sort((a, b) => Number(b.id === lastPlaylistId) - Number(a.id === lastPlaylistId))

  const report = (result: AddTrackResult, playlistName: string) => {
    if (result === 'added') {
      vibrate(12)
      notify(copy.added(playlistName), 'like')
      onDone()
    } else if (result === 'duplicate') setFeedback({ tone: 'warn', text: copy.duplicate(playlistName) })
    else if (result === 'full') setFeedback({ tone: 'warn', text: t.ambient.playlistFull })
  }

  const addTo = (playlistId: string, playlistName: string) => report(useAmbientStore.getState().addTrack(playlistId, track), playlistName)

  const create = (event: FormEvent) => {
    event.preventDefault()
    const store = useAmbientStore.getState()
    const playlistName = name.trim() || t.ambient.playlists.defaultName(playlists.length + 1)
    const id = store.createPlaylist(playlistName)
    if (id === null) {
      setFeedback({ tone: 'warn', text: t.ambient.playlists.limit })
      return
    }
    addTo(id, playlistName)
  }

  const importAll = async () => {
    setImporting(true)
    setFeedback(null)
    try {
      const imported = await musicApi.playlist(track.ref, language)
      const id = useAmbientStore
        .getState()
        .importPlaylist(imported.title, imported.videos.map((video) => ({ kind: 'video' as const, ref: video.id, title: video.title })))
      if (id === null) {
        setFeedback({ tone: 'warn', text: t.ambient.playlists.limit })
        return
      }
      vibrate(14)
      notify(t.ambient.import.created(imported.title, Math.min(imported.videos.length, AMBIENT_LIMITS.tracks)), 'like')
      onDone()
    } catch {
      setFeedback({ tone: 'warn', text: t.ambient.import.error })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-1">
      <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-[0.2em] text-mist uppercase">{copy.title}</p>

      {importable && (
        <button
          type="button"
          onClick={() => void importAll()}
          disabled={importing}
          className="flex w-full items-center gap-2.5 rounded-2xl bg-glow/15 px-2.5 py-2 text-left hover:bg-glow/25 disabled:opacity-60"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-glow text-white">
            {importing ? <Loader2 size={14} className="animate-spin" /> : <ListPlus size={14} />}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium text-cream">{t.ambient.import.asPlaylist}</span>
            <span className="block text-[10px] text-mist">{t.ambient.import.asPlaylistHint}</span>
          </span>
        </button>
      )}

      <ul className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain">
        {ordered.map((playlist) => {
          const inside = playlist.tracks.some((entry) => entry.ref === track.ref)
          return (
            <li key={playlist.id}>
              <button
                type="button"
                role="menuitem"
                onClick={() => addTo(playlist.id, playlist.name)}
                disabled={inside}
                className="flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left hover:bg-white/[0.06] disabled:hover:bg-transparent"
              >
                <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${inside ? 'bg-like/15 text-like' : 'bg-white/[0.06] text-glow'}`}>
                  {inside ? <Check size={14} strokeWidth={2.6} /> : <ListMusic size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-cream">{playlist.name}</span>
                  <span className="block text-[10px] text-mist">
                    {inside ? copy.already : t.ambient.playlists.tracks(playlist.tracks.length)}
                    {playlist.id === lastPlaylistId && !inside && ` · ${copy.last}`}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {creating ? (
        <form onSubmit={create} className="flex gap-1.5 px-1 pt-1">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={AMBIENT_LIMITS.name}
            placeholder={t.ambient.playlists.namePlaceholder}
            aria-label={t.ambient.playlists.namePlaceholder}
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-cream placeholder:text-mist/60 focus:border-glow/60 focus:outline-none"
          />
          <button type="submit" className="shrink-0 rounded-full bg-cream px-3 text-[11px] font-medium text-void">
            {copy.create}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-white/15 px-2.5 py-2 text-left text-xs text-cream/85 hover:bg-white/[0.04]"
        >
          <Plus size={14} className="mx-2 shrink-0 text-glow" />
          {t.ambient.playlists.create}
        </button>
      )}

      {feedback && (
        <p role="status" className={`px-2 pt-1 text-[11px] ${feedback.tone === 'ok' ? 'text-like' : 'text-gold'}`}>
          {feedback.text}
        </p>
      )}
    </div>
  )
}
