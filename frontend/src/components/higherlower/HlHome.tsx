import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, Crown, Flame, Loader2, LogIn, Pencil, Play, Plus, Trophy, UserPlus, Users, X } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { parseRoomCode } from '../../lib/dle'
import { formatHlValue } from '../../lib/higherLower'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playHlSelect, playHlStart } from '../../lib/sfx'
import { HL_METRICS, type HlCard, type HlMetric, type HlOverview, type HlStanding } from '../../services/higherLowerApi'
import { hlSound, useHigherLowerStore } from '../../store/useHigherLowerStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { useHlCoopStore } from '../../store/useHlCoopStore'
import { useUiStore } from '../../store/useUiStore'
import { CardAvatar } from '../profile/CardAvatar'
import { MetricIcon } from './MetricIcon'
import { CARD_INK, HL_DOWN, HL_GRADIENT, HL_UP, METRIC_STYLE } from './hlStyle'
import { inkText } from '../../lib/ink'

/** Terrain choisi la dernière fois, gardé sur l'appareil (confort, jamais indispensable). */
const METRIC_KEY = 'bookshelf.hl.metric'

function savedMetric(): HlMetric {
  try {
    const value = localStorage.getItem(METRIC_KEY)
    return HL_METRICS.find((metric) => metric === value) ?? 'bounty'
  } catch {
    return 'bounty'
  }
}

/**
 * Accueil du Higher or Lower, « duel en vitrine » : un vrai duel du terrain choisi
 * en haut (la carte de droite attend sa réponse), le choix du terrain, un seul gros
 * bouton JOUER, une ligne de records et le classement dans un panneau.
 */
