import { useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { useUiStore, type ViewId } from '../../store/useUiStore'
import { LanguageSwitch, LanguageToggle } from '../ui/LanguageToggle'
import { Pressable } from '../ui/Pressable'
import { BrandLogo } from '../ui/BrandLogo'
import { MusicHeaderButton } from '../ambient/MusicHeaderButton'
import { LibraryMenu } from './LibraryMenu'
import { useCollapse } from '../../hooks/useCollapse'
import { NotificationBell } from '../notifications/NotificationBell'
import { useAuthStore } from '../../store/useAuthStore'

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
  const openSettings = useUiStore((state) => state.openSettings)
  const signedIn = useAuthStore((state) => state.user !== null)
  // Recherche défilée : l'en-tête se replie pour laisser la place aux résultats.
  const collapsed = useUiStore((state) => state.chromeCollapsed) && view === 'search'
  const collapseRef = useRef<HTMLDivElement>(null)
  useCollapse(collapseRef, collapsed)

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
    <div ref={collapseRef} className="shrink-0">
    <header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 md:pb-5">
      <div className="flex min-w-0 items-start gap-2.5">
        <BrandLogo variant="mark" size="sm" className="mt-0.5 md:hidden" />
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
      </div>

      <div className="flex shrink-0 items-center gap-2 pt-1">
        {/* Bibliothèque : une bulle vers les romans du compte et les fichiers de l'appareil. */}
        {view === 'library' && <LibraryMenu />}
        {/* Musique d'ambiance, et son mini-lecteur (anneau d'avancement, commandes en bulle) : sur toutes les vues. */}
        <MusicHeaderButton />
        {/* Notifications : échanges conclus, offres qui intéressent (comptes seulement). */}
        {signedIn && <NotificationBell />}
        {/*
         * Langue. Téléphone : une pastille qui bascule (la place manque à côté de la
         * musique et des notifications). Tablette : le sélecteur. Ordinateur : la barre latérale.
         */}
        <div className="md:hidden">
          <LanguageSwitch />
        </div>
        <div className="hidden md:block lg:hidden">
          <LanguageToggle />
        </div>
        {/* Profil : paramètres (compte, lecture, stockage, session), tout en haut à droite. */}
        {view === 'profile' && (
          <Pressable
            onClick={() => {
              vibrate(6)
              openSettings()
            }}
            aria-label={t.settings.open}
            title={t.settings.open}
            className="glass grid size-10 place-items-center rounded-full text-cream/70 md:size-11"
          >
            <Settings size={17} />
          </Pressable>
        )}
      </div>
    </header>
    </div>
  )
}
