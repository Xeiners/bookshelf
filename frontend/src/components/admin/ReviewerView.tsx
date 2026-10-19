import { useEffect, useRef } from 'react'
import { ArrowLeft, ImageOff } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { useUiStore } from '../../store/useUiStore'
import { Pressable } from '../ui/Pressable'
import { AdminDleImages } from './AdminDleImages'

/**
 * Revue des images d'énigme pour les contrôleurs d'images : le même outil que l'onglet « Images » de
 * l'administration, en plein écran, sans rien d'autre. L'API revérifie le rôle à chaque requête.
 */
export function ReviewerView() {
  const t = useT()
  const close = useUiStore((state) => state.closeReview)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  useGSAP(
    () => {
      gsap.fromTo(rootRef.current, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: EASE.glide })
    },
    { scope: rootRef },
  )

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={t.reviewer.title} className="fixed inset-0 z-[76] flex flex-col bg-void text-cream">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/5 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5">
        <Pressable onClick={close} aria-label={t.admin.close} className="grid size-10 shrink-0 place-items-center rounded-full text-cream/85 hover:bg-white/10">
          <ArrowLeft size={20} />
        </Pressable>
        <p className="flex min-w-0 flex-1 items-center gap-2 truncate text-[11px] font-semibold tracking-[0.22em] text-gold uppercase">
          <ImageOff size={15} aria-hidden />
          {t.reviewer.title}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-4 pt-4">
        <AdminDleImages />
      </div>
    </div>
  )
}
