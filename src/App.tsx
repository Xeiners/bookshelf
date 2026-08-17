import { useRef, useState } from 'react'
import { EASE, gsap, useGSAP } from './lib/gsap'
import { BookSheet } from './components/book/BookSheet'
import { DiscoverView } from './components/discover/DiscoverView'
import { LibraryView } from './components/library/LibraryView'
import { ProfileView } from './components/profile/ProfileView'
import { SearchView } from './components/search/SearchView'
import { AmbientBackdrop } from './components/layout/AmbientBackdrop'
import { AppHeader } from './components/layout/AppHeader'
import { BottomNav } from './components/layout/BottomNav'
import { NavRail } from './components/layout/NavRail'
import { SplashIntro } from './components/layout/SplashIntro'
import { ToastHost } from './components/ui/ToastHost'
import { useUiStore } from './store/useUiStore'

const SPLASH_KEY = 'bookshelf:splash-seen'

function readSplashFlag(): boolean {
  try {
    return !sessionStorage.getItem(SPLASH_KEY)
  } catch {
    // Navigation privée / stockage bloqué : on joue l'intro, sans état.
    return true
  }
}

export default function App() {
  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)
  const detail = useUiStore((state) => state.detail)

  /** Vue réellement montée : elle ne suit `view` qu'après l'animation de sortie. */
  const [rendered, setRendered] = useState(view)
  const [showSplash, setShowSplash] = useState(readSplashFlag)

  const stageRef = useRef<HTMLElement>(null)

  // Pas de glissement horizontal : la barre de navigation est en
  // `backdrop-filter`, et du contenu qui défile dessous fait scintiller le verre.
  useGSAP(
    () => {
      if (view === rendered) return
      gsap.timeline({ onComplete: () => setRendered(view) }).to(stageRef.current, {
        autoAlpha: 0,
        y: -6,
        duration: 0.2,
        ease: 'power2.in',
        overwrite: 'auto',
      })
    },
    { dependencies: [view, rendered] },
  )

  useGSAP(
    () => {
      gsap.fromTo(
        stageRef.current,
        { autoAlpha: 0, y: 10 },
        { autoAlpha: 1, y: 0, duration: 0.5, ease: EASE.glide, overwrite: 'auto' },
      )
    },
    { dependencies: [rendered] },
  )

  const finishSplash = () => {
    try {
      sessionStorage.setItem(SPLASH_KEY, '1')
    } catch {
      // Stockage bloqué : l'intro se rejouera au prochain onglet.
    }
    setShowSplash(false)
  }

  return (
    <>
      <AmbientBackdrop />

      <div className="flex h-full w-full">
        <NavRail view={view} onChange={setView} />

        {/*
         * `min-h-0` est requis sur CHAQUE maillon de la chaîne flex verticale.
         * Un maillon qui garde `min-height: auto` refuse de se comprimer, donc
         * le conteneur de défilement plus bas n'est jamais contraint :
         * `overflow-y: auto` ne se déclenche pas et le bas de la page se fait
         * couper par l'`overflow-hidden` de <main>.
         */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col pt-safe md:pt-6">
          <div className="mx-auto flex w-full max-w-md min-h-0 min-w-0 flex-1 flex-col md:max-w-3xl xl:max-w-5xl">
            {/* Hors de la zone animée : l'en-tête ne bouge jamais. */}
            <AppHeader view={view} />

            {/* `overflow-hidden` : la carte éjectée part bien au-delà du bord. */}
            <main
              ref={stageRef}
              className="relative flex min-h-0 flex-1 flex-col overflow-hidden pb-nav md:pb-6"
            >
              {rendered === 'discover' && <DiscoverView />}
              {rendered === 'search' && <SearchView />}
              {rendered === 'library' && <LibraryView />}
              {rendered === 'profile' && <ProfileView />}
            </main>
          </div>
        </div>
      </div>

      {/* Navigation flottante — mobile uniquement */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-5 pb-safe md:hidden">
        <div className="pointer-events-auto flex w-full max-w-sm">
          <BottomNav view={view} onChange={setView} />
        </div>
      </div>

      <ToastHost />

      {detail && <BookSheet key={detail.id} book={detail} />}
      {showSplash && <SplashIntro onDone={finishSplash} />}
    </>
  )
}
