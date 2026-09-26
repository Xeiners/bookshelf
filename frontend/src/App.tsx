import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { EASE, gsap, useGSAP } from './lib/gsap'
import { BookSheet } from './components/book/BookSheet'
import { DiscoverView } from './components/discover/DiscoverView'
import { LibraryView } from './components/library/LibraryView'
import { ProfileView } from './components/profile/ProfileView'
import { SearchView } from './components/search/SearchView'
import { TarotPage } from './pages/TarotPage'
import { AmbientBackdrop } from './components/layout/AmbientBackdrop'
import { AppHeader } from './components/layout/AppHeader'
import { BottomNav } from './components/layout/BottomNav'
import { NavRail } from './components/layout/NavRail'
import { GuestBanner } from './components/layout/GuestBanner'
import { Sidebar } from './components/layout/Sidebar'
import { useSettingsStore } from './store/useSettingsStore'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { SplashIntro } from './components/layout/SplashIntro'
import { ToastHost } from './components/ui/ToastHost'
import { AuthSheet } from './components/profile/AuthSheet'
import { useLibraryLocalization } from './hooks/useLibraryLocalization'
import { useLanguage, useT } from './i18n'
import { useAuthStore } from './store/useAuthStore'
import { useUiStore } from './store/useUiStore'
import { LocalFilesSheet } from './components/reader/LocalFilesSheet'

// Le lecteur (et ses moteurs) n'est téléchargé qu'à la première lecture.
const UniversalReader = lazy(() =>
  import('./components/reader/UniversalReader').then((module) => ({ default: module.UniversalReader })),
)

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
  const authOpen = useUiStore((state) => state.authOpen)
  const reader = useUiStore((state) => state.reader)
  const filesOpen = useUiStore((state) => state.filesOpen)

  // Session : validation, envoi des actions en attente, récupération du compte.
  useEffect(() => {
    void useAuthStore.getState().bootstrap()
  }, [])

  // Bibliothèque enregistrée retraduite dans la langue choisie.
  useLibraryLocalization()

  // 1–5, Ctrl/⌘ K, Ctrl/⌘ B.
  useKeyboardShortcuts()

  // Bandeau « connecte-toi » : invités seulement, tant qu'ils ne l'ont pas retiré.
  const signedIn = useAuthStore((state) => state.user !== null)
  const bannerDismissed = useSettingsStore((state) => state.guestBannerDismissed)
  const showBanner = !signedIn && !bannerDismissed

  // Le document suit la langue : lecteurs d'écran, césure, traduction auto du navigateur.
  const language = useLanguage()
  const t = useT()
  useEffect(() => {
    document.documentElement.lang = language
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.meta.description)
  }, [language, t])

  /** Vue réellement montée : elle ne suit `view` qu'après l'animation de sortie. */
  const [rendered, setRendered] = useState(view)
  const [showSplash, setShowSplash] = useState(readSplashFlag)

  const stageRef = useRef<HTMLElement>(null)

  // Transition courte et verticale : le châssis reste stable entre les vues.
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

      <div className="flex h-full w-full flex-col">
        {showBanner && <GuestBanner />}

        <div className="flex min-h-0 w-full flex-1">
          {/* Tablette : rail d'icônes. Ordinateur (≥ lg) : barre latérale complète. */}
          <NavRail view={view} onChange={setView} />
          <Sidebar view={view} onChange={setView} />

          {/*
           * `min-h-0` est requis sur CHAQUE maillon de la chaîne flex verticale.
           * Un maillon qui garde `min-height: auto` refuse de se comprimer, donc
           * le conteneur de défilement plus bas n'est jamais contraint :
           * `overflow-y: auto` ne se déclenche pas et le bas de la page se fait
           * couper par l'`overflow-hidden` de <main>.
           */}
          {/* Le bandeau porte déjà la zone sûre du haut : on ne la rajoute pas en dessous. */}
          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col md:pt-6 lg:pt-8 ${showBanner ? 'pt-4' : 'pt-safe'}`}
          >
            <div className="mx-auto flex w-full max-w-md min-h-0 min-w-0 flex-1 flex-col md:max-w-3xl lg:px-6 xl:max-w-5xl 2xl:max-w-6xl">
              {/* Hors de la zone animée : l'en-tête ne bouge jamais. */}
              <AppHeader view={view} />

              {/* `overflow-hidden` : la carte éjectée part bien au-delà du bord. */}
              <main
                ref={stageRef}
                className="relative flex min-h-0 flex-1 flex-col overflow-hidden pb-nav md:pb-6"
              >
                {rendered === 'discover' && <DiscoverView />}
                {rendered === 'oracle' && <TarotPage />}
                {rendered === 'search' && <SearchView />}
                {rendered === 'library' && <LibraryView />}
                {rendered === 'profile' && <ProfileView />}
              </main>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation flottante — mobile uniquement */}
      {/* Toute la largeur utile du téléphone (marges de 16 px) : cinq onglets respirent. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-safe md:hidden">
        <div className="pointer-events-auto flex w-full max-w-md">
          <BottomNav view={view} onChange={setView} />
        </div>
      </div>

      <ToastHost />

      {detail && <BookSheet key={detail.id} book={detail} />}
      {authOpen && <AuthSheet />}
      {filesOpen && <LocalFilesSheet />}
      {reader && (
        <Suspense fallback={<div className="fixed inset-0 z-[100] bg-black" />}>
          <UniversalReader session={reader} />
        </Suspense>
      )}
      {showSplash && <SplashIntro onDone={finishSplash} />}
    </>
  )
}
