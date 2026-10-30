import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { gsap, useGSAP } from '../../lib/gsap'
import type { SiteTheme } from '../../services/themeApi'
import { useThemeStore } from '../../store/useThemeStore'

/** Couleurs du fond, selon le thème saisonnier : l'aurore, puis les deux grandes lueurs. */
const PALETTE: Record<SiteTheme, { aurora: string; first: string; second: string }> = {
  // Une aurore douce : voiles violet et rose au sommet, une braise dorée tout en bas.
  none: {
    aurora: [
      'radial-gradient(70% 50% at 20% -10%, rgba(124, 92, 255, 0.16), rgba(124, 92, 255, 0.04) 45%, transparent 75%)',
      'radial-gradient(60% 45% at 85% -5%, rgba(255, 94, 196, 0.08), transparent 70%)',
      'radial-gradient(60% 40% at 85% 108%, rgba(255, 170, 90, 0.06), transparent 70%)',
    ].join(', '),
    first: 'radial-gradient(closest-side, rgba(124, 92, 255, 0.16), rgba(124, 92, 255, 0.05) 50%, transparent)',
    second: 'radial-gradient(closest-side, rgba(255, 110, 170, 0.12), rgba(255, 170, 90, 0.04) 55%, transparent)',
  },
  // Halloween : un ciel violet nuit, une lueur de citrouille.
  halloween: {
    aurora: [
      'radial-gradient(70% 50% at 20% -10%, rgba(88, 28, 135, 0.08), rgba(88, 28, 135, 0.02) 45%, transparent 75%)',
      'radial-gradient(60% 45% at 85% -5%, rgba(255, 122, 26, 0.03), transparent 70%)',
      'radial-gradient(60% 40% at 85% 108%, rgba(255, 122, 26, 0.025), transparent 70%)',
    ].join(', '),
    first: 'radial-gradient(closest-side, rgba(107, 33, 168, 0.07), rgba(107, 33, 168, 0.02) 50%, transparent)',
    second: 'radial-gradient(closest-side, rgba(255, 122, 26, 0.045), rgba(194, 65, 12, 0.015) 55%, transparent)',
  },
}

/**
 * Fond du Sanctuaire : un noir profond (#050507) sous une aurore très discrète, aux couleurs du
 * thème saisonnier (la couleur reste aux cartes et à la bannière). Monté dans un portail, en plein
 * écran derrière l'interface : la zone animée (`<main>`, transformée) piégerait un élément fixe.
 *
 * Deux lueurs par-dessus, IMMOBILES : elles dérivaient en boucle, et ces grands calques
 * (jusqu'à 900 px) qui bougent obligeaient le téléphone à recomposer tout l'écran en
 * permanence — ralentissements sur les GPU modestes (Galaxy S22).
 */
export function SanctumBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null)
  const palette = PALETTE[useThemeStore((state) => state.theme)]

  useGSAP(() => {
    gsap.fromTo(rootRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: 'power1.out' })
  })

  return createPortal(
    <div ref={rootRef} aria-hidden className="pointer-events-none fixed inset-0 -z-[5] overflow-hidden bg-[#050507]" style={{ backgroundImage: palette.aurora }}>
      <span className="absolute top-[8%] left-[-12%] size-[min(70vmax,900px)] rounded-full" style={{ background: palette.first }} />
      <span className="absolute right-[-14%] bottom-[-10%] size-[min(60vmax,780px)] rounded-full" style={{ background: palette.second }} />
    </div>,
    document.body,
  )
}
