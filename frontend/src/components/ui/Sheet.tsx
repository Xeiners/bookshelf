import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'

type Slot = ReactNode | ((dismiss: () => void) => ReactNode)

interface SheetProps {
  /** Nom du dialogue pour les lecteurs d'écran. */
  label: string
  title: string
  subtitle?: string
  /** Appelé une fois l'animation de sortie terminée : le parent démonte la feuille. */
  onClose: () => void
  /** Reçoit `dismiss` quand il faut fermer après une action (sortie animée). */
  children: Slot
  /** Zone fixe sous le contenu défilant (bouton d'enregistrement…). */
  footer?: Slot
}

const render = (slot: Slot, dismiss: () => void) => (typeof slot === 'function' ? slot(dismiss) : slot)

/**
 * Feuille modale : glisse du bas sur téléphone, carte centrée en bas sur grand
 * écran. Entrée et sortie en `transform` / `opacity` seulement (GPU). Fermeture
 * par le fond, la croix ou Échap.
 */
export function Sheet({ label, title, subtitle, onClose, children, footer }: SheetProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  /** Fermeture demandée : l'animation de sortie part une seule fois, puis `onClose`. */
  const [closing, setClosing] = useState(false)
  const dismiss = useCallback(() => setClosing(true), [])

  useGSAP(
    () => {
      gsap
        .timeline({ defaults: { ease: EASE.glide } })
        .fromTo('[data-sheet-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 }, 0)
        .fromTo('[data-sheet-panel]', { yPercent: 100 }, { yPercent: 0, duration: 0.6 }, 0)
    },
    { scope: rootRef },
  )

  useGSAP(
    () => {
      if (!closing) return
      gsap
        .timeline({ onComplete: onClose })
        .to('[data-sheet-panel]', { yPercent: 100, duration: 0.35, ease: EASE.exit, overwrite: true }, 0)
        .to('[data-sheet-backdrop]', { autoAlpha: 0, duration: 0.3, overwrite: true }, 0)
    },
    { dependencies: [closing], scope: rootRef },
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismiss])

  const footerContent = footer === undefined ? null : render(footer, dismiss)

  return (
    <div ref={rootRef} className="fixed inset-0 z-[90]" role="dialog" aria-modal aria-label={label}>
      <div data-sheet-backdrop onClick={dismiss} className="absolute inset-0 bg-void/90 opacity-0" />
      <div
        data-sheet-panel
        className="glass-strong absolute inset-x-0 bottom-0 mx-auto flex max-h-[90svh] flex-col rounded-t-[2.25rem] pb-safe will-change-transform md:bottom-6 md:max-w-xl md:rounded-[2.25rem]"
      >
        <div className="flex shrink-0 items-start gap-3 px-6 pt-6 pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1.75rem] leading-none text-cream">{title}</h2>
            {subtitle && <p className="mt-2 text-xs text-mist">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t.common.close}
            className="glass grid size-9 shrink-0 place-items-center rounded-full text-cream/60"
          >
            <X size={16} />
          </button>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
          {render(children, dismiss)}
        </div>

        {footerContent && <div className="shrink-0 border-t border-white/8 px-5 pt-4 pb-2">{footerContent}</div>}
      </div>
    </div>
  )
}
