import { useRef } from 'react'
import { Bell } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { useNotificationStore } from '../../store/useNotificationStore'
import { useUiStore } from '../../store/useUiStore'
import { Pressable } from '../ui/Pressable'

/**
 * Cloche de l'en-tête (comptes seulement) : pastille du nombre de non lues, et
 * la cloche qui sonne — balancier amorti autour de son anneau — à chaque
 * notification qui arrive pendant la session. Ouvre le centre de notifications.
 */
export function NotificationBell() {
  const t = useT()
  const unread = useNotificationStore((state) => state.unread)
  const arrivals = useNotificationStore((state) => state.arrivals)
  const openNotifications = useUiStore((state) => state.openNotifications)
  const rootRef = useRef<HTMLSpanElement>(null)
  const seenArrivals = useRef(arrivals)

  // La pastille apparaît (ou change de nombre) en rebondissant.
  useGSAP(
    () => {
      if (unread === 0) return
      gsap.fromTo('[data-bell-badge]', { scale: 0.4 }, { scale: 1, duration: 0.5, ease: EASE.snap })
    },
    { scope: rootRef, dependencies: [unread] },
  )

  // Une arrivée : la cloche sonne, une onde s'échappe.
  useGSAP(
    () => {
      if (arrivals === seenArrivals.current) return
      seenArrivals.current = arrivals
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap
        .timeline()
        .to('[data-bell-icon]', { keyframes: { rotation: [0, 22, -18, 13, -9, 5, 0] }, duration: 0.9, ease: 'power1.inOut', transformOrigin: '50% 8%' })
        .fromTo('[data-bell-wave]', { scale: 0.7, autoAlpha: 0.75 }, { scale: 1.9, autoAlpha: 0, duration: 0.9, ease: 'power2.out' }, 0)
    },
    { scope: rootRef, dependencies: [arrivals] },
  )

  return (
    <span ref={rootRef} className="relative grid">
      {/* Onde : un anneau de la couleur de l'or, qui s'élargit et s'efface (transform / opacity seulement). */}
      <span data-bell-wave aria-hidden className="pointer-events-none invisible absolute inset-0 rounded-full border-2 border-gold will-change-transform" />
      <Pressable
        onClick={() => {
          vibrate(6)
          openNotifications()
        }}
        aria-label={unread > 0 ? t.notifications.openUnread(unread) : t.notifications.open}
        title={t.notifications.open}
        className={`glass relative grid size-10 place-items-center rounded-full md:size-11 ${unread > 0 ? 'text-gold' : 'text-cream/70'}`}
      >
        <span data-bell-icon className="grid will-change-transform">
          <Bell size={17} className={unread > 0 ? 'fill-gold/20' : ''} />
        </span>
        {unread > 0 && (
          <span
            data-bell-badge
            aria-hidden
            className="absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-nope px-1 text-[10px] leading-none font-bold text-white tabular-nums shadow-[0_0_0_2px_var(--color-void)]"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Pressable>
    </span>
  )
}
