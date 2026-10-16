import { Eye, EyeOff, LocateFixed, X } from 'lucide-react'
import { useT } from '../../i18n'
import { getEngine } from '../../lib/canvas/current'
import { useCanvasStore } from '../../store/useCanvasStore'

/** Qui est là : pastille de sa couleur, pseudo, son outil ; aller le voir, ou le suivre. */
export function PeersPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const peers = useCanvasStore((state) => state.peers)
  const me = useCanvasStore((state) => state.me)
  const following = useCanvasStore((state) => state.following)
  const list = Object.values(peers)

  return (
    <aside className="glass pointer-events-auto flex max-h-[60vh] w-[17rem] flex-col rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.5)] max-md:w-full" aria-label={t.canvas.peers.title}>
      <header className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <h2 className="font-display text-lg text-cream">{t.canvas.peers.title}</h2>
        <button type="button" onClick={onClose} aria-label={t.common.close} className="grid size-7 place-items-center rounded-full bg-white/[0.07] text-cream/70">
          <X size={14} aria-hidden />
        </button>
      </header>
      <ul className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
        {me && (
          <li className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: me.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-cream">{me.name ?? t.canvas.peers.anonymous}</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-mist">{t.canvas.peers.you}</span>
          </li>
        )}
        {list.length === 0 && <li className="px-2.5 py-2 text-xs text-mist">{t.canvas.peers.empty}</li>}
        {list.map((peer) => (
          <li key={peer.conn} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-white/[0.05]">
            <span className="size-3 shrink-0 rounded-full" style={{ background: peer.color }} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-cream">{peer.name ?? t.canvas.peers.anonymous}</span>
              <span className="block truncate text-[10px] text-mist">{t.canvas.peers.using(t.canvas.tools[peer.tool] ?? peer.tool)}</span>
            </span>
            <button type="button" title={t.canvas.peers.go} aria-label={t.canvas.peers.go} onClick={() => getEngine()?.goToPeer(peer.conn)} className="grid size-8 place-items-center rounded-full bg-white/[0.07] text-cream/80 active:scale-95">
              <LocateFixed size={14} aria-hidden />
            </button>
            <button
              type="button"
              title={following === peer.conn ? t.canvas.peers.unfollow : t.canvas.peers.follow}
              aria-label={following === peer.conn ? t.canvas.peers.unfollow : t.canvas.peers.follow}
              aria-pressed={following === peer.conn}
              onClick={() => getEngine()?.follow(following === peer.conn ? null : peer.conn)}
              className={`grid size-8 place-items-center rounded-full active:scale-95 ${following === peer.conn ? 'bg-glow text-white' : 'bg-white/[0.07] text-cream/80'}`}
            >
              {following === peer.conn ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
