import { useRef } from 'react'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import type { ViewId } from '../../store/useUiStore'
import { NAV_COLOR_ACTIVE, NAV_COLOR_IDLE, NAV_ITEMS } from './navItems'

interface BottomNavProps {
  view: ViewId
  onChange: (view: ViewId) => void
}

/**
 * Barre de navigation flottante (mobile).
 *
 * La capsule fait exactement une cellule de large, donc un décalage de 100 % de
 * sa propre largeur = un onglet. D'où le `xPercent` : pas d'`offsetWidth`, donc
 * rien à recalculer au redimensionnement.
 */
export function BottomNav({ view, onChange }: BottomNavProps) {
  const navRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const index = NAV_ITEMS.findIndex((item) => item.id === view)

      // Surtout pas d'easing qui dépasse : l'`overflow-hidden` rognerait la
      // capsule sur le premier et le dernier onglet.
      gsap.to('[data-indicator]', {
        xPercent: index * 100,
        duration: 0.42,
        ease: 'power3.out',
        overwrite: 'auto',
      })

      NAV_ITEMS.forEach((item) => {
        gsap.to(`[data-tint="${item.id}"]`, {
          color: item.id === view ? NAV_COLOR_ACTIVE : NAV_COLOR_IDLE,
          duration: 0.35,
          ease: 'power2.out',
          overwrite: 'auto',
        })
      })

      // Échelle uniquement : un décalage vertical se lirait comme une barre qui saute.
      gsap.fromTo(
        `[data-icon="${view}"]`,
        { scale: 0.86 },
        { scale: 1, duration: 0.45, ease: 'back.out(2)', overwrite: 'auto' },
      )
    },
    { dependencies: [view], scope: navRef },
  )

  return (
    <nav
      ref={navRef}
      aria-label="Navigation principale"
      className="glass-strong relative flex w-full items-stretch overflow-hidden rounded-full p-1.5 shadow-lift"
    >
      {/* Capsule active — largeur = 1 cellule */}
      <span
        data-indicator
        aria-hidden
        className="pointer-events-none absolute top-1.5 bottom-1.5 left-1.5 w-[calc((100%-0.75rem)/4)] rounded-full bg-cream will-change-transform"
      />

      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const isActive = item.id === view
        return (
          <button
            key={item.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              if (isActive) return
              vibrate(8)
              onChange(item.id)
            }}
            className="relative z-10 flex flex-1 flex-col items-center gap-1 py-2.5"
          >
            <span data-icon={item.id} data-tint={item.id} className="text-mist">
              <Icon size={19} strokeWidth={2} />
            </span>
            <span data-tint={item.id} className="text-[10px] font-medium tracking-wide text-mist">
              {item.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
