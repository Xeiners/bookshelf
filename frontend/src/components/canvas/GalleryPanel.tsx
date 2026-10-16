import { useEffect, useState } from 'react'
import { Heart, Loader2, X } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { getEngine } from '../../lib/canvas/current'
import { canvasApi, type GalleryFrame } from '../../services/canvasApi'
import { useCanvasStore } from '../../store/useCanvasStore'

/** Les cadres les plus aimés de la saison (ou d'une saison passée) : aller les voir, les aimer. */
export function GalleryPanel({ season, onClose }: { season: { id: string; key: string } | null; onClose: () => void }) {
  const t = useT()
  const [frames, setFrames] = useState<GalleryFrame[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    canvasApi
      .gallery(season?.id)
      .then((result) => alive && setFrames(result.frames))
      .catch((error: unknown) => alive && setFailed(apiErrorMessage(error, t)))
    return () => {
      alive = false
    }
  }, [season, t])

  const like = async (frame: GalleryFrame) => {
    try {
      const result = await canvasApi.like(frame.id)
      setFrames((current) => current?.map((entry) => (entry.id === frame.id ? { ...entry, likes: result.likes, liked: true } : entry)) ?? null)
    } catch (error) {
      const code = (error as { code?: string }).code
      useCanvasStore.getState().notify(code && code in t.canvas.errors ? code : 'unknown')
    }
  }

  return (
    <aside className="glass pointer-events-auto flex max-h-[62vh] w-[20rem] flex-col rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.5)] max-md:w-full" aria-label={t.canvas.gallery.title}>
      <header className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-2">
        <div>
          <h2 className="font-display text-lg text-cream">{t.canvas.gallery.title}</h2>
          <p className="text-[11px] text-mist">{season ? t.canvas.seasons.name(season.key) : t.canvas.gallery.subtitle}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t.common.close} className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.07] text-cream/70">
          <X size={14} aria-hidden />
        </button>
      </header>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!frames && !failed && <Loader2 className="mx-auto my-6 animate-spin text-glow" size={22} aria-hidden />}
        {failed && <p className="px-2.5 py-3 text-xs text-nope">{failed}</p>}
        {frames?.length === 0 && <p className="px-2.5 py-3 text-xs text-mist">{t.canvas.gallery.empty}</p>}
        <ol className="flex flex-col gap-1">
          {frames?.map((frame, index) => (
            <li key={frame.id} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-white/[0.05]">
              <span className="w-5 shrink-0 text-center font-display text-sm text-gold">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-cream">{frame.title || t.canvas.frame.untitled}</span>
                <span className="block truncate text-[10px] text-mist">
                  {frame.mine ? t.canvas.gallery.mine : t.canvas.gallery.by(frame.owner.name ?? t.canvas.peers.anonymous)}
                </span>
              </span>
              <button
                type="button"
                disabled={frame.liked || frame.mine}
                onClick={() => void like(frame)}
                aria-label={frame.liked ? t.canvas.gallery.liked : t.canvas.info.like}
                className={`flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold tabular-nums ${frame.liked ? 'bg-nope/20 text-nope' : 'bg-white/[0.07] text-cream/80'} disabled:opacity-80`}
              >
                <Heart size={13} className={frame.liked ? 'fill-nope' : ''} aria-hidden />
                {frame.likes}
              </button>
              {!season && (
                <button type="button" onClick={() => getEngine()?.fit({ minX: frame.x, minY: frame.y - 44, maxX: frame.x + frame.w, maxY: frame.y + frame.h })} className="h-8 rounded-full bg-glow px-3 text-xs font-semibold text-white active:scale-95">
                  {t.canvas.gallery.go}
                </button>
              )}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}
