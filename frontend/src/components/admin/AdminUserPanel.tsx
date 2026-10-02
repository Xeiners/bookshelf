import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Ban, BookOpen, Gift, Layers, Loader2, Minus, PackageOpen, Plus, RotateCcw, Search, ShieldAlert, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { useT } from '../../i18n'
import { accountName } from '../../lib/admin'
import { apiErrorMessage } from '../../lib/apiErrors'
import { RARITY_STYLE } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { relativeTime } from '../../lib/notifications'
import { adminApi, type AdminUserDetail, type Moderation } from '../../services/adminApi'
import type { TradeCard } from '../../services/tradesApi'
import { useUiStore } from '../../store/useUiStore'
import { BoosterPackArt } from '../boosters/BoosterPackArt'
import { CollectibleCard } from '../cards/CollectibleCard'
import { AuditRow } from './AdminAudit'
import { AccountAvatar } from './AccountAvatar'

/** Un tap arme une action lourde (suspendre, modérer) ; sans confirmation dans ce délai, elle se désarme. */
const CONFIRM_WINDOW_MS = 3500
const fieldClass =
  'glass w-full rounded-2xl px-4 py-2.5 text-sm text-cream placeholder:text-mist/60 focus:ring-2 focus:ring-glow/60 focus:outline-none' // i18n-ignore : classes CSS

interface AdminUserPanelProps {
  userId: string
  /** Téléphone : retour à la liste. */
  onBack?: () => void
  /** Une action a changé le compte : la liste se met à jour. */
  onChanged: () => void
}

/**
 * Fiche d'un compte : identité, chiffres, puis les actions — offrir des
 * boosters, offrir une carte, modérer le profil, suspendre — et l'historique
 * des actions d'administration sur ce compte. L'API revérifie tout.
 */
