import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BellOff, CheckCheck, ChevronRight, Gift, Loader2, MoonStar, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { useBoosters } from '../../hooks/useBoosters'
import { openNotification } from '../../hooks/useNotifications'
import { useOracleStatus } from '../../hooks/useOracleStatus'
import { useT } from '../../i18n'
import { Draggable, EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { notificationCopy, relativeTime, splitByRead } from '../../lib/notifications'
import type { AppNotification } from '../../services/notificationsApi'
import { useNotificationStore } from '../../store/useNotificationStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useUiStore } from '../../store/useUiStore'
import { Sheet } from '../ui/Sheet'
import { NotificationThumb } from './NotificationContent'

/** Glissée au-delà de cette part de sa largeur, une notification est effacée. */
const SWIPE_COMMIT = 0.35

/**
 * Centre de notifications : les rappels du moment (booster prêt, tirage du
 * jour), puis les nouvelles et les plus anciennes. Une notification se touche
 * (elle mène à l'échange ou à l'offre) ou se glisse vers la gauche pour
 * l'effacer. Refermer le centre marque tout comme lu.
 */
export function NotificationCenter() {
  const t = useT()
  const copy = t.notifications
  const closeNotifications = useUiStore((state) => state.closeNotifications)
  const items = useNotificationStore((state) => state.items)
  const unread = useNotificationStore((state) => state.unread)
  const status = useNotificationStore((state) => state.status)
  const load = useNotificationStore((state) => state.load)
  const markAllRead = useNotificationStore((state) => state.markAllRead)
  const sound = useSettingsStore((state) => state.notificationSound)
  const toggleSound = useSettingsStore((state) => state.toggleNotificationSound)
  const listRef = useRef<HTMLDivElement>(null)

  // À l'ouverture : liste complète (offres signalées encore ouvertes ou non).
  useEffect(() => {
    void load()
  }, [load])

  // Les dates relatives avancent tant que le centre est ouvert.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const { fresh, earlier } = splitByRead(items)
  const reminders = useReminders()

  // Entrée en cascade, une fois le contenu là.
  const ready = status === 'ready' || items.length > 0
  useGSAP(
    () => {
      if (!ready) return
      gsap.fromTo('[data-notif-enter]', { x: 24, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.5, stagger: 0.045, ease: EASE.glide, delay: 0.15 })
    },
    { scope: listRef, dependencies: [ready] },
  )

  return (
    <Sheet
      label={copy.title}
      title={copy.title}
      subtitle={copy.subtitle}
      onClose={() => {
        // Vu, donc lu : la cloche s'éteint en refermant.
        markAllRead()
        closeNotifications()
      }}
    >
      {(dismiss) => (
        <div ref={listRef} className="flex flex-col gap-5">
          <div data-notif-enter className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                vibrate(6)
                toggleSound()
              }}
              aria-pressed={sound}
              aria-label={sound ? copy.sound.on : copy.sound.off}
              title={sound ? copy.sound.on : copy.sound.off}
              className="glass grid size-9 place-items-center rounded-full text-cream/70"
            >
              {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
            <button
              type="button"
              onClick={() => {
                vibrate(6)
                markAllRead()
              }}
              disabled={unread === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-cream/10 px-3.5 text-xs font-semibold text-cream transition-opacity disabled:opacity-35"
            >
              <CheckCheck size={14} aria-hidden />
              {copy.markAll}
            </button>
          </div>

          {reminders.length > 0 && (
            <Section title={copy.reminders}>
              {reminders.map((reminder) => (
                <li key={reminder.id} data-notif-enter>
                  <button
                    type="button"
                    onClick={() => {
                      vibrate(6)
                      reminder.open()
                      dismiss()
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-gold/25 bg-gold/[0.06] p-3 text-left"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-black/40 text-gold shadow-[inset_0_0_14px_rgba(255,196,107,0.2)]">
                      {reminder.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-cream">{reminder.title}</span>
                      <span className="block truncate text-[11.5px] text-mist">{reminder.body}</span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-cream/40" aria-hidden />
                  </button>
                </li>
              ))}
            </Section>
          )}

          {status === 'error' && items.length === 0 && (
            <div data-notif-enter className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-mist">{copy.error}</p>
              <button type="button" onClick={() => void load()} className="rounded-full bg-cream/10 px-4 py-2 text-xs font-semibold text-cream">
                {copy.retry}
              </button>
            </div>
          )}
          {(status === 'loading' || status === 'idle') && items.length === 0 && (
            <div className="flex justify-center py-8 text-mist">
              <Loader2 size={20} className="animate-spin" aria-hidden />
            </div>
          )}
          {status === 'ready' && items.length === 0 && (
            <div data-notif-enter className="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-cream/[0.06] text-cream/40">
                <BellOff size={24} aria-hidden />
              </span>
              <p className="text-sm text-cream/80">{copy.empty}</p>
              <p className="max-w-xs text-xs leading-5 text-mist">{copy.emptyHint}</p>
            </div>
          )}

          {fresh.length > 0 && (
            <Section title={copy.fresh}>
              {fresh.map((item) => (
                <NotificationRow key={item.id} item={item} now={now} />
              ))}
            </Section>
          )}
          {earlier.length > 0 && (
            <Section title={copy.earlier}>
              {earlier.map((item) => (
                <NotificationRow key={item.id} item={item} now={now} />
              ))}
            </Section>
          )}
          {items.length > 0 && (
            <p data-notif-enter className="text-center text-[11px] text-mist/70 md:hidden">
              {copy.swipeHint}
            </p>
          )}
        </div>
      )}
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 data-notif-enter className="mb-2 text-[11px] tracking-[0.18em] text-mist uppercase">
        {title}
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  )
}

interface Reminder {
  id: string
  icon: ReactNode
  title: string
  body: string
  open: () => void
}

/** Ce qui attend dans les Activités, sans passer par le serveur : booster prêt, tirage du jour. */
function useReminders(): Reminder[] {
  const t = useT()
  const copy = t.notifications.reminder
  const boosters = useBoosters({ tick: false })
  const oracle = useOracleStatus()
  const openActivity = useUiStore((state) => state.openActivity)
  const reminders: Reminder[] = []
  if (boosters.ready && boosters.available > 0) {
    reminders.push({ id: 'booster', icon: <Gift size={19} />, title: copy.booster, body: copy.boosterBody, open: () => openActivity('hub') })
  }
  if (oracle.available) {
    reminders.push({ id: 'oracle', icon: <MoonStar size={19} />, title: copy.oracle, body: copy.oracleBody, open: () => openActivity('oracle') })
  }
  return reminders
}

/**
 * Une notification. Touchée : elle mène à son échange. Glissée vers la gauche
 * (doigt ou souris) : elle découvre la corbeille et s'efface au-delà du seuil.
 * Le bouton ✕ (survol, clavier) fait de même sans geste.
 */
function NotificationRow({ item, now }: { item: AppNotification; now: number }) {
  const t = useT()
  const copy = notificationCopy(item, t)
  const remove = useNotificationStore((state) => state.remove)
  const rootRef = useRef<HTMLLIElement>(null)
  const frontRef = useRef<HTMLDivElement>(null)
  const inactive = item.type === 'trade_match' && !item.active

  /** Sortie animée : créée dans le contexte GSAP (nettoyée au démontage), appelée par le geste, ✕ ou Suppr. */
  const eraseRef = useRef<() => void>(() => {})

  useGSAP(
    (_context, contextSafe) => {
      const front = frontRef.current
      const root = rootRef.current
      if (!front || !root || !contextSafe) return
      // La ligne file à gauche, puis se referme ; l'API l'efface.
      const erase = contextSafe(() => {
        vibrate(10)
        gsap
          .timeline({ onComplete: () => remove(item.id) })
          .to(front, { x: -root.offsetWidth, duration: 0.25, ease: EASE.exit })
          .to(root, { height: 0, marginTop: 0, autoAlpha: 0, duration: 0.25, ease: 'power2.inOut' })
      })
      eraseRef.current = erase
      const [drag] = Draggable.create(front, {
        type: 'x',
        bounds: { minX: -root.offsetWidth, maxX: 0 },
        edgeResistance: 0.85,
        // Le défilement vertical de la feuille reste natif.
        allowNativeTouchScrolling: true,
        minimumMovement: 6,
        onDrag() {
          gsap.set(root.querySelector('[data-notif-trash]'), { autoAlpha: Math.min(1, -this.x / (root.offsetWidth * SWIPE_COMMIT)) })
        },
        onDragEnd() {
          if (-this.x > root.offsetWidth * SWIPE_COMMIT) erase()
          else gsap.to(front, { x: 0, duration: 0.45, ease: EASE.spring })
        },
        onClick() {
          vibrate(6)
          openNotification(item)
        },
      })
      return () => drag?.kill()
    },
    { scope: rootRef, dependencies: [] },
  )

  return (
    <li ref={rootRef} data-notif-enter className="group relative overflow-hidden rounded-2xl">
      {/* Derrière : la corbeille, révélée par le geste. */}
      <div data-notif-trash aria-hidden className="invisible absolute inset-0 flex items-center justify-end gap-1.5 rounded-2xl bg-nope/85 pr-5 text-xs font-semibold text-void">
        <Trash2 size={15} />
        {t.notifications.remove}
      </div>
      <div
        ref={frontRef}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openNotification(item)
          }
          if (event.key === 'Delete' || event.key === 'Backspace') eraseRef.current()
        }}
        className={`relative flex cursor-pointer items-center gap-3 rounded-2xl border p-3 pr-9 will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow/60 ${
          item.read ? 'border-white/8 bg-[#101018]' : 'border-gold/30 bg-[#17141a]'
        } ${inactive ? 'opacity-60' : ''}`}
      >
        <NotificationThumb copy={copy} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13px] leading-snug font-semibold text-cream">{copy.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-cream/60">{copy.body}</p>
          <p className="mt-1 flex items-center gap-2 text-[10.5px] text-mist">
            {relativeTime(item.createdAt, now, t.locale, t.notifications.justNow)}
            {inactive && <span className="rounded-full bg-cream/10 px-1.5 py-px text-[9.5px] text-cream/70">{t.notifications.tradeMatch.gone}</span>}
          </p>
        </div>
        {!item.read && <span aria-hidden className="absolute top-3.5 right-3.5 size-2 rounded-full bg-gold shadow-[0_0_8px_var(--color-gold)]" />}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            eraseRef.current()
          }}
          aria-label={t.notifications.removeAria(copy.title)}
          className="absolute right-2 bottom-2 grid size-7 place-items-center rounded-full text-cream/40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-cream focus-visible:opacity-100"
        >
          <X size={14} />
        </button>
      </div>
    </li>
  )
}
