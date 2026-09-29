import { useContext, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, AudioLines, ChevronDown, ListMusic, ListTree, Loader2, Pause, PencilLine, Play, Plus, Square, Trash2 } from 'lucide-react'
import { AmbientSuggestionContext, useAmbientLabel, useAmbientPlayer } from '../../hooks/useAmbientMusic'
import { useLanguage, useT } from '../../i18n'
import { playAmbient, playlistIdOf, playlistKey, tracksOf } from '../../lib/audio/ambientPlayback'
import { AMBIENT_PRESET_IDS } from '../../lib/audio/ambientPresets'
import { ambientPlayer } from '../../lib/audio/youtubePlayer'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { AMBIENT_LIMITS, useAmbientStore, type AmbientPlaylist, type AmbientTrack } from '../../store/useAmbientStore'
import { useUiStore } from '../../store/useUiStore'
import { AddToPlaylist, type PickedTrack } from './AddToPlaylist'
import { SeekBar, TransportControls, VolumeButton } from './AmbientControls'
import { PlaylistImport } from './PlaylistImport'
import { YouTubeSearch } from './YouTubeSearch'

const eyebrow = 'text-[10px] font-semibold tracking-[0.22em] text-mist uppercase' // i18n-ignore : classes CSS
const field =
  'min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs text-cream placeholder:text-mist/60 focus:border-glow/60 focus:outline-none' // i18n-ignore : classes CSS
const iconButton =
  'grid size-8 shrink-0 place-items-center rounded-full text-cream/70 hover:bg-white/10 disabled:opacity-30' // i18n-ignore : classes CSS

const TABS = ['moods', 'playlists'] as const
type Tab = (typeof TABS)[number]

/**
 * Commandes de la musique d'ambiance, communes au popover du lecteur et à la
 * feuille « Musique » : en cours (position, volume, ajout à une playlist),
 * ambiances par genre, playlists enregistrées et recherche YouTube.
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
      <SlidingTabs value={tab} onChange={setTab} />
      {/* Remonté à chaque onglet : le contenu glisse depuis le côté de l'onglet choisi. */}
      <TabContent key={tab} from={tab === 'playlists' ? 1 : -1}>
        {tab === 'moods' ? <MoodsTab /> : <PlaylistsTab />}
      </TabContent>

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

/* ---- Onglets ------------------------------------------------------------------- */

/** Deux onglets, un repère qui glisse de l'un à l'autre (transformation seule). */
function SlidingTabs({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  const t = useT()
  return (
    <div role="tablist" aria-label={t.ambient.open} className="relative grid grid-cols-2 rounded-2xl bg-white/[0.04] p-1">
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl bg-glow/20 ring-1 ring-glow/50 transition-transform duration-300 ease-out"
        style={{ transform: `translateX(${value === 'playlists' ? '100%' : '0'})` }}
      />
      {TABS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => {
            if (id === value) return
            vibrate(6)
            onChange(id)
          }}
          className={`relative z-10 truncate rounded-xl px-2 py-2.5 text-xs font-medium transition-colors ${value === id ? 'text-cream' : 'text-cream/55'}`}
        >
          {t.ambient.tabs[id]}
        </button>
      ))}
    </div>
  )
}

