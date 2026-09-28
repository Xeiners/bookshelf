import { useContext, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  ChevronDown,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { AmbientSuggestionContext, useAmbientLabel, useAmbientPlayer } from '../../hooks/useAmbientMusic'
import { useT } from '../../i18n'
import { fetchYouTubeTitle, playAmbient, playlistIdOf, playlistKey } from '../../lib/audio/ambientPlayback'
import { AMBIENT_PRESET_IDS } from '../../lib/audio/ambientPresets'
import { ambientPlayer, type AmbientSource } from '../../lib/audio/youtubePlayer'
import { AMBIENT_LIMITS, useAmbientStore, type AmbientPlaylist } from '../../store/useAmbientStore'
import { Pressable } from '../ui/Pressable'
import { YouTubeSearch, type PickedTrack } from './YouTubeSearch'

const eyebrow = 'text-[10px] font-semibold tracking-[0.22em] text-mist uppercase' // i18n-ignore : classes CSS
const field =
  'min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs text-cream placeholder:text-mist/60 focus:border-glow/60 focus:outline-none' // i18n-ignore : classes CSS
const iconButton =
  'grid size-8 shrink-0 place-items-center rounded-full text-cream/70 hover:bg-white/10 disabled:opacity-30' // i18n-ignore : classes CSS

type Tab = 'moods' | 'playlists'

/**
 * Commandes de la musique d'ambiance, communes au popover du lecteur et à la
 * feuille « Musique » : en cours, volume, ambiances par genre, playlists
 * enregistrées (création, morceaux, ordre) et lien YouTube libre.
 */
export function AmbientPanel() {
  const t = useT()
  const copy = t.ambient
  const lastSource = useAmbientStore((state) => state.lastSource)
  const autoPlay = useAmbientStore((state) => state.autoPlay)
  const setAutoPlay = useAmbientStore((state) => state.setAutoPlay)
  const [tab, setTab] = useState<Tab>(() => (playlistIdOf(lastSource) !== null ? 'playlists' : 'moods'))

  return (
    <div className="space-y-4">
      <NowPlaying />
      <VolumeSlider />

      <div role="tablist" aria-label={copy.open} className="flex gap-1 rounded-2xl bg-white/[0.04] p-1">
        {(['moods', 'playlists'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-w-0 flex-1 truncate rounded-xl px-2 py-2 text-[11px] font-medium transition-colors ${
              tab === id ? 'bg-glow/20 text-cream ring-1 ring-glow/50' : 'text-cream/60'
            }`}
          >
            {copy.tabs[id]}
          </button>
        ))}
      </div>

      {tab === 'moods' ? <MoodsTab /> : <PlaylistsTab />}

      <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-cream/80">
        {copy.autoPlay}
        <input
          type="checkbox"
          checked={autoPlay}
          onChange={(event) => setAutoPlay(event.target.checked)}
          className="size-4 shrink-0 accent-glow"
        />
      </label>
    </div>
  )
}

/* ---- En cours ------------------------------------------------------------------ */

function NowPlaying() {
  const t = useT()
  const copy = t.ambient
  const snapshot = useAmbientPlayer()
  const { title, detail } = useAmbientLabel()
  const suggested = useContext(AmbientSuggestionContext)
  const lastSource = useAmbientStore((state) => state.lastSource)
  const [saving, setSaving] = useState(false)

  const active = snapshot.state === 'playing' || snapshot.state === 'loading'
  const canSkip = snapshot.length > 1 || snapshot.source?.kind === 'playlist'
  // Déjà dans une playlist enregistrée : rien à enregistrer.
  const canSave = snapshot.source !== null && playlistIdOf(snapshot.key) === null

  const toggle = () => {
    if (active) ambientPlayer.pause()
    else if (snapshot.source && snapshot.state !== 'error') ambientPlayer.resume()
    else if (!(lastSource && playAmbient(lastSource))) playAmbient(suggested ?? 'lofi')
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <Pressable
          onClick={toggle}
          aria-label={active ? copy.pause : copy.play}
          press={0.92}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-glow text-white shadow-[0_0_18px_-2px_rgb(124_92_255/0.8)]"
        >
          {snapshot.state === 'loading' ? (
            <Loader2 size={20} className="animate-spin" />
          ) : active ? (
            <Pause size={20} />
          ) : (
            <Play size={20} className="translate-x-px" />
          )}
        </Pressable>
        <div className="min-w-0 flex-1">
          <p className={eyebrow}>{copy.title}</p>
          <p className="truncate text-sm font-medium text-cream">{title}</p>
          {detail && (
            <p aria-live="polite" className={`truncate text-[11px] ${snapshot.state === 'error' ? 'text-nope' : 'text-mist'}`}>
              {detail}
            </p>
          )}
        </div>
        {snapshot.state !== 'idle' && (
          <button type="button" onClick={ambientPlayer.stop} aria-label={copy.stop} className={iconButton}>
            <Square size={13} />
          </button>
        )}
      </div>

      {(canSkip || canSave) && (
        <div className="mt-2 flex items-center gap-1 pl-[3.75rem]">
          {canSkip && (
            <>
              <button type="button" onClick={ambientPlayer.previous} aria-label={copy.previous} className={iconButton}>
                <SkipBack size={15} />
              </button>
              <button type="button" onClick={ambientPlayer.next} aria-label={copy.next} className={iconButton}>
                <SkipForward size={15} />
              </button>
            </>
          )}
          {canSave && (
            <button
              type="button"
              onClick={() => setSaving((open) => !open)}
              aria-expanded={saving}
              className="ml-auto flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] text-cream/75 hover:bg-white/10"
            >
              <BookmarkPlus size={14} />
              {copy.saveCurrent}
            </button>
          )}
        </div>
      )}

      {saving && snapshot.source && (
        <SaveChooser source={snapshot.source} knownTitle={snapshot.source.kind === 'video' ? snapshot.title : null} />
      )}
    </div>
  )
}

/** Choix de la playlist où enregistrer le morceau en cours (ou une nouvelle). */
function SaveChooser({ source, knownTitle }: { source: AmbientSource; knownTitle: string | null }) {
  const t = useT()
  const copy = t.ambient
  const playlists = useAmbientStore((state) => state.playlists)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const save = async (target: AmbientPlaylist | null) => {
    if (busy) return
    setBusy(true)
    const store = useAmbientStore.getState()
    const id = target?.id ?? store.createPlaylist(copy.playlists.defaultName(playlists.length + 1))
    if (id === null) {
      setMessage(copy.playlists.limit)
      setBusy(false)
      return
    }
    const title = knownTitle ?? (await fetchYouTubeTitle(source))
    const ok = store.addTrack(id, { kind: source.kind, ref: source.id, title })
    const name = useAmbientStore.getState().playlists.find((entry) => entry.id === id)?.name ?? ''
    setMessage(ok ? copy.saved(name) : copy.playlistFull)
    setBusy(false)
  }

  return (
    <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
      <p className={`${eyebrow} px-1`}>{copy.saveTo}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            type="button"
            disabled={busy}
            onClick={() => void save(playlist)}
            className="max-w-full truncate rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] text-cream/85 hover:bg-white/10 disabled:opacity-50"
          >
            {playlist.name}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(null)}
          className="flex items-center gap-1 rounded-full border border-dashed border-glow/50 px-3 py-1.5 text-[11px] text-cream/85 disabled:opacity-50"
        >
          <Plus size={12} />
          {copy.playlists.create}
        </button>
      </div>
      {message && (
        <p role="status" className="mt-1.5 px-1 text-[11px] text-like">
          {message}
        </p>
      )}
    </div>
  )
}

/* ---- Volume ------------------------------------------------------------------- */

function VolumeSlider() {
  const t = useT()
  const volume = useAmbientStore((state) => state.volume)
  const setVolume = useAmbientStore((state) => state.setVolume)
  const VolumeIcon = volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2
  return (
    <label className="flex items-center gap-3">
      <VolumeIcon size={16} aria-hidden className="shrink-0 text-cream/70" />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={volume}
        onChange={(event) => {
          const next = Number(event.target.value)
          setVolume(next)
          ambientPlayer.setVolume(next)
        }}
        aria-label={t.ambient.volume}
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-cream [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cream [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgb(124_92_255/0.9)]"
        style={{
          background: `linear-gradient(to right, var(--color-glow) ${volume}%, rgb(255 255 255 / 0.14) ${volume}%)`,
        }}
      />
      <span className="w-8 shrink-0 text-right text-[11px] text-mist tabular-nums">{volume}</span>
    </label>
  )
}

/* ---- Ambiances ------------------------------------------------------------------- */

function MoodsTab() {
  const t = useT()
  const copy = t.ambient
  const suggested = useContext(AmbientSuggestionContext)
  const { key } = useAmbientPlayer()
  const lastSource = useAmbientStore((state) => state.lastSource)
  const selected = key ?? lastSource

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label={copy.tabs.moods} className="grid grid-cols-2 gap-1.5">
        {AMBIENT_PRESET_IDS.map((id) => {
          const checked = selected === id
          const hint = copy.presets[id].hint
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => playAmbient(id)}
              className={`min-w-0 rounded-2xl border px-3 py-2 text-left transition-colors ${
                checked ? 'border-glow/70 bg-glow/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium text-cream">{copy.presets[id].label}</span>
                {id === suggested && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-gold" />}
              </span>
              <span className="block truncate text-[10px] text-mist">
                {id === suggested ? `${copy.suggested} · ${hint}` : hint}
              </span>
            </button>
          )
        })}
      </div>

      <YouTubeSearch />
    </div>
  )
}

/* ---- Playlists ------------------------------------------------------------------- */

function PlaylistsTab() {
  const t = useT()
  const copy = t.ambient.playlists
  const playlists = useAmbientStore((state) => state.playlists)
  const createPlaylist = useAmbientStore((state) => state.createPlaylist)
  const [name, setName] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const full = playlists.length >= AMBIENT_LIMITS.playlists

  const create = (event: FormEvent) => {
    event.preventDefault()
    const id = createPlaylist(name.trim() || copy.defaultName(playlists.length + 1))
    if (id === null) return
    setName('')
    setExpanded(id)
  }

  return (
    <div className="space-y-3">
      {playlists.length === 0 && <p className="text-[11px] leading-relaxed text-mist">{copy.empty}</p>}

      <ul className="space-y-1.5">
        {playlists.map((playlist) => (
          <PlaylistRow
            key={playlist.id}
            playlist={playlist}
            expanded={expanded === playlist.id}
            onToggle={() => setExpanded((current) => (current === playlist.id ? null : playlist.id))}
          />
        ))}
      </ul>

      {full ? (
        <p className="text-[11px] text-mist">{copy.limit}</p>
      ) : (
        <form onSubmit={create} className="flex gap-1.5">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={AMBIENT_LIMITS.name}
            placeholder={copy.namePlaceholder}
            aria-label={copy.namePlaceholder}
            className={field}
          />
          <button
            type="submit"
            className="flex shrink-0 items-center gap-1 rounded-full bg-cream px-3.5 text-xs font-medium text-void"
          >
            <Plus size={13} />
            {copy.createSubmit}
          </button>
        </form>
      )}
    </div>
  )
}

function PlaylistRow({
  playlist,
  expanded,
  onToggle,
}: {
  playlist: AmbientPlaylist
  expanded: boolean
  onToggle: () => void
}) {
  const t = useT()
  const copy = t.ambient.playlists
  const snapshot = useAmbientPlayer()
  const key = playlistKey(playlist.id)
  const current = snapshot.key === key
  const playing = current && (snapshot.state === 'playing' || snapshot.state === 'loading')
  const empty = playlist.tracks.length === 0

  const toggle = () => {
    if (playing) ambientPlayer.pause()
    else if (current && snapshot.state === 'paused') ambientPlayer.resume()
    else playAmbient(key)
  }

  return (
    <li
      className={`rounded-2xl border transition-colors ${
        current ? 'border-glow/60 bg-glow/10' : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      <div className="flex items-center gap-2 p-1.5">
        <button
          type="button"
          onClick={toggle}
          disabled={empty}
          aria-label={playing ? t.ambient.pause : copy.play(playlist.name)}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-cream disabled:opacity-30"
        >
          {playing ? <Pause size={15} /> : <Play size={15} className="translate-x-px" />}
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={copy.edit(playlist.name)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ListMusic size={14} aria-hidden className="shrink-0 text-glow" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-cream">{playlist.name}</span>
            <span className="block text-[10px] text-mist">{copy.tracks(playlist.tracks.length)}</span>
          </span>
          <ChevronDown
            size={15}
            aria-hidden
            className={`mr-1 shrink-0 text-cream/60 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      {expanded && <PlaylistEditor playlist={playlist} playingIndex={current ? snapshot.index : null} />}
    </li>
  )
}

function PlaylistEditor({ playlist, playingIndex }: { playlist: AmbientPlaylist; playingIndex: number | null }) {
  const t = useT()
  const copy = t.ambient.playlists
  const { renamePlaylist, deletePlaylist, addTrack, removeTrack, moveTrack } = useAmbientStore.getState()
  const [name, setName] = useState(playlist.name)
  const [full, setFull] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const key = playlistKey(playlist.id)

  const add = (track: PickedTrack) => {
    const ok = addTrack(playlist.id, track)
    setFull(!ok)
    return ok
  }

  return (
    <div className="space-y-3 border-t border-white/10 px-2.5 pb-2.5 pt-2.5">
      <input
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => (name.trim() ? renamePlaylist(playlist.id, name) : setName(playlist.name))}
        maxLength={AMBIENT_LIMITS.name}
        aria-label={copy.rename}
        className={`${field} w-full`}
      />

      {playlist.tracks.length === 0 ? (
        <p className="text-[11px] text-mist">{copy.emptyTracks}</p>
      ) : (
        <ol className="space-y-0.5">
          {playlist.tracks.map((track, index) => {
            const label = track.title ?? (track.kind === 'playlist' ? t.ambient.youtube : track.ref)
            return (
              <li key={track.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => playAmbient(key, { index })}
                  aria-label={copy.playTrack(label)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-white/[0.06] ${
                    playingIndex === index ? 'text-glow' : 'text-cream/85'
                  }`}
                >
                  <span className="w-4 shrink-0 text-right text-[10px] text-mist tabular-nums">{index + 1}</span>
                  {track.kind === 'playlist' && <ListMusic size={12} aria-hidden className="shrink-0 text-mist" />}
                  <span className="truncate text-[11px]">{label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => moveTrack(playlist.id, track.id, -1)}
                  disabled={index === 0}
                  aria-label={copy.moveUp}
                  className={iconButton}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => moveTrack(playlist.id, track.id, 1)}
                  disabled={index === playlist.tracks.length - 1}
                  aria-label={copy.moveDown}
                  className={iconButton}
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => removeTrack(playlist.id, track.id)}
                  aria-label={copy.removeTrack(label)}
                  className={`${iconButton} hover:text-nope`}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            )
          })}
        </ol>
      )}

      <YouTubeSearch onAdd={add} />
      {full && (
        <p role="alert" className="text-[11px] text-nope">
          {t.ambient.playlistFull}
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          if (!confirmDelete) {
            setConfirmDelete(true)
            return
          }
          if (ambientPlayer.getSnapshot().key === key) ambientPlayer.stop()
          deletePlaylist(playlist.id)
        }}
        onBlur={() => setConfirmDelete(false)}
        className={`flex w-full items-center justify-center gap-1.5 rounded-full py-2 text-[11px] ${
          confirmDelete ? 'bg-nope/15 text-nope' : 'text-nope/80 hover:bg-nope/10'
        }`}
      >
        <Trash2 size={12} />
        {confirmDelete ? copy.deleteConfirm : copy.delete}
      </button>
    </div>
  )
}
