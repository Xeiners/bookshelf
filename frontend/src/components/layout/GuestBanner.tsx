import { useRef } from 'react'
import { CloudUpload, X } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useUiStore } from '../../store/useUiStore'

/**
 * Bandeau tout en haut de l'app, pour les invités : leurs données ne vivent que
 * sur cet appareil. Un clic ouvre la connexion ; la croix le retire (choix
 * mémorisé sur l'appareil). App ne le monte plus dès qu'une session existe.
 *
 * Il porte lui-même la zone sûre du haut (encoche) : le contenu en dessous
 * n'a donc pas à la rajouter tant qu'il est affiché.
 */
export function GuestBanner() {
  const t = useT()
  const openAuth = useUiStore((state) => state.openAuth)
  const dismiss = useSettingsStore((state) => state.dismissGuestBanner)

  const rootRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)

  const { contextSafe } = useGSAP(
    () => {
      gsap
        .timeline({ defaults: { ease: EASE.swift } })
        .from(rootRef.current, { height: 0, duration: 0.5, delay: 0.4 })
        .from('[data-banner-line]', { y: -8, autoAlpha: 0, duration: 0.45, stagger: 0.06 }, '-=0.25')

      // Reflet discret qui traverse le bandeau de temps en temps.
      gsap.fromTo(
        '[data-banner-sheen]',
        { xPercent: -100 },
        { xPercent: 420, duration: 1.8, ease: 'power2.inOut', repeat: -1, repeatDelay: 6, delay: 1.6 },
      )
    },
    { scope: rootRef },
  )

  const close = () =>
    contextSafe(() => {
      if (closingRef.current) return
      closingRef.current = true
      vibrate(6)
      gsap.to(rootRef.current, { height: 0, autoAlpha: 0, duration: 0.35, ease: 'power2.in', onComplete: dismiss })
    })()

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={t.banner.message}
      className="relative z-30 shrink-0 overflow-hidden bg-void"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="relative flex items-center gap-3 overflow-hidden border-b border-glow/25 bg-linear-to-r from-glow/25 via-glow/12 to-like/12 px-4 py-2.5 md:px-6">
        <span
          data-banner-sheen
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1/4 -skew-x-12 bg-linear-to-r from-transparent via-white/10 to-transparent"
        />

        <span data-banner-line className="grid size-7 shrink-0 place-items-center rounded-full bg-glow/20 text-glow">
          <CloudUpload size={14} />
        </span>

        {/* Tout le message est cliquable : sur téléphone, c'est la cible la plus grande. */}
        <button
          data-banner-line
          type="button"
          onClick={openAuth}
          className="min-w-0 flex-1 text-left text-[12px] leading-snug text-cream md:text-[13px]"
        >
          <span className="font-medium">{t.banner.message}</span>
          <span className="hidden text-cream/60 md:inline"> · {t.banner.detail}</span>
        </button>

        <button
          data-banner-line
          type="button"
          onClick={openAuth}
          // Pas de `transition-transform` : GSAP anime déjà le transform à l'entrée,
          // une transition CSS dessus le ferait traîner (bouton décalé).
          className="hidden shrink-0 rounded-full bg-cream px-3.5 py-1.5 text-[11px] font-medium text-void transition-colors hover:bg-white sm:block"
        >
          {t.auth.login}
        </button>

        <button
          data-banner-line
          type="button"
          onClick={close}
          aria-label={t.banner.dismiss}
          title={t.banner.dismiss}
          className="grid size-7 shrink-0 place-items-center rounded-full text-cream/60 transition-colors hover:bg-cream/10 hover:text-cream"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