function TabContent({ from, children }: { from: 1 | -1; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(() => {
    gsap.from(ref.current, { x: from * 28, autoAlpha: 0, duration: 0.32, ease: EASE.swift, clearProps: 'transform,opacity,visibility' })
  })
  return <div ref={ref}>{children}</div>
}

/* ---- En cours ------------------------------------------------------------------ */

function NowPlaying() {
  const t = useT()
  const copy = t.ambient
  const snapshot = useAmbientPlayer()
  const { title, detail } = useAmbientLabel()
  const suggested = useContext(AmbientSuggestionContext)
  const lastSource = useAmbientStore((state) => state.lastSource)
  const source = snapshot.source
  // Morceau d'une playlist enregistrée : il y est déjà.
  const track: PickedTrack | null =
    source && playlistIdOf(snapshot.key) === null
      ? { kind: source.kind, ref: source.id, title: source.kind === 'video' ? snapshot.title : null }
      : null

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className={eyebrow}>{copy.title}</p>
          <p className="truncate text-sm font-medium text-cream">{title}</p>
          {detail && (
            <p aria-live="polite" className={`truncate text-[11px] ${snapshot.state === 'error' ? 'text-nope' : 'text-mist'}`}>
              {detail}
            </p>
          )}
        </div>
        <VolumeButton />
        {track && <AddToPlaylist track={track} />}
        {snapshot.state !== 'idle' && (
          <button type="button" onClick={ambientPlayer.stop} aria-label={copy.stop} className={iconButton}>
            <Square size={13} />
          </button>
        )}
      </div>
      <SeekBar />
      <TransportControls fallback={lastSource ?? suggested ?? 'lofi'} />
    </div>
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
              <span className="block truncate text-[10px] text-mist">{id === suggested ? `${copy.suggested} · ${hint}` : hint}</span>
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
    vibrate(10)
    setName('')
    setExpanded(id)
  }

  return (
    <div className="space-y-3">
      {!full && <PlaylistImport onCreated={setExpanded} />}
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
          <button type="submit" className="flex shrink-0 items-center gap-1 rounded-full bg-cream px-3.5 text-xs font-medium text-void">
            <Plus size={13} />
            {copy.createSubmit}
          </button>
        </form>
      )}
    </div>
  )
}

