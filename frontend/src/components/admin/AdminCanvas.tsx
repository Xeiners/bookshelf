import { useCallback, useEffect, useRef, useState } from 'react'
import { Ban, Eraser, Eye, Loader2, RefreshCw, ShieldOff, Undo2 } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { boundsOf } from '../../lib/canvas/geometry'
import { PAPER, drawData } from '../../lib/canvas/render'
import type { Data } from '../../lib/canvas/types'
import { adminApi } from '../../services/adminApi'
import type { CanvasAdminOverview, QueueItem } from '../../services/canvasApi'
import { useUiStore } from '../../store/useUiStore'

/**
 * Modération de la Toile : quelques chiffres, puis la file des dessins signalés (ou déjà masqués
 * par trois signalements) avec leur aperçu : supprimer, rendre visible, tout effacer chez le compte,
 * l'exclure de la toile. Chaque action est inscrite au journal et prévient le compte.
 */
export function AdminCanvas() {
  const t = useT()
  const [data, setData] = useState<CanvasAdminOverview | null>(null)
  const notify = useUiStore((state) => state.notify)

  const load = useCallback(async () => {
    try {
      setData(await adminApi.canvas())
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    }
  }, [notify, t])

  useEffect(() => {
    // Chargement initial : la réponse arrive après le premier rendu.
    const timer = setTimeout(() => void load(), 0)
    return () => clearTimeout(timer)
  }, [load])

  if (!data) return <Loader2 className="mx-auto mt-10 animate-spin text-glow" size={24} aria-hidden />

  const stats: [string, number][] = [
    [t.admin.canvas.online, data.online],
    [t.admin.canvas.objects, data.objects],
    [t.admin.canvas.frames, data.frames],
    [t.admin.canvas.artists, data.artists],
    [t.admin.canvas.pending, data.pending],
    [t.admin.canvas.hidden, data.hidden],
    [t.admin.canvas.banned, data.banned],
  ]

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-cream">{t.admin.canvas.title}</h2>
          <p className="mt-1 text-xs text-mist">{t.admin.canvas.subtitle}</p>
        </div>
        <button type="button" onClick={() => void load()} aria-label={t.admin.canvas.refresh} className="glass grid size-9 shrink-0 place-items-center rounded-full text-cream/80 active:scale-95">
          <RefreshCw size={15} aria-hidden />
        </button>
      </header>
      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-center">
            <dd className="font-display text-xl text-cream tabular-nums">{value.toLocaleString()}</dd>
            <dt className="text-[10px] tracking-wide text-mist uppercase">{label}</dt>
          </div>
        ))}
      </dl>
      <section className="flex flex-col gap-3">
        <h3 className="text-[11px] font-semibold tracking-[0.14em] text-mist uppercase">{t.admin.canvas.queue}</h3>
        {data.queue.length === 0 && <p className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-6 text-center text-sm text-mist">{t.admin.canvas.empty}</p>}
        {data.queue.map((item) => (
          <QueueCard key={item.id} item={item} onDone={() => void load()} />
        ))}
      </section>
    </div>
  )
}

/** Aperçu d'un objet signalé, cadré dans une vignette. */
function Preview({ data }: { data: unknown }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const object = data as Data
    const box = boundsOf(object)
    const width = Math.max(1, box.maxX - box.minX)
    const height = Math.max(1, box.maxY - box.minY)
    const k = Math.min((canvas.width - 16) / width, (canvas.height - 16) / height)
    context.fillStyle = PAPER
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.setTransform(k, 0, 0, k, (canvas.width - width * k) / 2 - box.minX * k, (canvas.height - height * k) / 2 - box.minY * k)
    drawData(context, object)
  }, [data])
  return <canvas ref={ref} width={240} height={180} className="h-24 w-32 shrink-0 rounded-xl border border-white/10" />
}

function QueueCard({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'purge' | 'ban' | null>(null)
  const [reason, setReason] = useState('')

  const run = async (action: () => Promise<string>) => {
    setBusy(true)
    try {
      notify(await action(), 'like')
      onDone()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const button = 'flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold active:scale-95 disabled:opacity-50' // i18n-ignore : classes CSS
  return (
    <article className="flex flex-col gap-3 rounded-3xl border border-white/8 bg-white/[0.03] p-3.5">
      <div className="flex gap-3">
        <Preview data={item.data} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-cream">
            {t.canvas.info.kinds[item.type] ?? item.type}
            <span className="rounded-full bg-nope/20 px-2 py-0.5 text-[10px] text-nope">{t.admin.canvas.reports(item.reports)}</span>
            {item.hidden && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] text-gold">{t.admin.canvas.hiddenTag}</span>}
          </p>
          <p className="mt-0.5 text-xs text-mist">{t.admin.canvas.by(item.owner.name ?? t.canvas.peers.anonymous)}</p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {Object.entries(item.reasons).map(([reason, count]) => (
              <span key={reason} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-cream/80">
                {t.admin.canvas.reasons[reason] ?? reason} ×{count}
              </span>
            ))}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={busy} onClick={() => void run(async () => (await adminApi.canvasRemove(item.id), t.admin.canvas.removed))} className={`${button} bg-nope text-white`}>
          <Eraser size={13} aria-hidden />
          {t.admin.canvas.remove}
        </button>
        <button type="button" disabled={busy} onClick={() => void run(async () => (await adminApi.canvasRestore(item.id), t.admin.canvas.restored))} className={`${button} bg-like/20 text-like`}>
          {item.hidden ? <Eye size={13} aria-hidden /> : <Undo2 size={13} aria-hidden />}
          {t.admin.canvas.restore}
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirm(confirm === 'purge' ? null : 'purge')} className={`${button} bg-white/10 text-cream/85`}>
          <ShieldOff size={13} aria-hidden />
          {t.admin.canvas.purge}
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirm(confirm === 'ban' ? null : 'ban')} className={`${button} bg-white/10 text-cream/85`}>
          <Ban size={13} aria-hidden />
          {t.admin.canvas.ban}
        </button>
      </div>
      {confirm === 'purge' && (
        <button type="button" disabled={busy} onClick={() => void run(async () => t.admin.canvas.purged((await adminApi.canvasPurge(item.owner.id)).removed))} className={`${button} self-start bg-nope text-white`}>
          {t.admin.canvas.confirm} · {t.admin.canvas.purge}
        </button>
      )}
      {confirm === 'ban' && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder={t.admin.canvas.reason} aria-label={t.admin.canvas.reason} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-1.5 text-xs text-cream outline-none focus:border-glow" />
          <button type="button" disabled={busy} onClick={() => void run(async () => (await adminApi.canvasBan(item.owner.id, reason.trim() || null), t.admin.canvas.banned_))} className={`${button} bg-nope text-white`}>
            {t.admin.canvas.confirm}
          </button>
        </div>
      )}
    </article>
  )
}
