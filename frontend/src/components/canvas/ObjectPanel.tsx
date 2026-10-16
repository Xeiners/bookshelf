import { useEffect, useState } from 'react'
import { Flag, Heart, Plus, Trash2, X } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { getEngine } from '../../lib/canvas/current'
import { adminApi } from '../../services/adminApi'
import { canvasApi, type CanvasUser, type ObjectInfo, type ReportReason } from '../../services/canvasApi'
import { useCanvasStore } from '../../store/useCanvasStore'
import { useUiStore } from '../../store/useUiStore'

const REASONS: ReportReason[] = ['inappropriate', 'spam', 'hate', 'other']

/**
 * Ce que l'on sait de l'objet choisi : le dessin d'un autre (qui l'a fait, « j'aime », signaler,
 * et pour l'équipe : supprimer) ; ou mon propre cadre (titre, artistes invités, « j'aime »).
 */
export function ObjectPanel() {
  const selection = useCanvasStore((state) => state.selection)
  const me = useCanvasStore((state) => state.me)
  const tool = useCanvasStore((state) => state.tool)
  const id = selection.length === 1 ? selection[0]! : null
  const object = id ? getEngine()?.scene.get(id) : undefined
  if (!id || !object || !me || tool !== 'select') return null
  if (object.data.t === 'f' && (object.owner === me.userId || me.admin)) return <FrameInspector key={id} id={id} />
  if (object.owner === me.userId) return null
  return <ForeignInfo key={id} id={id} admin={me.admin} />
}

const card = 'glass pointer-events-auto flex w-[19rem] max-w-full flex-col gap-2.5 rounded-3xl p-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)]'

function Close() {
  const t = useT()
  return (
    <button type="button" onClick={() => useCanvasStore.setState({ selection: [] })} aria-label={t.canvas.info.close} className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.07] text-cream/70">
      <X size={14} aria-hidden />
    </button>
  )
}