export function HlHome() {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const overview = useHigherLowerStore((state) => state.overview)
  const status = useHigherLowerStore((state) => state.overviewStatus)
  const starting = useHigherLowerStore((state) => state.starting)
  const start = useHigherLowerStore((state) => state.start)
  const loadOverview = useHigherLowerStore((state) => state.loadOverview)
  const [metric, setMetric] = useState<HlMetric>(savedMetric)
  const [failed, setFailed] = useState(false)
  const [board, setBoard] = useState(false)
  const style = METRIC_STYLE[metric]

  useEffect(() => {
    try {
      localStorage.setItem(METRIC_KEY, metric)
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour la visite.
    }
  }, [metric])

  // Arrivée : titre, vitrine, choix, bouton, l'un après l'autre.
  useGSAP(
    () => {
      gsap.fromTo('[data-hl-in]', { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.08, ease: EASE.glide })
    },
    { scope: rootRef },
  )

  const play = () => {
    vibrate(12)
    hlSound(playHlStart)
    setFailed(false)
    start(metric).catch(() => setFailed(true))
  }

  const me = overview?.me
  const sample = overview?.samples?.[metric]

  return (
    <div ref={rootRef} className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-12">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-7 py-2">
        <h2 data-hl-in className="font-display text-[2.6rem] leading-none sm:text-5xl" style={inkText(HL_GRADIENT)}>
          {t.hl.title}
        </h2>

        <div data-hl-in className="w-full">
          {sample ? <Showcase key={metric} metric={metric} current={sample.current} next={sample.next} /> : <div className="aspect-[3/2] w-full" />}
        </div>

        {/* Le terrain : quatre pastilles, celle choisie prend sa couleur. */}
        <div data-hl-in role="radiogroup" aria-label={t.hl.title} className="grid w-full grid-cols-4 gap-2">
          {HL_METRICS.map((key) => {
            const chosen = key === metric
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => {
                  vibrate(6)
                  if (key !== metric) hlSound(playHlSelect)
                  setMetric(key)
                }}
                className="flex flex-col items-center gap-1.5 rounded-2xl py-2.5 transition-[transform,background-color] active:scale-95"
                style={chosen ? { background: `radial-gradient(circle at 50% 0%, ${METRIC_STYLE[key].glow}, rgba(255,255,255,0.04) 75%)` } : undefined}
              >
                <span
                  className="grid size-9 place-items-center rounded-full transition-colors"
                  style={chosen ? { background: METRIC_STYLE[key].gradient, color: '#140c1f' } : { background: 'rgba(255,255,255,0.06)', color: 'rgba(247,245,240,0.55)' }}
                >
                  <MetricIcon metric={key} size={17} />
                </span>
                <span className={`text-[11px] font-semibold ${chosen ? 'text-cream' : 'text-cream/45'}`}>{t.hl.metrics[key].title}</span>
              </button>
            )
          })}
        </div>

        <div data-hl-in className="flex w-full flex-col items-center gap-3">
          <button
            type="button"
            onClick={play}
            disabled={starting !== null || !overview}
            className="relative inline-flex h-14 w-full items-center justify-center overflow-hidden rounded-2xl text-base font-bold tracking-[0.12em] text-[#140c1f] uppercase transition-transform active:scale-[0.97] disabled:opacity-70"
            style={{ background: style.gradient, boxShadow: `0 14px 34px -14px ${style.glow}, inset 0 1px 0 rgba(255,255,255,0.6)` }}
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-1/2 -skew-x-12" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)', animation: 'shimmer 3s ease-in-out infinite' }} />
            <span className="relative flex items-center gap-2">
              {starting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Play size={17} className="fill-current" aria-hidden />}
              {t.hl.play}
            </span>
          </button>
          {failed && <p className="text-xs text-nope">{t.hl.startError}</p>}
          {status === 'error' && !overview && (
            <button type="button" onClick={() => void loadOverview()} className="text-xs text-nope underline-offset-4 hover:underline">
              {t.hl.loadError} · {t.hl.retry}
            </button>
          )}

          {me && (
            <p className="flex items-center gap-3 text-xs text-cream/50 tabular-nums">
              <span className="inline-flex items-center gap-1">
                <Trophy size={12} className="text-gold" aria-hidden />
                {t.hl.best} {me.best}
              </span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Flame size={12} className="text-[#ff8a3d]" aria-hidden />
                {t.hl.today} {me.todayBest}
              </span>
            </p>
          )}
          {overview && (
            <button type="button" onClick={() => setBoard(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-cream/60 transition-colors hover:text-cream">
              <Crown size={13} className="text-gold" aria-hidden />
              {t.hl.leaderboard.title}
              <ChevronRight size={14} aria-hidden />
            </button>
          )}
        </div>

        {overview && <CoopEntry metric={metric} />}
        <GuestBanner />
      </div>

      {board && overview && <LeaderboardSheet overview={overview} onClose={() => setBoard(false)} />}
    </div>
  )
}

/* ---- Invité ---------------------------------------------------------------------------- */

/** Sans compte : le pseudo (modifiable) et l'invitation à créer un compte pour tout garder. */
function GuestBanner() {
  const t = useT()
  const signedIn = useAuthStore((state) => state.user !== null)
  const guest = useDleStore((state) => state.overview?.guest ?? null)
  const ensureGuest = useDleStore((state) => state.ensureGuest)
  const openAuth = useUiStore((state) => state.openAuth)
  const notify = useUiStore((state) => state.notify)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  if (signedIn || !guest) return null

  const save = async () => {
    setSaving(true)
    try {
      await ensureGuest(name.trim())
      setEditing(false)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-hl-in className="flex w-full flex-col gap-2.5 rounded-[1.5rem] border border-[#ffc46b]/25 bg-[#ffc46b]/[0.06] p-3 text-left">
      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label={t.dle.guest.name}
            placeholder={t.dle.guest.placeholder}
            maxLength={20}
            autoFocus
            className="h-10 min-w-0 flex-1 rounded-xl border border-white/12 bg-black/40 px-3 text-sm text-cream placeholder:text-cream/30 focus:border-white/30 focus:outline-none"
          />
          <button type="submit" disabled={saving} className="h-10 shrink-0 rounded-xl bg-cream px-4 text-xs font-bold text-void disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : t.hl.guestSave}
          </button>
        </form>
      ) : (
        <p className="flex items-center gap-2 text-sm text-cream">
          <span className="min-w-0 truncate font-semibold">{guest.name}</span>
          <button
            type="button"
            onClick={() => {
              setName(guest.name)
              setEditing(true)
            }}
            aria-label={t.hl.guestRename}
            title={t.hl.guestRename}
            className="grid size-7 shrink-0 place-items-center rounded-full text-cream/55 transition-colors hover:bg-white/5 hover:text-cream"
          >
            <Pencil size={13} aria-hidden />
          </button>
        </p>
      )}
      <p className="text-xs leading-relaxed text-cream/60">{t.hl.guest}</p>
      <button
        type="button"
        onClick={openAuth}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl text-xs font-bold text-[#2a1a02]"
        style={{ background: 'linear-gradient(135deg, #fff0b0, #e0a82e 55%, #c8901c)' }}
      >
        <UserPlus size={14} aria-hidden />
        {t.hl.guestCta}
      </button>
    </div>
  )
}

