import { useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'

interface SidePanelProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Contenu épinglé sous le titre (bascule de langue…). */
  header?: ReactNode
  footer?: ReactNode
}

/**
 * Tiroir latéral du lecteur (sommaire, réglages). Il reste monté le temps de
 * son animation de sortie : la fermeture glisse au lieu de disparaître.
 */
export function SidePanel({ open, title, onClose, children, header, footer }: SidePanelProps) {
  const t = useT()
  const [rendered, setRendered] = useState(open)
  const rootRef = useRef<HTMLDivElement>(null)

  // Ouverture : on monte tout de suite (mise à jour pendant le rendu, sans
  // passage à vide) ; la fermeture démonte après l'animation de sortie.
  if (open && !rendered) setRendered(true)

  useGSAP(
    () => {
      if (!rendered) return
      const panel = rootRef.current?.querySelector('[data-panel]')
      const backdrop = rootRef.current?.querySelector('[data-backdrop]')
      if (open) {
        gsap.fromTo(panel ?? null, { xPercent: 100 }, { xPercent: 0, duration: 0.45, ease: EASE.glide, overwrite: 'auto' })
        gsap.fromTo(backdrop ?? null, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, overwrite: 'auto' })
      } else {
        gsap.to(backdrop ?? null, { autoAlpha: 0, duration: 0.25, overwrite: 'auto' })
        gsap.to(panel ?? null, { xPercent: 100, duration: 0.3, ease: EASE.exit, overwrite: 'auto', onComplete: () => setRendered(false) })
      }
    },
    { dependencies: [open, rendered], scope: rootRef },
  )

  if (!rendered) return null

  return (
    <div ref={rootRef} className="absolute inset-0 z-40" role="dialog" aria-modal aria-label={title}>
      <div data-backdrop onClick={onClose} className="absolute inset-0 bg-black/70 opacity-0" />
      <aside
        data-panel
        className="glass-strong absolute inset-y-0 right-0 flex w-[min(24rem,90vw)] flex-col border-y-0 border-r-0 pt-safe pb-safe will-change-transform"
      >
        <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-2 md:pt-5">
          <h2 className="min-w-0 flex-1 truncate font-display text-2xl text-cream">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="grid size-9 place-items-center rounded-full text-cream/70 hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>
        {header && <div className="shrink-0 px-5 pb-3">{header}</div>}
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-white/10 px-5 pt-3 text-[11px] text-mist">{footer}</div>}
      </aside>
    </div>
  )
}