function ForeignInfo({ id, admin }: { id: string; admin: boolean }) {
  const t = useT()
  const [info, setInfo] = useState<ObjectInfo | null>(null)
  const [reporting, setReporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const notify = useUiStore((state) => state.notify)
  const hidden = getEngine()?.scene.get(id)?.hidden ?? false
  const likes = getEngine()?.scene.get(id)?.likes ?? info?.likes ?? 0

  useEffect(() => {
    let alive = true
    canvasApi
      .object(id)
      .then((result) => alive && setInfo(result))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [id])

  const like = async () => {
    setBusy(true)
    try {
      const result = await canvasApi.like(id)
      setInfo((current) => (current ? { ...current, liked: true, likes: result.likes } : current))
      const object = getEngine()?.scene.get(id)
      if (object) object.likes = result.likes
      notify(result.rewarded ? t.canvas.errors.liked_reward : t.canvas.errors.liked, 'like')
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  const report = async (reason: ReportReason) => {
    setBusy(true)
    try {
      const result = await canvasApi.report(id, reason)
      setInfo((current) => (current ? { ...current, reported: true } : current))
      setReporting(false)
      notify(result.hidden ? t.canvas.info.reportedHidden : t.canvas.info.reportedDone, 'like')
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await adminApi.canvasRemove(id)
      useCanvasStore.setState({ selection: [] })
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className={card} aria-label={t.canvas.info.by}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-sm font-bold text-cream">
          {info?.owner.avatar ? <img src={info.owner.avatar} alt="" className="size-full object-cover" /> : (info?.owner.name ?? '?').slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] tracking-wide text-mist uppercase">{t.canvas.info.by}</span>
          <span className="block truncate text-sm font-semibold text-cream">{info ? (info.owner.name ?? t.canvas.peers.anonymous) : '…'}</span>
        </span>
        <Close />
      </div>
      {hidden && <p className="rounded-xl bg-nope/15 px-3 py-2 text-[11px] text-nope">{t.canvas.info.hidden}</p>}
      <div className="flex items-center gap-1.5">
        <button type="button" disabled={busy || !info || info.liked} onClick={() => void like()} className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-xs font-semibold active:scale-95 disabled:opacity-70 ${info?.liked ? 'bg-nope/20 text-nope' : 'bg-nope text-white'}`}>
          <Heart size={14} className={info?.liked ? 'fill-nope' : ''} aria-hidden />
          {info?.liked ? t.canvas.info.liked : t.canvas.info.like} · {likes}
        </button>
        <button type="button" disabled={busy || !info || info.reported} onClick={() => setReporting((state) => !state)} aria-expanded={reporting} className="flex h-9 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-xs font-semibold text-cream/85 active:scale-95 disabled:opacity-60">
          <Flag size={13} aria-hidden />
          {info?.reported ? t.canvas.info.reported : t.canvas.info.report}
        </button>
        {admin && (
          <button type="button" disabled={busy} onClick={() => void remove()} aria-label={t.admin.canvas.remove} title={t.admin.canvas.remove} className="grid size-9 place-items-center rounded-full bg-nope/20 text-nope active:scale-95">
            <Trash2 size={14} aria-hidden />
          </button>
        )}
      </div>
      {reporting && (
        <div className="flex flex-col gap-1 rounded-2xl bg-white/[0.04] p-2" role="menu" aria-label={t.canvas.info.reasonTitle}>
          <span className="px-1 text-[10px] tracking-wide text-mist uppercase">{t.canvas.info.reasonTitle}</span>
          {REASONS.map((reason) => (
            <button key={reason} type="button" role="menuitem" disabled={busy} onClick={() => void report(reason)} className="rounded-xl px-3 py-2 text-left text-xs font-semibold text-cream/90 hover:bg-white/10 active:scale-[0.99]">
              {t.canvas.info.reasons[reason]}
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}

function FrameInspector({ id }: { id: string }) {
  const t = useT()
  const object = getEngine()?.scene.get(id)
  const frame = object?.data.t === 'f' ? object.data : null
  const peers = useCanvasStore((state) => state.peers)
  const max = useCanvasStore((state) => state.limits?.frames.collaborators ?? 8)
  const [draft, setDraft] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, CanvasUser>>({})
  const collaborators = frame?.co ?? []
  const key = collaborators.join(',')

  useEffect(() => {
    if (!key) return
    let alive = true
    canvasApi
      .users(key.split(','))
      .then((result) => alive && setNames(Object.fromEntries(result.users.map((user) => [user.id, user]))))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [key])

  if (!object || !frame) return null
  const title = draft ?? frame.tt
  const commitTitle = () => {
    if (draft !== null && draft.trim() !== frame.tt) getEngine()?.updateFrame(id, { tt: draft.trim().slice(0, 40) })
    setDraft(null)
  }
  // Les artistes en ligne que l'on peut inviter (un compte une seule fois).
  const invitable = [...new Map(Object.values(peers).map((peer) => [peer.userId, peer])).values()].filter((peer) => peer.userId !== object.owner && !collaborators.includes(peer.userId))

  return (
    <aside className={card} aria-label={t.canvas.frame.mine}>
      <div className="flex items-center gap-2">
        <input
          value={title}
          maxLength={40}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
          placeholder={t.canvas.frame.untitled}
          aria-label={t.canvas.frame.title}
          className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-1.5 text-sm font-semibold text-cream outline-none focus:border-glow"
        />
        <Close />
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-mist">
        <Heart size={12} className="text-nope" aria-hidden />
        {t.canvas.info.likes(object.likes)}
      </p>
      <section className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
          {t.canvas.frame.collaborators} · {collaborators.length}/{max}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {collaborators.map((userId) => (
            <span key={userId} className="flex items-center gap-1 rounded-full bg-white/10 py-1 pr-1 pl-2.5 text-xs text-cream">
              {names[userId]?.name ?? t.canvas.peers.anonymous}
              <button type="button" aria-label={`${t.canvas.frame.remove} ${names[userId]?.name ?? ''}`} onClick={() => getEngine()?.updateFrame(id, { co: collaborators.filter((entry) => entry !== userId) })} className="grid size-5 place-items-center rounded-full bg-white/15">
                <X size={10} aria-hidden />
              </button>
            </span>
          ))}
          {collaborators.length < max &&
            invitable.map((peer) => (
              <button key={peer.userId} type="button" onClick={() => getEngine()?.updateFrame(id, { co: [...collaborators, peer.userId] })} className="flex items-center gap-1 rounded-full border border-dashed border-glow/60 py-1 pr-2.5 pl-1.5 text-xs font-semibold text-glow active:scale-95">
                <Plus size={12} aria-hidden />
                {peer.name ?? t.canvas.peers.anonymous}
              </button>
            ))}
        </div>
        {invitable.length === 0 && collaborators.length < max && <p className="text-[11px] text-mist">{t.canvas.frame.noPeers}</p>}
      </section>
    </aside>
  )
}