/* ---- COOP ------------------------------------------------------------------------------ */

/** Jouer à plusieurs : créer un salon (sur le terrain choisi) ou en rejoindre un avec son code. */
function CoopEntry({ metric }: { metric: HlMetric }) {
  const t = useT()
  const create = useHlCoopStore((state) => state.create)
  const join = useHlCoopStore((state) => state.join)
  const notify = useUiStore((state) => state.notify)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)

  const run = async (kind: 'create' | 'join', task: () => Promise<void>) => {
    vibrate(10)
    hlSound(playHlSelect)
    setBusy(kind)
    try {
      await task()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(null)
    }
  }

  const submit = () => {
    const parsed = parseRoomCode(code)
    if (!parsed) {
      notify(t.hl.coop.badCode, 'nope')
      return
    }
    void run('join', () => join(parsed))
  }

  return (
    <div data-hl-in className="w-full rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-3">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        <span className="grid size-10 shrink-0 place-items-center rounded-full text-[#04241a]" style={{ background: HL_GRADIENT }}>
          <Users size={18} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-cream">{t.hl.coop.entry}</span>
          <span className="block text-xs text-cream/55">{t.hl.coop.entryHint}</span>
        </span>
        <ChevronRight size={16} className={`shrink-0 text-cream/50 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => void run('create', () => create(metric))}
            disabled={busy !== null}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold text-[#140c1f] transition-transform active:scale-[0.97] disabled:opacity-70"
            style={{ background: METRIC_STYLE[metric].gradient }}
          >
            {busy === 'create' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}
            {t.hl.coop.create}
          </button>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-label={t.hl.coop.codeLabel}
              placeholder={t.hl.coop.codePlaceholder}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={9}
              className="h-12 min-w-0 flex-1 rounded-2xl border border-white/12 bg-black/40 px-4 text-center font-mono text-base tracking-[0.2em] text-cream uppercase placeholder:text-cream/25 focus:border-white/30 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy !== null || code.trim().length === 0}
              className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-2xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-cream transition-transform active:scale-95 disabled:opacity-50"
            >
              {busy === 'join' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <LogIn size={15} aria-hidden />}
              {t.hl.coop.join}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

/* ---- Vitrine -------------------------------------------------------------------------- */

/** Le duel d'exemple : A avec sa valeur, B qui attend (« ? » qui respire, ▲ ▼ qui flottent). */
function Showcase({ metric, current, next }: { metric: HlMetric; current: HlCard; next: HlCard }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      gsap.fromTo('[data-show="a"]', { x: -24, rotation: -4, autoAlpha: 0 }, { x: 0, rotation: -3, autoAlpha: 1, duration: 0.55, ease: EASE.glide })
      gsap.fromTo('[data-show="b"]', { x: 24, rotation: 4, autoAlpha: 0 }, { x: 0, rotation: 3, autoAlpha: 1, duration: 0.55, delay: 0.06, ease: EASE.glide })
      gsap.fromTo('[data-show-orb]', { scale: 0.5 }, { scale: 1, duration: 0.5, delay: 0.15, ease: EASE.snap })
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.to('[data-show-mark]', { scale: 1.12, duration: 1.2, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('[data-show-up]', { y: -4, duration: 0.9, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('[data-show-down]', { y: 4, duration: 0.9, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 0.3 })
    },
    { scope: ref },
  )

  return (
    <div ref={ref} className="relative grid grid-cols-2 gap-4 px-1">
      <div data-show="a" className="will-change-transform">
        <PreviewCard card={current} metric={metric} />
      </div>
      <div data-show="b" className="will-change-transform">
        <PreviewCard card={next} metric={metric} />
      </div>
      <span
        data-show-orb
        className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 font-display text-lg will-change-transform"
        style={{ background: 'radial-gradient(circle at 50% 35%, rgba(124,92,255,0.5), #08080f 70%)', boxShadow: '0 0 0 5px #050508' }}
      >
        <span style={inkText(HL_GRADIENT)}>{t.hl.vs}</span>
      </span>
    </div>
  )
}

function PreviewCard({ card, metric }: { card: HlCard; metric: HlMetric }) {
  const t = useT()
  const locale = useLanguage()
  const [broken, setBroken] = useState(false)
  return (
    <div className="relative isolate aspect-[3/4] overflow-hidden rounded-[1.4rem] border border-white/10" style={{ background: CARD_INK }}>
      {card.image && !broken && (
        <img
          src={card.image}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => setBroken(true)}
          className={`absolute inset-0 -z-10 h-full w-full object-cover ${metric === 'bounty' ? 'object-[50%_15%]' : 'object-center'}`} // i18n-ignore
        />
      )}
      <div aria-hidden className="absolute inset-0 -z-10" style={{ background: 'linear-gradient(180deg, transparent 35%, rgba(5,5,8,0.85) 75%, #050508)' }} />
      <div className="flex h-full flex-col items-center justify-end p-3 text-center">
        <p className="line-clamp-2 font-display text-lg leading-tight text-cream">{card.name}</p>
        {card.value !== null ? (
          <p className="mt-1 font-display text-base leading-none tabular-nums" style={inkText('linear-gradient(180deg, #fff8dc, #ffc46b 60%, #ff9a3d)')}>
            {formatHlValue(card.value, metric, locale)} <span className="text-[11px] text-cream/50">{t.hl.metrics[metric].unit}</span>
          </p>
        ) : (
          <p className="mt-1 flex items-center gap-1.5 leading-none">
            <ArrowUp data-show-up size={14} strokeWidth={3} style={{ color: HL_UP.color }} aria-hidden />
            <span data-show-mark className="inline-block font-display text-2xl will-change-transform" style={inkText(HL_GRADIENT)}>
              ?
            </span>
            <ArrowDown data-show-down size={14} strokeWidth={3} style={{ color: HL_DOWN.color }} aria-hidden />
          </p>
        )}
      </div>
    </div>
  )
}

/* ---- Classement ------------------------------------------------------------------------ */

/** Panneau qui monte du bas : classement du jour ou de tous les temps. */
function LeaderboardSheet({ overview, onClose }: { overview: HlOverview; onClose: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'today' | 'allTime'>('today')
  const rows = overview.leaderboard[tab]
  const myRank = tab === 'today' ? overview.leaderboard.myToday : overview.leaderboard.myAllTime
  const myStreak = tab === 'today' ? overview.me.todayBest : overview.me.best
  const { contextSafe } = useGSAP(
    () => {
      gsap.fromTo('[data-sheet-veil]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 })
      gsap.fromTo('[data-sheet]', { yPercent: 100 }, { yPercent: 0, duration: 0.5, ease: EASE.glide })
    },
    { scope: ref },
  )
  const close = contextSafe(() => {
    gsap.to('[data-sheet-veil]', { autoAlpha: 0, duration: 0.25 })
    gsap.to('[data-sheet]', { yPercent: 100, duration: 0.3, ease: EASE.exit, onComplete: onClose })
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div ref={ref} className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={t.hl.leaderboard.title}>
      <div data-sheet-veil className="absolute inset-0 bg-black/70" onClick={close} />
      <div data-sheet className="relative flex max-h-[78vh] w-full max-w-md flex-col rounded-t-[2rem] border border-b-0 border-white/10 bg-[#0b0b12] px-5 pt-3 pb-8 will-change-transform">
        <span aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-xl text-cream">
            <Crown size={17} className="text-gold" aria-hidden />
            {t.hl.leaderboard.title}
          </h3>
          <button type="button" onClick={close} aria-label={t.hl.leaderboard.close} className="grid size-8 place-items-center rounded-full text-cream/50 hover:text-cream">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div role="tablist" className="mb-3 grid grid-cols-2 rounded-full bg-white/5 p-1 text-xs">
          {(['today', 'allTime'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded-full py-1.5 font-semibold transition-colors ${tab === key ? 'bg-white/10 text-cream' : 'text-cream/45'}`} // i18n-ignore
            >
              {t.hl.leaderboard[key]}
            </button>
          ))}
        </div>
        <div className="no-scrollbar min-h-0 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-cream/40">{t.hl.leaderboard.empty}</p>
          ) : (
            <ol className="flex flex-col">
              {rows.map((row) => (
                <StandingRow key={row.userId} row={row} />
              ))}
            </ol>
          )}
          {!rows.some((row) => row.me) && myRank !== null && (
            <p className="mt-1 flex items-center gap-3 border-t border-white/[0.07] px-1 pt-2.5 text-sm text-cream/70">
              <span className="w-6 text-center text-xs tabular-nums">{myRank}</span>
              <span className="flex-1">{t.hl.leaderboard.you}</span>
              <StreakValue streak={myStreak} />
            </p>
          )}
        </div>
        <p className="mt-4 text-center text-[11px] text-cream/50 tabular-nums">{t.hl.earnedToday(overview.me.earnedToday, overview.dailyCap)}</p>
        <p className="mt-1 text-center text-[10px] leading-relaxed text-cream/30">{t.hl.disclaimer}</p>
      </div>
    </div>
  )
}

