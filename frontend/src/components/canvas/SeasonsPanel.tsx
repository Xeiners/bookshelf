import { useEffect, useState } from 'react'
import { Film, Image as ImageIcon, Loader2, Medal, Trophy, X } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { API_BASE } from '../../services/api'
import { canvasApi, type CanvasSeason, type CanvasUser } from '../../services/canvasApi'
import { useUiStore } from '../../store/useUiStore'
import { Timelapse } from './Timelapse'

/** Les saisons : la toile du mois, les anciennes (galerie, image d'ensemble, time-lapse), le podium. */
export function SeasonsPanel({ onClose, onGallery }: { onClose: () => void; onGallery: (season: { id: string; key: string }) => void }) {
  const t = useT()
  const [seasons, setSeasons] = useState<CanvasSeason[] | null>(null)
  const [names, setNames] = useState<Record<string, CanvasUser>>({})
  const [replay, setReplay] = useState<CanvasSeason | null>(null)
  const [archive, setArchive] = useState<CanvasSeason | null>(null)
  const notify = useUiStore((state) => state.notify)

  useEffect(() => {
    let alive = true
    canvasApi
      .seasons()
      .then(async (result) => {
        if (!alive) return
        setSeasons(result.seasons)
        const ids = [...new Set(result.seasons.flatMap((season) => season.stats?.podium.map((entry) => entry.ownerId) ?? []))].slice(0, 30)
        if (ids.length === 0) return
        const users = await canvasApi.users(ids)
        if (alive) setNames(Object.fromEntries(users.users.map((user) => [user.id, user])))
      })
      .catch((error: unknown) => notify(apiErrorMessage(error, t), 'nope'))
    return () => {
      alive = false
    }
  }, [notify, t])

  return (
    <aside className="glass pointer-events-auto flex max-h-[64vh] w-[21rem] flex-col rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.5)] max-md:w-full" aria-label={t.canvas.seasons.title}>
      <header className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-2">
        <div>
          <h2 className="font-display text-lg text-cream">{t.canvas.seasons.title}</h2>
          <p className="text-[11px] leading-snug text-mist">{t.canvas.seasons.subtitle}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t.common.close} className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.07] text-cream/70">
          <X size={14} aria-hidden />
        </button>
      </header>
      <ul className="no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
        {!seasons && <Loader2 className="mx-auto my-6 animate-spin text-glow" size={22} aria-hidden />}
        {seasons?.map((season) => (
          <li key={season.id} className="flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-cream capitalize">{t.canvas.seasons.name(season.key)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${season.current ? 'bg-like/20 text-like' : 'bg-white/10 text-mist'}`}>{season.current ? t.canvas.seasons.current : t.canvas.seasons.ended}</span>
            </div>
            {season.stats && <p className="text-[11px] text-mist">{t.canvas.seasons.stats(season.stats.objects, season.stats.artists)}</p>}
            {!season.current && (
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-gold uppercase">
                  <Trophy size={11} aria-hidden />
                  {t.canvas.seasons.podium}
                </span>
                {season.stats && season.stats.podium.length > 0 ? (
                  season.stats.podium.map((entry, index) => (
                    <span key={entry.frameId} className="flex items-center gap-1.5 text-xs text-cream/85">
                      <Medal size={12} className={index === 0 ? 'text-gold' : index === 1 ? 'text-cream/70' : 'text-[#c68642]'} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{entry.title || t.canvas.frame.untitled}</span>
                      <span className="shrink-0 text-[10px] text-mist">{names[entry.ownerId]?.name ?? t.canvas.peers.anonymous}</span>
                      <span className="shrink-0 text-[11px] font-semibold text-nope">♥ {entry.likes}</span>
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-mist">{t.canvas.seasons.noPodium}</span>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setReplay(season)} className="flex h-8 items-center gap-1.5 rounded-full bg-glow px-3 text-xs font-semibold text-white active:scale-95">
                <Film size={13} aria-hidden />
                {season.current ? t.canvas.seasons.replay : t.canvas.seasons.timelapse}
              </button>
              {!season.current && (
                <button type="button" onClick={() => onGallery({ id: season.id, key: season.key })} className="flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-cream/85 active:scale-95">
                  <Trophy size={13} aria-hidden />
                  {t.canvas.gallery.title}
                </button>
              )}
              {season.hasArchive && (
                <button type="button" onClick={() => setArchive(season)} className="flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-cream/85 active:scale-95">
                  <ImageIcon size={13} aria-hidden />
                  {t.canvas.seasons.archive}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {replay && <Timelapse season={replay.id} label={t.canvas.seasons.name(replay.key)} onClose={() => setReplay(null)} />}
      {archive && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-void/90 p-4" role="dialog" aria-modal aria-label={t.canvas.seasons.archive} onClick={() => setArchive(null)}>
          <img src={`${API_BASE}/canvas/seasons/${archive.id}/image`} alt={t.canvas.seasons.name(archive.key)} className="max-h-full max-w-full rounded-xl border border-white/10 bg-[#fbf8f2] shadow-2xl" />
        </div>
      )}
    </aside>
  )
}
