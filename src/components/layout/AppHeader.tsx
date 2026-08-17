import { useState } from 'react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import type { ViewId } from '../../store/useUiStore'

const COPY: Record<ViewId, { eyebrow: string; title: string }> = {
  discover: { eyebrow: 'Swipe & Match', title: 'Découverte' },
  search: { eyebrow: 'Tout le catalogue', title: 'Recherche' },
  library: { eyebrow: 'Mes livres', title: 'Bibliothèque' },
  profile: { eyebrow: 'Mon espace', title: 'Profil' },
}

interface AppHeaderProps {
  view: ViewId
}

/**
 * En-tête fixe, monté hors de la zone animée : sa hauteur est identique d'une
 * vue à l'autre et seul le texte est permuté, en `transform` + `opacity` pour
 * éviter tout reflow.
 */
export function AppHeader({ view }: AppHeaderProps) {
  const [copy, setCopy] = useState(COPY[view])

  useGSAP(
    () => {
      const next = COPY[view]
      if (next.title === copy.title) return

      gsap
        .timeline()
        .to('[data-header-line]', {
          y: -10,
          autoAlpha: 0,
          duration: 0.22,
          stagger: 0.04,
          ease: 'power2.in',
        })
        .add(() => setCopy(next))
        .fromTo(
          '[data-header-line]',
          { y: 12, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.06, ease: EASE.glide },
        )
    },
    // Une navigation rapide doit tuer la timeline précédente, sinon deux
    // permutations de texte se chevauchent.
    { dependencies: [view], revertOnUpdate: true },
  )

  return (
    <header className="shrink-0 px-5 pb-3 md:pb-5">
      <p
        data-header-line
        className="text-[10px] tracking-[0.3em] text-mist uppercase md:text-[11px]"
      >
        {copy.eyebrow}
      </p>
      <h1
        data-header-line
        className="text-gradient mt-1 text-[2rem] leading-[1.1] md:text-[2.75rem]"
      >
        {copy.title}
      </h1>
    </header>
  )
}
