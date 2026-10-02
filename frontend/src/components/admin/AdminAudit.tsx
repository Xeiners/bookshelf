import { useEffect, useRef, useState } from 'react'
import { Ban, Gift, Loader2, PackageOpen, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import { describeAction } from '../../lib/admin'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { relativeTime } from '../../lib/notifications'
import { adminApi, type AdminActionType, type AdminAuditEntry } from '../../services/adminApi'

const ICON: Record<AdminActionType, typeof Gift> = {
  gift_boosters: PackageOpen,
  gift_card: Gift,
  suspend: Ban,
  unsuspend: RotateCcw,
  moderate: ShieldCheck,
}

const TINT: Record<AdminActionType, string> = {
  gift_boosters: 'text-gold bg-gold/12', // i18n-ignore : classes CSS
  gift_card: 'text-gold bg-gold/12', // i18n-ignore : classes CSS
  suspend: 'text-nope bg-nope/12', // i18n-ignore : classes CSS
  unsuspend: 'text-like bg-like/12', // i18n-ignore : classes CSS
  moderate: 'text-glow bg-glow/15', // i18n-ignore : classes CSS
}

/** Une ligne du journal : qui, quoi, sur quel compte (cliquable), quand. */
export function AuditRow({ entry, now, onOpenUser }: { entry: AdminAuditEntry; now: number; onOpenUser?: (id: string) => void }) {
  const t = useT()
  const Icon = ICON[entry.action] ?? Sparkles
  const target = entry.targetUserId
  return (
    <li data-audit-row className="flex items-start gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3">
      <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${TINT[entry.action] ?? 'text-cream bg-white/10'}`}>
        <Icon size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-snug text-cream">
          {onOpenUser && target ? (
            <button type="button" onClick={() => onOpenUser(target)} className="font-semibold text-cream underline-offset-2 hover:underline">
              {entry.targetLabel ?? t.admin.audit.deleted}
            </button>
          ) : (
            <span className="font-semibold">{entry.targetLabel ?? (target ? t.admin.audit.deleted : '—')}</span>
          )}{' '}
          <span className="text-cream/75">{describeAction(entry, t)}</span>
        </p>
        <p className="mt-0.5 truncate text-[10.5px] text-mist">
          {t.admin.audit.by(entry.adminEmail)} · {relativeTime(entry.createdAt, now, t.locale, t.notifications.justNow)}
        </p>
      </div>
    </li>
  )
}

/** Le journal complet, des plus récentes aux plus anciennes, par pages. */
export function AdminAudit({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const t = useT()
  const [entries, setEntries] = useState<AdminAuditEntry[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [now] = useState(() => Date.now())
  const listRef = useRef<HTMLUListElement>(null)

  /** Page suivante (ou la première, après une erreur) : appelée depuis un bouton. */
  const load = (cursor?: string) => {
    setFailed(false)
    if (cursor) setLoadingMore(true)
    fetchPage(cursor)
  }
  const fetchPage = (cursor?: string) =>
    adminApi
      .audit({ cursor })
      .then((page) => {
        setEntries((current) => (cursor ? [...(current ?? []), ...page.entries] : page.entries))
        setNext(page.next)
      })
      .catch(() => setFailed(true))
      .finally(() => setLoadingMore(false))

  // Première page : seulement la requête, l'état ne change qu'à sa réponse.
  useEffect(() => {
    void fetchPage()
  }, [])

  const loaded = entries !== null
  useGSAP(
    () => {
      if (!loaded) return
      gsap.from('[data-audit-row]', { y: 14, autoAlpha: 0, duration: 0.45, stagger: 0.03, ease: EASE.glide, clearProps: 'opacity,visibility,transform' })
    },
    { scope: listRef, dependencies: [loaded] },
  )

  if (failed && !entries) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-mist">{t.admin.error}</p>
        <button type="button" onClick={() => load()} className="rounded-full bg-cream/10 px-4 py-2 text-xs font-semibold text-cream">
          {t.admin.retry}
        </button>
      </div>
    )
  }
  if (!entries) {
    return (
      <div className="flex justify-center py-16 text-mist">
        <Loader2 size={20} className="animate-spin" aria-hidden />
      </div>
    )
  }
  if (entries.length === 0) return <p className="py-16 text-center text-sm text-mist">{t.admin.audit.empty}</p>

  return (
    <div className="mx-auto max-w-2xl">
      <ul ref={listRef} className="flex flex-col gap-2">
        {entries.map((entry) => (
          <AuditRow key={entry.id} entry={entry} now={now} onOpenUser={onOpenUser} />
        ))}
      </ul>
      {next && (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={() => load(next)}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-full bg-cream/10 px-4 py-2 text-xs font-semibold text-cream disabled:opacity-50"
          >
            {loadingMore && <Loader2 size={13} className="animate-spin" aria-hidden />}
            {t.admin.loadMore}
          </button>
        </div>
      )}
    </div>
  )
}