const MEDALS = ['#ffd76b', '#d9e2f2', '#e0a070'] as const

function StandingRow({ row }: { row: HlStanding }) {
  const t = useT()
  const name = row.name?.trim() || t.hl.leaderboard.anonymous
  const medal = row.rank <= 3 ? MEDALS[row.rank - 1] : undefined
  return (
    <li className="flex items-center gap-3 px-1 py-2">
      <span className="w-6 text-center text-xs font-bold tabular-nums" style={{ color: medal ?? 'rgba(247,245,240,0.4)' }}>
        {row.rank}
      </span>
      <CardAvatar card={null} avatarUrl={row.avatarUrl} initial={name.charAt(0).toUpperCase()} size={28} />
      <span className={`min-w-0 flex-1 truncate text-sm ${row.me ? 'font-semibold text-[#5ef2c2]' : 'text-cream/85'}`}>{name}</span>
      {row.metric && (
        <span className="shrink-0" style={{ color: METRIC_STYLE[row.metric].accent }} title={t.hl.metrics[row.metric].title}>
          <MetricIcon metric={row.metric} size={13} />
        </span>
      )}
      <StreakValue streak={row.streak} />
    </li>
  )
}

function StreakValue({ streak }: { streak: number }) {
  return (
    <span className="flex w-10 shrink-0 items-center justify-end gap-1 text-sm font-semibold text-cream tabular-nums">
      <Flame size={13} className="text-[#ff8a3d]" aria-hidden />
      {streak}
    </span>
  )
}
