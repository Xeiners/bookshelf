import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { openNotification } from '../../hooks/useNotifications'
import { useT } from '../../i18n'
import { Draggable, EASE, gsap, useGSAP } from '../../lib/gsap'
import { accentOf, notificationCopy } from '../../lib/notifications'
import type { AppNotification } from '../../services/notificationsApi'
import { useNotificationStore } from '../../store/useNotificationStore'
import { useUiStore } from '../../store/useUiStore'
import { NotificationThumb } from './NotificationContent'

/** Durée d'affichage d'un bandeau, en secondes (en pause tant qu'on le touche). */
const SHOW_SECONDS = 5.5
/** Remonté de plus de tant de pixels, le bandeau est congédié. */
const DISMISS_DRAG = 36

/**
 * Bandeau d'arrivée, en haut de l'écran, façon notification système : un à la
 * fois (les suivants attendent leur tour). Il tombe en rebondissant, une jauge
 * montre le temps restant ; touché, il ouvre l'échange ; glissé vers le haut,
 * il repart. Muet pendant la lecture : la cloche suffira.
 */
export function NotificationBanner() {
  const current = useNotificationStore((state) => state.banners[0] ?? null)
  const reading = useUiStore((state) => state.reader !== null)
  if (!current || reading) return null
  // `key` : chaque bandeau a sa propre animation et son propre Draggable.
  return createPortal(<Banner key={current.id} item={current} />, document.body)
}

function Banner({ item }: { item: AppNotification }) {
  const t = useT()
  const dismissBanner = useNotificationStore((state) => state.dismissBanner)
  const copy = notificationCopy(item, t)
  const color = accentOf(copy.visual)
  const rootRef = useRef<HTMLDivElement>(null)
  /** Enveloppe : entrée et sortie. Carte : le geste. Séparées, aucune n'interrompt l'autre. */
  const shellRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<gsap.core.Tween | null>(null)
  /** Sortie vers le haut (créée dans le contexte GSAP), puis le bandeau suivant prend sa place. */
  const leaveRef = useRef<() => void>(() => {})

  useGSAP(
    (_context, contextSafe) => {
      const shell = shellRef.current
      const card = cardRef.current
      if (!shell || !card || !contextSafe) return
      const leave = contextSafe(() => {
        timerRef.current?.kill()
        gsap.to(shell, { yPercent: -160, autoAlpha: 0, duration: 0.32, ease: EASE.exit, onComplete: () => dismissBanner(item.id) })
      })
      leaveRef.current = leave
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      gsap.fromTo(
        shell,
        { yPercent: -140, scale: 0.92, autoAlpha: 0 },
        { yPercent: 0, scale: 1, autoAlpha: 1, duration: reduced ? 0.2 : 0.7, ease: reduced ? 'none' : EASE.snap },
      )
      // Le reflet traverse la carte une fois, à l'arrivée.
      if (!reduced) gsap.fromTo('[data-banner-sheen]', { xPercent: -120 }, { xPercent: 260, duration: 1.1, ease: 'power2.inOut', delay: 0.35 })
      timerRef.current = gsap.fromTo('[data-banner-timer]', { scaleX: 1 }, { scaleX: 0, duration: SHOW_SECONDS, ease: 'none', onComplete: leave })

      const [drag] = Draggable.create(card, {
        type: 'y',
        bounds: { minY: -400, maxY: 0 },
        edgeResistance: 0.9,
        minimumMovement: 4,
        onPress: () => timerRef.current?.pause(),
        onRelease() {
          if (this.y < -DISMISS_DRAG) leave()
          else {
            gsap.to(card, { y: 0, duration: 0.4, ease: EASE.spring })
            timerRef.current?.resume()
          }
        },
        onClick(event: PointerEvent) {
          if ((event.target as Element | null)?.closest('[data-banner-close]')) return
          timerRef.current?.kill()
          openNotification(item)
        },
      })
      return () => drag?.kill()
    },
    { scope: rootRef, dependencies: [] },
  )

  return (
    <div ref={rootRef} className="pointer-events-none fixed inset-x-0 top-0 z-[120] flex justify-center px-3 pt-safe">
      <div ref={shellRef} className="invisible flex w-full max-w-md justify-center will-change-transform">
      <div
        ref={cardRef}
        role="status"
        aria-label={t.notifications.banner.label}
        className="glass-strong pointer-events-auto relative mt-3 flex w-full max-w-md cursor-pointer touch-none items-center gap-3 overflow-hidden rounded-3xl p-3 pr-10 will-change-transform select-none"
        style={{ boxShadow: `0 18px 40px -18px rgb(0 0 0 / 0.9), 0 0 0 1px color-mix(in oklab, ${color} 45%, transparent), 0 10px 34px -14px ${color}` }}
        onPointerEnter={() => timerRef.current?.pause()}
        onPointerLeave={() => timerRef.current?.resume()}
      >
        {/* Reflet : une bande claire qui passe une fois (dégradé translaté, aucun filtre). */}
        <span
          data-banner-sheen
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 will-change-transform"
          style={{ background: `linear-gradient(100deg, transparent, color-mix(in oklab, ${color} 22%, transparent), transparent)` }}
        />
        <NotificationThumb copy={copy} size={44} />
        <div className="relative min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-cream">{copy.title}</p>
          <p className="line-clamp-2 text-[12px] leading-snug text-cream/65">{copy.body}</p>
        </div>
        <button
          type="button"
          data-banner-close
          onClick={() => leaveRef.current()}
          aria-label={t.notifications.banner.dismiss}
          className="absolute top-2.5 right-2.5 grid size-7 place-items-center rounded-full text-cream/50 hover:text-cream"
        >
          <X size={14} />
        </button>
        {/* Temps restant : une jauge qui se vide (scaleX), en pause sous le doigt. */}
        <span aria-hidden className="absolute inset-x-4 bottom-0 h-[2px] overflow-hidden rounded-full bg-white/5">
          <span data-banner-timer className="block h-full origin-left will-change-transform" style={{ background: color }} />
        </span>
      </div>
      </div>
    </div>
  )
}