function PlaylistRow({ playlist, expanded, onToggle }: { playlist: AmbientPlaylist; expanded: boolean; onToggle: () => void }) {
  const t = useT()
  const copy = t.ambient.playlists
  const snapshot = useAmbientPlayer()
  const renamePlaylist = useAmbientStore((state) => state.renamePlaylist)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(playlist.name)
  const key = playlistKey(playlist.id)
  const current = snapshot.key === key
  const playing = current && (snapshot.state === 'playing' || snapshot.state === 'loading')
  const empty = playlist.tracks.length === 0

  const toggle = () => {
    if (playing) ambientPlayer.pause()
    else if (current && snapshot.state === 'paused') ambientPlayer.resume()
    else playAmbient(key)
  }

  const commitRename = (event?: FormEvent) => {
    event?.preventDefault()
    if (name.trim() && name.trim() !== playlist.name) {
      renamePlaylist(playlist.id, name)
      vibrate(8)
    } else setName(playlist.name)
    setRenaming(false)
  }

  return (
    <li className={`rounded-2xl border transition-colors ${current ? 'border-glow/60 bg-glow/10' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex items-center gap-2 p-1.5">
        <button
          type="button"
          onClick={toggle}
          disabled={empty}
          aria-label={playing ? t.ambient.pause : copy.play(playlist.name)}
          className={`grid size-9 shrink-0 place-items-center rounded-full disabled:opacity-30 ${current ? 'bg-glow text-white' : 'bg-white/10 text-cream'}`}
        >
          {playing ? <Pause size={15} /> : <Play size={15} className="translate-x-px" />}
        </button>

        {renaming ? (
          <form onSubmit={commitRename} className="min-w-0 flex-1">
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => commitRename()}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                // Échap annule le renommage, sans fermer la feuille ni le lecteur.
                event.stopPropagation()
                setName(playlist.name)
                setRenaming(false)
              }}
              maxLength={AMBIENT_LIMITS.name}
              aria-label={copy.rename}
              className="w-full rounded-full border border-glow/60 bg-white/[0.05] px-3 py-1.5 text-xs text-cream focus:outline-none"
            />
          </form>
        ) : (
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
          </button>
        )}

        {!renaming && (
          <button
            type="button"
            onClick={() => {
              setName(playlist.name)
              setRenaming(true)
            }}
            aria-label={copy.renameAction(playlist.name)}
            className={iconButton}
          >
            <PencilLine size={13} />
          </button>
        )}
        <button type="button" onClick={onToggle} aria-label={copy.edit(playlist.name)} aria-expanded={expanded} className={iconButton}>
          <ChevronDown size={15} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {expanded && <PlaylistEditor playlist={playlist} playingIndex={current ? snapshot.index : null} />}
    </li>
  )
}

function PlaylistEditor({ playlist, playingIndex }: { playlist: AmbientPlaylist; playingIndex: number | null }) {
  const t = useT()
  const copy = t.ambient.playlists
  const { deletePlaylist, addTracks, removeTrack, moveTrack } = useAmbientStore.getState()
  const [full, setFull] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const key = playlistKey(playlist.id)

  const add = (tracks: PickedTrack[]) => {
    const report = addTracks(playlist.id, tracks)
    setFull(!!report && report.added === 0 && report.overflow > 0)
    return report
  }

  return (
    <div className="space-y-3 border-t border-white/10 px-2.5 pt-2.5 pb-2.5">
      {playlist.tracks.length === 0 ? (
        <p className="text-[11px] text-mist">{copy.emptyTracks}</p>
      ) : (
        <ol className="space-y-0.5">
          {playlist.tracks.map((track, index) => {
            const label = track.title ?? (track.kind === 'playlist' ? t.ambient.youtube : track.ref)
            const now = playingIndex === index
            return (
              <li key={track.id} className={`flex items-center gap-1 rounded-xl ${now ? 'bg-glow/12' : ''}`}>
                <button
                  type="button"
                  onClick={() => playAmbient(key, { index })}
                  aria-label={copy.playTrack(label)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-white/[0.06] ${now ? 'text-glow' : 'text-cream/85'}`}
                >
                  <span className="grid w-4 shrink-0 place-items-center text-[10px] text-mist tabular-nums">
                    {now ? <AudioLines size={12} className="text-glow" /> : index + 1}
                  </span>
                    {track.kind === 'playlist' && <ListMusic size={12} aria-hidden className="shrink-0 text-mist" />}
                  <span className="truncate text-[11px]">{label}</span>
                </button>
                {track.kind === 'playlist' && <ExpandTrack playlistId={playlist.id} track={track} label={label} />}
                <button type="button" onClick={() => moveTrack(playlist.id, track.id, -1)} disabled={index === 0} aria-label={copy.moveUp} className={iconButton}>
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
                <button type="button" onClick={() => removeTrack(playlist.id, track.id)} aria-label={copy.removeTrack(label)} className={`${iconButton} hover:text-nope`}>
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

/**
 * Playlist YouTube gardée d'un seul bloc (ajout d'avant le dépliage) : un
 * bouton la remplace par tous ses morceaux, à sa place dans la playlist.
 */
function ExpandTrack({ playlistId, track, label }: { playlistId: string; track: AmbientTrack; label: string }) {
  const t = useT()
  const language = useLanguage()
  const notify = useUiStore((state) => state.notify)
  const [busy, setBusy] = useState(false)

  const expand = async () => {
    setBusy(true)
    try {
      const { tracks } = await tracksOf(track, language)
      const report = useAmbientStore.getState().expandTrack(playlistId, track.id, tracks)
      if (report) {
        vibrate(12)
        notify(t.ambient.addTo.addedHere(report.added), 'like')
      }
    } catch {
      notify(t.ambient.addTo.fetchError, 'nope')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void expand()}
      disabled={busy}
      aria-label={t.ambient.playlists.expand(label)}
      title={t.ambient.playlists.expand(label)}
      className="grid size-8 shrink-0 place-items-center rounded-full text-glow hover:bg-glow/15 disabled:opacity-50"
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <ListTree size={13} />}
    </button>
  )
}
