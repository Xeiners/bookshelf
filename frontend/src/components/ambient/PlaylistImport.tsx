import { useState, type FormEvent } from 'react'
import { ListPlus, Loader2, X } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { parseYouTubeSource } from '../../lib/audio/youtubePlayer'
import { ApiError } from '../../services/api'
import { musicApi, type ImportedPlaylist } from '../../services/musicApi'
import { AMBIENT_LIMITS, useAmbientStore } from '../../store/useAmbientStore'
import { useUiStore } from '../../store/useUiStore'

type Phase = { step: 'closed' } | { step: 'form' } | { step: 'loading' } | { step: 'preview'; playlist: ImportedPlaylist } | { step: 'error'; message: string }

/**
 * « Importer une playlist YouTube » : un lien collé, un aperçu (titre,
 * chaîne, nombre de morceaux), puis la playlist d'ambiance est créée avec
 * toutes ses vidéos. `onCreated` : la nouvelle playlist s'ouvre.
 */
export function PlaylistImport({ onCreated }: { onCreated: (playlistId: string) => void }) {
  const t = useT()
  const copy = t.ambient.import
  const language = useLanguage()
  const notify = useUiStore((state) => state.notify)
  const [phase, setPhase] = useState<Phase>({ step: 'closed' })
  const [link, setLink] = useState('')

  const preview = async (event: FormEvent) => {
    event.preventDefault()
    const source = parseYouTubeSource(link)
    if (!source || source.kind !== 'playlist') {
      setPhase({ step: 'error', message: copy.invalid })
      return
    }
    if (source.id.startsWith('RD')) {
      setPhase({ step: 'error', message: copy.mix })
      return
    }
    setPhase({ step: 'loading' })
    try {
      setPhase({ step: 'preview', playlist: await musicApi.playlist(source.id, language) })
    } catch (reason) {
      setPhase({ step: 'error', message: reason instanceof ApiError && reason.status === 404 ? copy.notFound : copy.error })
    }
  }

  const create = (playlist: ImportedPlaylist) => {
    const id = useAmbientStore
      .getState()
      .importPlaylist(playlist.title, playlist.videos.map((video) => ({ kind: 'video' as const, ref: video.id, title: video.title })))
    if (id === null) {
      setPhase({ step: 'error', message: t.ambient.playlists.limit })
      return
    }
    vibrate(14)
    notify(copy.created(playlist.title, Math.min(playlist.videos.length, AMBIENT_LIMITS.tracks)), 'like')
    setLink('')
    setPhase({ step: 'closed' })
    onCreated(id)
  }

  if (phase.step === 'closed') {
    return (
      <button
        type="button"
        onClick={() => setPhase({ step: 'form' })}
        className="flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-glow/40 px-3 py-2.5 text-left text-xs text-cream/85 hover:bg-glow/10"
      >
        <ListPlus size={15} className="shrink-0 text-glow" />
        {copy.button}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-2xl border border-glow/30 bg-glow/[0.06] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-mist uppercase">{copy.button}</p>
        <button
          type="button"
          onClick={() => setPhase({ step: 'closed' })}
          aria-label={t.ambient.addTo.cancel}
          className="grid size-7 place-items-center rounded-full text-cream/60 hover:bg-white/10"
        >
          <X size={13} />
        </button>
      </div>

      <form onSubmit={(event) => void preview(event)} className="flex gap-1.5">
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={link}
          onChange={(event) => {
            setLink(event.target.value)
            if (phase.step !== 'form') setPhase({ step: 'form' })
          }}
          placeholder={copy.placeholder}
          aria-label={copy.label}
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs text-cream placeholder:text-mist/60 focus:border-glow/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!link.trim() || phase.step === 'loading'}
          className="shrink-0 rounded-full bg-cream px-3.5 text-xs font-medium text-void disabled:opacity-40"
        >
          {phase.step === 'loading' ? <Loader2 size={14} className="animate-spin" /> : copy.preview}
        </button>
      </form>

      {phase.step === 'error' && (
        <p role="alert" className="px-1 text-[11px] text-nope">
          {phase.message}
        </p>
      )}

      {phase.step === 'preview' && (
        <div className="space-y-2 rounded-xl bg-void/40 p-2.5">
          <div>
            <p className="truncate text-sm font-medium text-cream">{phase.playlist.title}</p>
            <p className="truncate text-[11px] text-mist">
              {[phase.playlist.channel, t.ambient.playlists.tracks(phase.playlist.videos.length)].filter(Boolean).join(' · ')}
            </p>
          </div>
          <ol className="space-y-0.5 text-[11px] text-cream/75">
            {phase.playlist.videos.slice(0, 3).map((video, index) => (
              <li key={video.id} className="truncate">
                <span className="mr-1.5 text-mist tabular-nums">{index + 1}</span>
                {video.title}
              </li>
            ))}
          </ol>
          {phase.playlist.truncated && <p className="text-[10px] text-gold">{copy.truncated(AMBIENT_LIMITS.tracks)}</p>}
          <button
            type="button"
            onClick={() => create(phase.playlist)}
            disabled={phase.playlist.videos.length === 0}
            className="flex w-full items-center justify-center gap-1.5 rounded-full bg-glow py-2 text-xs font-medium text-white disabled:opacity-40"
          >
            <ListPlus size={14} />
            {copy.create(phase.playlist.title)}
          </button>
        </div>
      )}
    </div>
  )
}
