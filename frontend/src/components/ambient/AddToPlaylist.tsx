import { useState, type FormEvent } from 'react'
import { Check, ListMusic, Loader2, Plus } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { tracksOf } from '../../lib/audio/ambientPlayback'
import { vibrate } from '../../lib/haptics'
import { AMBIENT_LIMITS, useAmbientStore, type AddTracksReport, type AmbientTrack } from '../../store/useAmbientStore'
import { useUiStore } from '../../store/useUiStore'
import { FloatingPanel } from '../ui/FloatingPanel'

/** Morceau prêt à enregistrer : une vidéo, ou une playlist YouTube (dépliée en ses vidéos à l'ajout). */
export type PickedTrack = Omit<AmbientTrack, 'id'>

interface AddToPlaylistProps {
  track: PickedTrack
  /** Bulle au-dessus du bouton (mini-lecteur en bas d'écran). */
  placement?: 'below' | 'above'
  className?: string
}

/**
 * « + » d'un morceau ou d'une playlist YouTube : une bulle liste les
 * playlists (la dernière utilisée d'abord), en crée une au passage. Une
 * playlist YouTube y verse tous ses morceaux, un par un. Retour immédiat : le
 * bouton passe en ✓, un message dit combien de morceaux sont partis, et où.
 */
export function AddToPlaylist({ track, placement = 'below', className = '' }: AddToPlaylistProps) {
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
        <FloatingPanel anchor={anchor.rect} trigger={anchor.trigger} placement={placement} width={288} label={copy.title} onClose={() => setAnchor(null)}>
          <PlaylistChooser
            track={track}
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

/** Clé de chargement de « Nouvelle playlist ». */
const NEW = 'new'

function PlaylistChooser({ track, onDone }: { track: PickedTrack; onDone: () => void }) {
  const t = useT()
  const copy = t.ambient.addTo
  const language = useLanguage()
  const notify = useUiStore((state) => state.notify)
  const playlists = useAmbientStore((state) => state.playlists)
  const lastPlaylistId = useAmbientStore((state) => state.lastPlaylistId)
  const isPlaylist = track.kind === 'playlist'
  const [creating, setCreating] = useState(false)
  // Nouvelle playlist depuis une playlist YouTube : son nom est proposé.
  const [name, setName] = useState(() => (isPlaylist ? (track.title ?? '') : ''))
  const [feedback, setFeedback] = useState<string | null>(null)
  /** Playlist en cours de remplissage (morceaux d'une playlist YouTube en route). */
  const [busy, setBusy] = useState<string | null>(null)

  // La dernière playlist servie en tête : un deuxième ajout ne demande qu'un tap.
  const ordered = [...playlists].sort((a, b) => Number(b.id === lastPlaylistId) - Number(a.id === lastPlaylistId))

  const conclude = (report: AddTracksReport, playlistName: string) => {
    if (report.added > 0) {
      vibrate(12)
      const extras = [
        report.duplicates > 0 ? copy.skipped(report.duplicates) : null,
        report.overflow > 0 ? copy.overflow(report.overflow) : null,
      ].filter(Boolean)
      notify([copy.addedCount(report.added, playlistName), ...extras].join(' · '), 'like')
      onDone()
    } else if (report.overflow > 0) setFeedback(t.ambient.playlistFull)
    else setFeedback(isPlaylist ? copy.nothingNew(playlistName) : copy.duplicate(playlistName))
  }

  /**
   * Remplit une playlist existante, ou en crée une : les morceaux d'abord
   * (une playlist YouTube injoignable ne laisse pas de playlist vide derrière elle).
   */
  const fill = async (target: { id: string; name: string } | { name: string }) => {
    if (busy) return
    const key = 'id' in target ? target.id : NEW
    setFeedback(null)
    setBusy(key)
    try {
      const { tracks } = await tracksOf(track, language)
      const store = useAmbientStore.getState()
      const id = 'id' in target ? target.id : store.createPlaylist(target.name)
      if (id === null) {
        setFeedback(t.ambient.playlists.limit)
        return
      }
      const report = useAmbientStore.getState().addTracks(id, tracks)
      if (report) conclude(report, target.name)
    } catch {
      setFeedback(copy.fetchError)
    } finally {
      setBusy(null)
    }
  }

  const create = (event: FormEvent) => {
    event.preventDefault()
    void fill({ name: name.trim() || t.ambient.playlists.defaultName(playlists.length + 1) })
  }

  return (
    <div className="space-y-1">
      <div className="px-2 pt-1 pb-1.5">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-mist uppercase">{copy.title}</p>
        {isPlaylist && <p className="mt-1 text-[11px] leading-snug text-cream/70">{copy.playlistHint}</p>}
      </div>

      <ul className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain">
        {ordered.map((playlist) => {
          // Une vidéo déjà présente : rien à ajouter. Une playlist YouTube : on ne le sait qu'en la dépliant.
          const inside = !isPlaylist && playlist.tracks.some((entry) => entry.ref === track.ref)
          const loading = busy === playlist.id
          return (
            <li key={playlist.id}>
              <button
                type="button"
                role="menuitem"
                onClick={() => void fill({ id: playlist.id, name: playlist.name })}
                disabled={inside || busy !== null}
                className="flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left hover:bg-white/[0.06] disabled:hover:bg-transparent"
              >
                <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${inside ? 'bg-like/15 text-like' : 'bg-white/[0.06] text-glow'}`}>
                  {loading ? <Loader2 size={14} className="animate-spin" /> : inside ? <Check size={14} strokeWidth={2.6} /> : <ListMusic size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-cream">{playlist.name}</span>
                  <span className="block text-[10px] text-mist">
                    {loading ? copy.fetching : inside ? copy.already : t.ambient.playlists.tracks(playlist.tracks.length)}
                    {playlist.id === lastPlaylistId && !inside && !loading && ` · ${copy.last}`}
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
          <button
            type="submit"
            disabled={busy !== null}
            className="flex shrink-0 items-center gap-1 rounded-full bg-cream px-3 text-[11px] font-medium text-void disabled:opacity-50"
          >
            {busy !== null && <Loader2 size={12} className="animate-spin" />}
            {copy.create}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={busy !== null}
          className="flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-white/15 px-2.5 py-2 text-left text-xs text-cream/85 hover:bg-white/[0.04] disabled:opacity-50"
        >
          <Plus size={14} className="mx-2 shrink-0 text-glow" />
          {t.ambient.playlists.create}
        </button>
      )}

      {feedback && (
        <p role="status" className="px-2 pt-1 text-[11px] text-gold">
          {feedback}
        </p>
      )}
    </div>
  )
}
