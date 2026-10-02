import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronRight, Loader2, Search, ShieldCheck } from 'lucide-react'
import { useT } from '../../i18n'
import { accountName } from '../../lib/admin'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { relativeTime } from '../../lib/notifications'
import { adminApi, type AdminOverview, type AdminUserFilter, type AdminUserRow } from '../../services/adminApi'
import { useUiStore } from '../../store/useUiStore'
import { Pressable } from '../ui/Pressable'
import { AccountAvatar } from './AccountAvatar'
import { AdminAudit } from './AdminAudit'
import { AdminUserPanel } from './AdminUserPanel'

/** Au-delà de cette largeur : la liste à gauche, la fiche à droite. En dessous, la fiche passe par-dessus. */
const WIDE = 900

type Tab = 'users' | 'audit'

/**
 * Administration, en plein écran (comptes de `ADMIN_EMAILS`) : chiffres clés,
 * comptes (recherche, filtre, fiche avec cadeaux, modération, suspension) et
 * journal de toutes les actions. Rien n'est mis en cache : chaque ouverture
 * relit l'API, qui revérifie le rôle à chaque requête.
 */
export function AdminView() {
  const t = useT()
  const close = useUiStore((state) => state.closeAdmin)
  const [tab, setTab] = useState<Tab>('users')
  const [selected, setSelected] = useState<string | null>(null)
  /** Incrémenté après une action : la liste et les chiffres se relisent. */
  const [version, setVersion] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(() => window.innerWidth)
  const wide = width >= WIDE

  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // Échap : ferme la fiche (téléphone), sinon l'administration.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (selected && !wide) setSelected(null)
      else close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, selected, wide])

  useGSAP(
    () => {
      gsap.fromTo(rootRef.current, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: EASE.glide })
    },
    { scope: rootRef },
  )

  const openUser = (id: string) => {
    vibrate(5)
    setTab('users')
    setSelected(id)
  }
  const changed = useCallback(() => setVersion((value) => value + 1), [])

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={t.admin.title} className="fixed inset-0 z-[76] flex flex-col bg-void text-cream">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/5 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5">
        <Pressable onClick={close} aria-label={t.admin.close} className="grid size-10 shrink-0 place-items-center rounded-full text-cream/85 hover:bg-white/10">
          <ArrowLeft size={20} />
        </Pressable>
        <p className="flex min-w-0 flex-1 items-center gap-2 truncate text-[11px] font-semibold tracking-[0.22em] text-gold uppercase">
          <ShieldCheck size={15} aria-hidden />
          {t.admin.title}
        </p>
        <TabSwitch tab={tab} onChange={setTab} />
      </header>

      <div className="relative min-h-0 flex-1">
        {tab === 'audit' ? (
          <div className="no-scrollbar h-full overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <AdminAudit onOpenUser={openUser} />
          </div>
        ) : wide ? (
          <div className="grid h-full grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
            <div className="no-scrollbar h-full overflow-y-auto overscroll-contain border-r border-white/5 px-4 pt-4 pb-8">
              <UsersList version={version} selected={selected} onSelect={openUser} />
            </div>
            <div className="no-scrollbar h-full overflow-y-auto overscroll-contain px-6 pt-4">
              {selected ? (
                <div className="mx-auto max-w-2xl">
                  <AdminUserPanel key={selected} userId={selected} onChanged={changed} />
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-mist">
                  <ShieldCheck size={36} className="text-gold/60" aria-hidden />
                  <p className="text-sm">{t.admin.pick}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="no-scrollbar h-full overflow-y-auto overscroll-contain px-4 pt-4 pb-8">
              <UsersList version={version} selected={selected} onSelect={openUser} />
            </div>
            {selected && (
              <MobileSheet onClose={() => setSelected(null)}>
                {(dismiss) => <AdminUserPanel key={selected} userId={selected} onBack={dismiss} onChanged={changed} />}
              </MobileSheet>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** Comptes / Journal : capsule glissante. */
function TabSwitch({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const tabs: Tab[] = ['users', 'audit']
  useGSAP(
    () => {
      gsap.to('[data-tab-thumb]', { xPercent: tabs.indexOf(tab) * 100, duration: 0.35, ease: 'power3.out' })
    },
    { scope: ref, dependencies: [tab] },
  )
  return (
    <div ref={ref} role="tablist" aria-label={t.admin.tabs.label} className="glass relative grid shrink-0 grid-cols-2 rounded-full p-1">
      <span data-tab-thumb aria-hidden className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-cream will-change-transform" />
      {tabs.map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          onClick={() => {
            if (tab === value) return
            vibrate(5)
            onChange(value)
          }}
          className={`relative z-10 px-3.5 py-1.5 text-xs font-semibold transition-colors duration-300 ${tab === value ? 'text-void' : 'text-cream/70'}`}
        >
          {t.admin.tabs[value]}
        </button>
      ))}
    </div>
  )
}

/** Téléphone : la fiche glisse par-dessus la liste, et repart vers la droite. */
function MobileSheet({ onClose, children }: { onClose: () => void; children: (dismiss: () => void) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)
  useGSAP(
    () => {
      gsap.fromTo(ref.current, { xPercent: 100 }, { xPercent: 0, duration: 0.45, ease: EASE.glide })
    },
    { scope: ref },
  )
  useGSAP(
    () => {
      if (!closing) return
      gsap.to(ref.current, { xPercent: 100, duration: 0.3, ease: EASE.exit, onComplete: onClose })
    },
    { scope: ref, dependencies: [closing] },
  )
  return (
    <div ref={ref} className="no-scrollbar absolute inset-0 z-10 overflow-y-auto overscroll-contain bg-void px-4 pt-4 will-change-transform">
      {children(() => setClosing(true))}
    </div>
  )
}

/* ---- Liste des comptes -------------------------------------------------------------------- */

const FILTERS: AdminUserFilter[] = ['all', 'active', 'suspended']

function UsersList({ version, selected, onSelect }: { version: number; selected: string | null; onSelect: (id: string) => void }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<AdminUserFilter>('all')
  const [users, setUsers] = useState<AdminUserRow[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const listRef = useRef<HTMLUListElement>(null)

  // Recherche temporisée (300 ms), filtre immédiat ; chaque changement annule la requête en vol.
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(
      () => {
        adminApi
          .users({ q: query, filter }, controller.signal)
          .then((page) => {
            setUsers(page.users)
            setNext(page.next)
            setFailed(false)
            setNow(Date.now())
          })
          .catch(() => !controller.signal.aborted && setFailed(true))
      },
      query ? 300 : 0,
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, filter, version])

  const more = async () => {
    if (!next) return
    setLoadingMore(true)
    try {
      const page = await adminApi.users({ q: query, filter, cursor: next })
      setUsers((current) => [...(current ?? []), ...page.users])
      setNext(page.next)
    } catch {
      setFailed(true)
    } finally {
      setLoadingMore(false)
    }
  }

  const key = (users ?? []).map((user) => user.id).join('|')
  useGSAP(
    () => {
      if (!key) return
      gsap.from('[data-user-row]', { y: 10, autoAlpha: 0, duration: 0.4, stagger: 0.025, ease: EASE.glide, clearProps: 'opacity,visibility,transform' })
    },
    { scope: listRef, dependencies: [key] },
  )

  return (
    <div className="flex flex-col gap-4">
      <OverviewTiles version={version} />

      <label className="glass flex h-11 items-center gap-2 rounded-2xl px-4 focus-within:ring-1 focus-within:ring-glow/60">
        <Search size={16} className="shrink-0 text-mist" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.admin.search}
          aria-label={t.admin.search}
          className="min-w-0 flex-1 bg-transparent text-sm text-cream outline-none placeholder:text-mist"
        />
      </label>
      <div role="radiogroup" aria-label={t.admin.filters.label} className="flex gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={filter === value}
            onClick={() => {
              vibrate(5)
              setFilter(value)
            }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${filter === value ? (value === 'suspended' ? 'bg-nope text-void' : 'bg-cream text-void') : 'bg-white/6 text-cream/75'}`}
          >
            {t.admin.filters[value]}
          </button>
        ))}
      </div>

      {failed && !users && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-mist">{t.admin.error}</p>
        </div>
      )}
      {!users && !failed && (
        <div className="flex justify-center py-10 text-mist">
          <Loader2 size={20} className="animate-spin" aria-hidden />
        </div>
      )}
      {users && users.length === 0 && <p className="py-10 text-center text-sm text-mist">{t.admin.empty}</p>}
      {users && users.length > 0 && (
        <ul ref={listRef} className="flex flex-col gap-1.5">
          {users.map((user) => {
            const name = accountName(user, t.admin.anonymous)
            const active = user.id === selected
            return (
              <li key={user.id} data-user-row>
                <button
                  type="button"
                  onClick={() => onSelect(user.id)}
                  aria-label={t.admin.open(name)}
                  aria-current={active || undefined}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition-colors ${
                    active ? 'border-gold/50 bg-gold/[0.07]' : 'border-white/6 bg-white/[0.02] hover:bg-white/[0.05]'
                  } ${user.suspended ? 'opacity-70' : ''}`}
                >
                  <AccountAvatar user={user} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-cream">{name}</span>
                      {user.isAdmin && <span className="shrink-0 rounded-full bg-gold/15 px-1.5 text-[9.5px] font-bold text-gold uppercase">{t.admin.badges.admin}</span>}
                      {user.suspended && <span className="shrink-0 rounded-full bg-nope/15 px-1.5 text-[9.5px] font-bold text-nope uppercase">{t.admin.badges.suspended}</span>}
                    </span>
                    <span className="block truncate text-[11px] text-mist">{user.email}</span>
                    <span className="block truncate text-[10.5px] text-cream/45">
                      {t.admin.rowMeta(user.cards, user.library)} ·{' '}
                      {user.lastSeenAt ? t.admin.seen(relativeTime(user.lastSeenAt, now, t.locale, t.notifications.justNow)) : t.admin.neverSeen}
                    </span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-cream/30" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {next && (
        <button
          type="button"
          onClick={() => void more()}
          disabled={loadingMore}
          className="inline-flex items-center justify-center gap-2 self-center rounded-full bg-cream/10 px-4 py-2 text-xs font-semibold text-cream disabled:opacity-50"
        >
          {loadingMore && <Loader2 size={13} className="animate-spin" aria-hidden />}
          {t.admin.loadMore}
        </button>
      )}
    </div>
  )
}

/* ---- Chiffres clés ------------------------------------------------------------------------ */

const OVERVIEW_KEYS = ['users', 'activeThisWeek', 'newThisWeek', 'suspended', 'openOffers', 'tradesThisWeek', 'boostersOpened'] as const

/** Les chiffres clés, comptés à l'arrivée (GSAP sur le texte, aucun rendu React par image). */
function OverviewTiles({ version }: { version: number }) {
  const t = useT()
  const [data, setData] = useState<AdminOverview | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    adminApi
      .overview()
      .then(setData)
      .catch(() => {})
  }, [version])

  useGSAP(
    () => {
      if (!data) return
      for (const node of gsap.utils.toArray<HTMLElement>('[data-count]')) {
        const target = Number(node.dataset.count)
        const counter = { value: 0 }
        gsap.to(counter, { value: target, duration: 0.9, ease: 'power2.out', onUpdate: () => (node.textContent = String(Math.round(counter.value))) })
      }
    },
    { scope: ref, dependencies: [data] },
  )

  return (
    <div ref={ref} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
      {OVERVIEW_KEYS.map((key) => (
        <div
          key={key}
          className={`shrink-0 rounded-2xl border px-3.5 py-2.5 ${key === 'suspended' && (data?.suspended ?? 0) > 0 ? 'border-nope/35 bg-nope/[0.06]' : 'border-white/6 bg-white/[0.03]'}`}
        >
          <p className="text-[9.5px] tracking-[0.14em] text-mist uppercase">{t.admin.overview[key]}</p>
          <p data-count={data?.[key] ?? 0} className="mt-0.5 font-display text-2xl leading-none text-cream tabular-nums">
            {data ? data[key] : '–'}
          </p>
        </div>
      ))}
    </div>
  )
}
