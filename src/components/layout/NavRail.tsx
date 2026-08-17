import { useRef } from 'react'
import { gsap, useGSAP } from '../../lib/gsap'
import type { ViewId } from '../../store/useUiStore'
import { NAV_COLOR_ACTIVE, NAV_COLOR_IDLE, NAV_ITEMS } from './navItems'

interface NavRailProps {
  view: ViewId
  onChange: (view: ViewId) => void
}

/**
 * Rail vertical (tablette et desktop) : même mécanique que la barre basse, sur
 * l'axe Y. Le libellé n'apparaît qu'à partir de `lg`, pour ne pas manger la
 * largeur utile en dessous.
 */
export function NavRail({ view, onChange }: NavRailProps) {
  const railRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const index = NAV_ITEMS.findIndex((item) => item.id === view)

      gsap.to('[data-indicator]', {
        yPercent: index * 100,
        duration: 0.45,
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

      gsap.fromTo(
        `[data-icon="${view}"]`,
        { scale: 0.86 },
        { scale: 1, duration: 0.45, ease: 'back.out(2)', overwrite: 'auto' },
      )
    },
    { dependencies: [view], scope: railRef },
  )

  return (
    <aside className="hidden shrink-0 flex-col gap-6 py-6 pl-5 md:flex lg:pl-8">
      <p className="hidden px-4 font-display text-2xl leading-none lg:block">Bookshelf</p>

      <nav
        ref={railRef}
        aria-label="Navigation principale"
        className="glass-strong relative flex flex-col overflow-hidden rounded-4xl p-1.5 shadow-lift"
      >
        {/* Capsule active — hauteur = 1 cellule */}
        <span
          data-indicator
          aria-hidden
          className="pointer-events-none absolute inset-x-1.5 top-1.5 h-[calc((100%-0.75rem)/4)] rounded-3xl bg-cream will-change-transform"
        />

        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.id === view
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                if (isActive) return
                onChange(item.id)
              }}
              className="relative z-10 flex items-center gap-3 rounded-3xl px-4 py-4 lg:w-44"
            >
              <span data-icon={item.id} data-tint={item.id} className="shrink-0 text-mist">
                <Icon size={20} strokeWidth={2} />
              </span>
              <span
                data-tint={item.id}
                className="hidden text-[13px] font-medium whitespace-nowrap text-mist lg:block"
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
