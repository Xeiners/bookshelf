import { useState } from 'react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import type { ViewId } from '../../store/useUiStore'
import { LanguageToggle } from '../ui/LanguageToggle'

interface AppHeaderProps {
  view: ViewId
}

/**
 * En-tête fixe, monté hors de la zone animée : sa hauteur est identique d'une
 * vue à l'autre et seul le texte est permuté, en `transform` + `opacity` pour
 * éviter tout reflow.
 *
 * On mémorise la VUE affichée, pas son texte : un changement de langue met
 * l'en-tête à jour immédiatement, sans rejouer la permutation.
 */
export function AppHeader({ view }: AppHeaderProps) {
  const t = useT()
  const [shownView, setShownView] = useState(view)
  const copy = t.header[shownView]

  useGSAP(
    () => {
      if (view === shownView) return

      gsap
        .timeline()
        .to('[data-header-line]', {
          y: -10,
          autoAlpha: 0,
          duration: 0.22,
          stagger: 0.04,
          ease: 'power2.in',
        })
        .add(() => setShownView(view))
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
    <header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 md:pb-5">
      <div className="min-w-0">
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
      </div>

      {/* Sur ordinateur, la langue se règle dans la barre latérale. */}
      <div className="pt-1 lg:hidden">
        <LanguageToggle />
      </div>
    </header>
  )
}
