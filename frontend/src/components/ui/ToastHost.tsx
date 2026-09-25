import { useRef } from 'react'
import { Heart, Sparkles, X } from 'lucide-react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { useUiStore } from '../../store/useUiStore'
import type { ToastTone } from '../../store/useUiStore'

const ICON: Record<ToastTone, typeof Heart> = {
  like: Heart,
  nope: X,
  neutral: Sparkles,
}

const TINT: Record<ToastTone, string> = {
  like: 'text-like',
  nope: 'text-nope',
  neutral: 'text-glow',
}

/** File de notifications éphémères, au-dessus de la barre de navigation. */
export function ToastHost() {
  const toast = useUiStore((state) => state.toast)
  const dismissToast = useUiStore((state) => state.dismissToast)
  const cardRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (!toast) return
      gsap
        .timeline({ onComplete: dismissToast })
        .fromTo(
          cardRef.current,
          { y: 30, autoAlpha: 0, scale: 0.94 },
          { y: 0, autoAlpha: 1, scale: 1, duration: 0.5, ease: EASE.snap },
        )
        .to(cardRef.current, { y: -14, autoAlpha: 0, duration: 0.4, ease: 'power2.in' }, '+=1.9')
    },
    // `revertOnUpdate` est indispensable ici : un nouveau toast doit tuer la
    // timeline du précédent, sinon son `onComplete` le masquerait trop tôt.
    { dependencies: [toast?.id], revertOnUpdate: true },
  )

  if (!toast) return null

  const Icon = ICON[toast.tone]

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[80] flex justify-center px-6 md:bottom-8">
      <div
        ref={cardRef}
        role="status"
        className="glass-strong flex max-w-full items-center gap-2 rounded-full px-4 py-2.5 opacity-0 shadow-lift"
      >
        <Icon size={14} className={`shrink-0 ${TINT[toast.tone]}`} />
        <span className="truncate text-xs text-cream">{toast.message}</span>
      </div>
    </div>
  )
}