export function AdminUserPanel({ userId, onBack, onChanged }: AdminUserPanelProps) {
  const t = useT()
  const [user, setUser] = useState<AdminUserDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    adminApi
      .user(userId, controller.signal)
      .then(({ user: detail }) => {
        setUser(detail)
        setNow(Date.now())
      })
      .catch(() => !controller.signal.aborted && setFailed(true))
    return () => controller.abort()
  }, [userId])

  /** Après une action : la fiche renvoyée (ou relue) fait foi, la liste suit. */
  const refresh = async (detail?: AdminUserDetail) => {
    setUser(detail ?? (await adminApi.user(userId)).user)
    setNow(Date.now())
    onChanged()
  }

  const loaded = user !== null
  useGSAP(
    () => {
      if (!loaded) return
      gsap.from('[data-admin-enter]', { y: 18, autoAlpha: 0, duration: 0.5, stagger: 0.05, ease: EASE.glide, clearProps: 'opacity,visibility,transform' })
    },
    { scope: rootRef, dependencies: [loaded, userId] },
  )

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-mist">{t.admin.error}</p>
        {onBack && (
          <button type="button" onClick={onBack} className="rounded-full bg-cream/10 px-4 py-2 text-xs font-semibold text-cream">
            {t.admin.back}
          </button>
        )}
      </div>
    )
  }
  if (!user) {
    return (
      <div className="flex justify-center py-16 text-mist">
        <Loader2 size={20} className="animate-spin" aria-hidden />
      </div>
    )
  }

  const name = accountName(user, t.admin.anonymous)
  const date = (iso: string) => new Date(iso).toLocaleDateString(t.locale, { day: 'numeric', month: 'long', year: 'numeric' })
  const { stats } = user

  return (
    <div ref={rootRef} className="flex flex-col gap-4 pb-8">
      {onBack && (
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 self-start text-sm text-cream/70 hover:text-cream">
          <ArrowLeft size={16} aria-hidden />
          {t.admin.back}
        </button>
      )}

      {/* Identité */}
      <section data-admin-enter className="glass flex items-start gap-4 rounded-3xl p-4">
        <AccountAvatar user={user} size={60} photo={user.hasPhoto ? adminApi.photoUrl(user.id) : null} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-2xl leading-tight text-cream">{name}</h2>
          <p className="truncate text-xs text-mist">{user.email}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {user.isAdmin && <Badge tone="gold">{t.admin.badges.admin}</Badge>}
            {user.suspended && <Badge tone="nope">{t.admin.badges.suspended}</Badge>}
            {!user.emailVerified && <Badge tone="mist">{t.admin.badges.unverified}</Badge>}
            <Badge tone="mist">{user.isProfilePublic ? t.admin.detail.visibility.public : t.admin.detail.visibility.private}</Badge>
          </div>
          <p className="mt-2 text-[11px] text-mist">
            {t.admin.joined(date(user.createdAt))} ·{' '}
            {user.lastSeenAt ? t.admin.seen(relativeTime(user.lastSeenAt, now, t.locale, t.notifications.justNow)) : t.admin.neverSeen}
          </p>
        </div>
      </section>

      {user.suspended && <SuspendedBanner user={user} onChanged={refresh} />}

      {/* Chiffres */}
      <section data-admin-enter aria-label={t.admin.detail.stats} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat icon={<Zap size={14} />} label={t.admin.detail.boosters} value={user.boosters.available} sub={user.boosters.gifted > 0 ? t.admin.detail.gifted(user.boosters.gifted) : undefined} />
        <Stat icon={<Layers size={14} />} label={t.admin.detail.cards} value={`${stats.collection.owned} / ${stats.collection.total}`} />
        <Stat icon={<PackageOpen size={14} />} label={t.admin.detail.opened} value={stats.gacha.boostersOpened} />
        <Stat icon={<BookOpen size={14} />} label={t.admin.detail.library} value={stats.reading.wishlist + stats.reading.reading + stats.reading.read} sub={t.admin.detail.libraryLine(stats.reading.wishlist, stats.reading.reading, stats.reading.read)} />
        <Stat icon={<Sparkles size={14} />} label={t.admin.detail.trades} value={user.tradesCompleted} sub={`${t.admin.detail.offers} : ${user.openOffers}`} />
        <Stat icon={<BookOpen size={14} />} label={t.admin.detail.novels} value={stats.reading.novels} />
      </section>

      <GiftBoosters user={user} name={name} onChanged={refresh} />
      <GiftCard user={user} name={name} onChanged={refresh} />
      <ModerationCard user={user} onChanged={refresh} />
      {!user.suspended && <SuspendCard user={user} onChanged={refresh} />}

      {user.audit.length > 0 && (
        <section data-admin-enter>
          <h3 className="mb-2 text-[10px] font-semibold tracking-[0.22em] text-mist uppercase">{t.admin.detail.history}</h3>
          <ul className="flex flex-col gap-2">
            {user.audit.map((entry) => (
              <AuditRow key={entry.id} entry={entry} now={now} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/* ---- Petits éléments ---------------------------------------------------------------------- */

function Badge({ tone, children }: { tone: 'gold' | 'nope' | 'mist'; children: ReactNode }) {
  const tones = { gold: 'bg-gold/15 text-gold', nope: 'bg-nope/15 text-nope', mist: 'bg-white/8 text-cream/70' }
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>{children}</span>
}

function Stat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: number | string; sub?: string }) {
  return (
    <div className="glass rounded-2xl p-3">
      <p className="flex items-center gap-1.5 text-[10px] tracking-[0.12em] text-mist uppercase">
        <span className="text-glow">{icon}</span>
        {label}
      </p>
      <p className="mt-1 font-display text-2xl leading-none text-cream tabular-nums">{value}</p>
      {sub && <p className="mt-1 truncate text-[10.5px] text-mist">{sub}</p>}
    </div>
  )
}

function Card({ icon, title, hint, tone = 'glow', children }: { icon: ReactNode; title: string; hint?: string; tone?: 'glow' | 'gold' | 'nope'; children: ReactNode }) {
  const tint = { glow: 'text-glow', gold: 'text-gold', nope: 'text-nope' }[tone]
  return (
    <section data-admin-enter className="glass rounded-3xl p-4">
      <h3 className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.22em] text-mist uppercase">
        <span className={tint}>{icon}</span>
        {title}
      </h3>
      {hint && <p className="mt-1.5 text-xs leading-5 text-cream/55">{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

/** Choix d'un nombre : − / + et raccourcis. */
function Stepper({ value, min, max, onChange, label, less, more }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string; less: string; more: string }) {
  const step = (delta: number) => {
    vibrate(5)
    onChange(Math.min(max, Math.max(min, value + delta)))
  }
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <button type="button" onClick={() => step(-1)} disabled={value <= min} aria-label={less} className="glass grid size-9 place-items-center rounded-full text-cream disabled:opacity-35">
        <Minus size={15} />
      </button>
      <span className="min-w-10 text-center font-display text-3xl leading-none text-cream tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" onClick={() => step(1)} disabled={value >= max} aria-label={more} className="glass grid size-9 place-items-center rounded-full text-cream disabled:opacity-35">
        <Plus size={15} />
      </button>
    </div>
  )
}

/** Bouton d'action lourde : un premier tap l'arme (avec une jauge qui se vide), un second confirme. */
function useArm() {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [armed])
  return [armed, setArmed] as const
}

/* ---- Cadeaux ------------------------------------------------------------------------------ */

const QUICK_BOOSTERS = [1, 3, 5, 10] as const

function GiftBoosters({ user, name, onChanged }: { user: AdminUserDetail; name: string; onChanged: (detail?: AdminUserDetail) => Promise<void> }) {
  const t = useT()
  const copy = t.admin.giftBoosters
  const notify = useUiStore((state) => state.notify)
  const [count, setCount] = useState(1)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const packRef = useRef<HTMLDivElement>(null)

  const submit = async () => {
    setBusy(true)
    try {
      await adminApi.giftBoosters(user.id, count, message)
      vibrate([12, 40, 18])
      // Le paquet bondit : le cadeau est parti.
      gsap.fromTo(packRef.current, { y: 0, rotation: -6, scale: 1 }, { keyframes: { y: [0, -18, 0], rotation: [-6, 8, -6], scale: [1, 1.12, 1] }, duration: 0.7, ease: 'power2.out' })
      notify(copy.done(count, name), 'like')
      setMessage('')
      await onChanged()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={<Gift size={13} />} title={copy.title} hint={copy.hint} tone="gold">
      <div className="flex items-center gap-4">
        <div ref={packRef} className="shrink-0 -rotate-6 will-change-transform" aria-hidden>
          <BoosterPackArt width={48} lit />
        </div>
        <div className="flex flex-col gap-2">
          <Stepper value={count} min={1} max={20} onChange={setCount} label={copy.count} less={copy.less} more={copy.more} />
          <div className="flex gap-1.5">
            {QUICK_BOOSTERS.map((quick) => (
              <button
                key={quick}
                type="button"
                onClick={() => setCount(quick)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums transition-colors ${count === quick ? 'bg-gold text-void' : 'bg-white/8 text-cream/75'}`}
              >
                {quick}
              </button>
            ))}
          </div>
        </div>
      </div>
      <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={200} placeholder={copy.placeholder} aria-label={copy.message} className={fieldClass} />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-gold text-sm font-semibold text-void shadow-[0_8px_24px_-10px_var(--color-gold)] disabled:opacity-50"
      >
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Gift size={15} aria-hidden />}
        {copy.submit(count)}
      </button>
    </Card>
  )
}

function GiftCard({ user, name, onChanged }: { user: AdminUserDetail; name: string; onChanged: (detail?: AdminUserDetail) => Promise<void> }) {
  const t = useT()
  const copy = t.admin.giftCard
  const notify = useUiStore((state) => state.notify)
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<TradeCard[] | null>(null)
  const [picked, setPicked] = useState<TradeCard | null>(null)
  const [count, setCount] = useState(1)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  // Recherche temporisée ; une frappe annule la requête précédente.
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      adminApi
        .cards(query, controller.signal)
        .then(({ cards: found }) => setCards(found))
        .catch(() => {})
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const submit = async () => {
    if (!picked) return
    setBusy(true)
    try {
      await adminApi.giftCard(user.id, picked.id, count, message)
      vibrate([12, 40, 18])
      notify(copy.done(picked.name, name), 'like')
      setMessage('')
      setCount(1)
      await onChanged()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={<Sparkles size={13} />} title={copy.title} tone="gold">
      <label className="glass flex h-10 items-center gap-2 rounded-full px-4 focus-within:ring-1 focus-within:ring-glow/60">
        <Search size={15} className="shrink-0 text-mist" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.search}
          aria-label={copy.search}
          className="min-w-0 flex-1 bg-transparent text-sm text-cream outline-none placeholder:text-mist"
        />
      </label>
      {cards && cards.length === 0 && <p className="py-3 text-center text-xs text-mist">{copy.none}</p>}
      {cards && cards.length > 0 && (
        // Une rangée qui défile : on parcourt le set sans que la fiche s'allonge.
        <ul role="listbox" aria-label={copy.title} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-2">
          {cards.map((card) => {
            const active = picked?.id === card.id
            return (
              <li key={card.id} className="shrink-0">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-label={card.name}
                  onClick={() => {
                    vibrate(5)
                    setPicked(card)
                  }}
                  className={`block rounded-lg transition-transform ${active ? 'ring-2 ring-gold ring-offset-2 ring-offset-[#14141d]' : 'opacity-85 hover:opacity-100'}`}
                >
                  <CollectibleCard card={card} width={68} effects={false} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {picked && (
        <div className="flex items-center gap-3 rounded-2xl border border-white/8 p-3">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: RARITY_STYLE[picked.rarity].color, boxShadow: `0 0 8px ${RARITY_STYLE[picked.rarity].color}` }} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-cream">{picked.name}</p>
            <p className="text-[11px]" style={{ color: RARITY_STYLE[picked.rarity].color }}>
              {t.cards.rarity[picked.rarity]} · #{picked.number}
            </p>
          </div>
          <Stepper value={count} min={1} max={10} onChange={setCount} label={copy.count} less={t.admin.giftBoosters.less} more={t.admin.giftBoosters.more} />
        </div>
      )}
      <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={200} placeholder={t.admin.giftBoosters.placeholder} aria-label={t.admin.giftBoosters.message} className={fieldClass} />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !picked}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-gold text-sm font-semibold text-void disabled:opacity-40"
      >
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Gift size={15} aria-hidden />}
        {picked ? copy.submit(picked.name) : copy.pickFirst}
      </button>
    </Card>
  )
}

/* ---- Modération et suspension ------------------------------------------------------------- */

const MODERATION_KEYS = ['displayName', 'bio', 'avatar', 'makePrivate', 'cancelOffers'] as const

function ModerationCard({ user, onChanged }: { user: AdminUserDetail; onChanged: (detail?: AdminUserDetail) => Promise<void> }) {
  const t = useT()
  const copy = t.admin.moderation
  const notify = useUiStore((state) => state.notify)
  const [choice, setChoice] = useState<Moderation>({})
  const [armed, setArmed] = useArm()
  const [busy, setBusy] = useState(false)
  const chosen = MODERATION_KEYS.filter((key) => choice[key])

  const submit = async () => {
    if (!armed) {
      vibrate(6)
      setArmed(true)
      return
    }
    setArmed(false)
    setBusy(true)
    try {
      const { user: detail } = await adminApi.moderate(user.id, choice)
      notify(copy.done, 'neutral')
      setChoice({})
      await onChanged(detail)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={<ShieldCheck size={13} />} title={copy.title}>
      {/* Ce qui est en cause : pseudo, présentation, photo. */}
      <div className="flex items-start gap-3 rounded-2xl border border-white/8 p-3">
        {user.hasPhoto && <img src={adminApi.photoUrl(user.id)} alt={t.admin.detail.photo} className="size-14 shrink-0 rounded-xl object-cover" />}
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-semibold text-cream">{user.displayName ?? t.admin.anonymous}</p>
          <p className="mt-1 whitespace-pre-wrap text-cream/65">{user.bio || t.admin.detail.noBio}</p>
        </div>
      </div>
      <div className="grid gap-1.5">
        {MODERATION_KEYS.map((key) => (
          <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-1 py-1 text-sm text-cream/85">
            <input
              type="checkbox"
              checked={choice[key] === true}
              onChange={(event) => {
                setArmed(false)
                setChoice((current) => ({ ...current, [key]: event.target.checked }))
              }}
              className="size-4 accent-glow"
            />
            {copy[key]}
          </label>
        ))}
      </div>
      <ArmedButton armed={armed} busy={busy} disabled={chosen.length === 0} tone="glow" onClick={() => void submit()} icon={<ShieldCheck size={15} aria-hidden />}>
        {armed ? copy.confirm : copy.submit}
      </ArmedButton>
    </Card>
  )
}

function SuspendCard({ user, onChanged }: { user: AdminUserDetail; onChanged: (detail?: AdminUserDetail) => Promise<void> }) {
  const t = useT()
  const copy = t.admin.suspension
  const notify = useUiStore((state) => state.notify)
  const [reason, setReason] = useState('')
  const [armed, setArmed] = useArm()
  const [busy, setBusy] = useState(false)

  if (user.isAdmin) {
    return (
      <Card icon={<ShieldAlert size={13} />} title={copy.title} tone="nope">
        <p className="text-xs text-cream/60">{copy.protectedAdmin}</p>
      </Card>
    )
  }

  const submit = async () => {
    if (!armed) {
      vibrate(8)
      setArmed(true)
      return
    }
    setArmed(false)
    setBusy(true)
    try {
      const { user: detail } = await adminApi.suspend(user.id, reason)
      vibrate([20, 40, 20])
      notify(copy.done, 'nope')
      setReason('')
      await onChanged(detail)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={<Ban size={13} />} title={copy.title} hint={copy.hint} tone="nope">
      <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder={copy.placeholder} aria-label={copy.reason} className={fieldClass} />
      <ArmedButton armed={armed} busy={busy} tone="nope" onClick={() => void submit()} icon={<Ban size={15} aria-hidden />}>
        {armed ? copy.confirm : copy.suspend}
      </ArmedButton>
    </Card>
  )
}

function SuspendedBanner({ user, onChanged }: { user: AdminUserDetail; onChanged: (detail?: AdminUserDetail) => Promise<void> }) {
  const t = useT()
  const copy = t.admin.suspension
  const notify = useUiStore((state) => state.notify)
  const [busy, setBusy] = useState(false)
  const since = user.suspendedAt ? new Date(user.suspendedAt).toLocaleDateString(t.locale, { day: 'numeric', month: 'long' }) : ''

  const restore = async () => {
    setBusy(true)
    try {
      const { user: detail } = await adminApi.unsuspend(user.id)
      notify(copy.restored, 'like')
      await onChanged(detail)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-admin-enter className="rounded-3xl border border-nope/40 bg-nope/[0.08] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-nope">
        <Ban size={15} aria-hidden />
        {copy.since(since)}
      </p>
      <p className="mt-1 text-xs text-cream/70">{user.suspendedReason || copy.noReason}</p>
      <button
        type="button"
        onClick={() => void restore()}
        disabled={busy}
        className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-like px-4 text-sm font-semibold text-void disabled:opacity-50"
      >
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RotateCcw size={15} aria-hidden />}
        {copy.unsuspend}
      </button>
    </section>
  )
}

interface ArmedButtonProps {
  armed: boolean
  busy: boolean
  disabled?: boolean
  tone: 'glow' | 'nope'
  icon: ReactNode
  onClick: () => void
  children: ReactNode
}

/** Bouton à deux temps : armé, il change de couleur et une bande claire se retire (le temps qu'il reste pour confirmer). */
function ArmedButton({ armed, busy, disabled = false, tone, icon, onClick, children }: ArmedButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)
  useGSAP(
    () => {
      if (!armed) return
      gsap.fromTo('[data-arm-bar]', { scaleX: 1 }, { scaleX: 0, duration: CONFIRM_WINDOW_MS / 1000, ease: 'none' })
    },
    { scope: ref, dependencies: [armed], revertOnUpdate: true },
  )
  const idle = tone === 'nope' ? 'bg-nope/15 text-nope' : 'bg-glow/20 text-cream'
  const hot = tone === 'nope' ? 'bg-nope text-void' : 'bg-glow text-white' // i18n-ignore : classes CSS
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-full text-sm font-semibold transition-colors duration-300 disabled:opacity-40 ${armed ? hot : idle}`}
    >
      {armed && <span data-arm-bar aria-hidden className="absolute inset-0 origin-left bg-white/25 will-change-transform" />}
      <span className="relative inline-flex items-center gap-2">
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : icon}
        {children}
      </span>
    </button>
  )
}
