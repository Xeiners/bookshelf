import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { EASE, gsap, useGSAP } from './lib/gsap'
import { BookSheet } from './components/book/BookSheet'
import { DiscoverView } from './components/discover/DiscoverView'
import { LibraryView } from './components/library/LibraryView'
import { ProfileView } from './components/profile/ProfileView'
import { SearchView } from './components/search/SearchView'
import { ActivitiesView } from './components/activities/ActivitiesView'
import { BoosterPackModal } from './components/boosters/BoosterPackModal'
import { MusicSheet } from './components/ambient/MusicSheet'
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
import { ProfileEditor } from './components/profile/ProfileEditor'
import { SettingsSheet } from './components/profile/SettingsSheet'
import { useLibraryLocalization } from './hooks/useLibraryLocalization'
import { useLanguage, useT } from './i18n'
import { useAuthStore } from './store/useAuthStore'
import { useProfileStore } from './store/useProfileStore'
import { useUiStore } from './store/useUiStore'
import { LocalFilesSheet } from './components/reader/LocalFilesSheet'
import { EpubMatchModal } from './components/novels/EpubMatchModal'
import { usePendingNovelProgress } from './hooks/useNovels'
import { usePlaylistSync } from './hooks/useAmbientMusic'
import { profileIdFromSearch, withoutProfileParam } from './lib/profileLink'
import { roomCodeFromSearch, withoutRoomParam } from './lib/dle'
import { coopCodeFromSearch, withoutCoopParam } from './lib/higherLower'
import { useHlCoopStore } from './store/useHlCoopStore'
import { useDleStore } from './store/useDleStore'
import { useNotificationPolling } from './hooks/useNotifications'
import { NotificationBanner } from './components/notifications/NotificationBanner'
import { NotificationCenter } from './components/notifications/NotificationCenter'

// Le lecteur (et ses moteurs) n'est téléchargé qu'à la première lecture.
const UniversalReader = lazy(() =>
  import('./components/reader/UniversalReader').then((module) => ({ default: module.UniversalReader })),
)

// Profil public d'un autre compte : chargé à la première consultation.
const PublicProfileView = lazy(() =>
  import('./components/profile/PublicProfileView').then((module) => ({ default: module.PublicProfileView })),
)

// « Mes romans » : chargé à la première ouverture (liste, fiche, recherche de fiches).
/** Laisse passer le démarrage (bibliothèque, découverte) avant de précharger le profil. */
const PROFILE_PRELOAD_DELAY_MS = 1500

// Administration (comptes de `ADMIN_EMAILS`) : jamais téléchargée par les autres.
const AdminView = lazy(() => import('./components/admin/AdminView').then((module) => ({ default: module.AdminView })))

const NovelsSheet = lazy(() => import('./components/novels/NovelsSheet').then((module) => ({ default: module.NovelsSheet })))

const SPLASH_KEY = 'bookshelf:splash-seen'
/** Retour au premier plan : la bibliothèque du compte est reprise si elle date d'au moins… */
const LIBRARY_REFRESH_MS = 5_000

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
  const novelsOpen = useUiStore((state) => state.novelsOpen)
  const boosterOpen = useUiStore((state) => state.boosterOpen)
  const settingsOpen = useUiStore((state) => state.settingsOpen)
  const profileEditorOpen = useUiStore((state) => state.profileEditorOpen)
  const musicOpen = useUiStore((state) => state.musicOpen)
  const publicProfileId = useUiStore((state) => state.publicProfileId)
  const notificationsOpen = useUiStore((state) => state.notificationsOpen)
  const adminOpen = useUiStore((state) => state.adminOpen)
  const isAdmin = useAuthStore((state) => state.user?.isAdmin === true)

  // Session : validation, envoi des actions en attente, récupération du compte.
  useEffect(() => {
    void useAuthStore.getState().bootstrap()
  }, [])

  // Autre appareil : l'app revenue au premier plan (ou le réseau revenu) reprend la
  // bibliothèque du compte, positions de lecture comprises. Une app installée revient
  // souvent de l'arrière-plan sans redémarrer : sans ça, elle gardait l'état du matin.
  useEffect(() => {
    const refresh = () => void useAuthStore.getState().refreshLibrary({ ifOlderThanMs: LIBRARY_REFRESH_MS })
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refresh)
    }
  }, [])

  // Lien de profil partagé (`?u=<id>`) : ouvert une fois, puis retiré de l'adresse.
  useEffect(() => {
    const userId = profileIdFromSearch(window.location.search)
    if (!userId) return
    useUiStore.getState().openPublicProfile(userId)
    window.history.replaceState(window.history.state, '', withoutProfileParam(window.location.href))
  }, [])

  // Invitation à un salon du BookshelfDLE (`?dle=<code>`) : rejoint dès que le compte est là.
  useEffect(() => {
    const code = roomCodeFromSearch(window.location.search)
    if (!code) return
    useDleStore.getState().setPendingCode(code)
    useUiStore.getState().openActivity('dle')
    window.history.replaceState(window.history.state, '', withoutRoomParam(window.location.href))
  }, [])

  // Invitation à un salon COOP du Higher or Lower (`?hl=<code>`).
  useEffect(() => {
    const code = coopCodeFromSearch(window.location.search)
    if (!code) return
    useHlCoopStore.getState().setPendingCode(code)
    useUiStore.getState().openActivity('higherlower')
    window.history.replaceState(window.history.state, '', withoutCoopParam(window.location.href))
  }, [])

  // Bibliothèque enregistrée retraduite dans la langue choisie.
  useLibraryLocalization()

  // Positions de romans lues hors-ligne : envoyées dès que possible.
  usePendingNovelProgress()

  // Playlists de musique : les mêmes sur tous les appareils du compte.
  usePlaylistSync()

  // Notifications du compte (échanges) : relevées en tâche de fond, page visible.
  useNotificationPolling()

  // Profil du compte : chargé en avance, après le démarrage, pour que l'onglet Profil s'ouvre à jour.
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  useEffect(() => {
    if (!accountId) return
    const timer = window.setTimeout(() => void useProfileStore.getState().preload(), PROFILE_PRELOAD_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [accountId])

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
                {rendered === 'activities' && <ActivitiesView />}
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
      {settingsOpen && <SettingsSheet />}
      {profileEditorOpen && <ProfileEditor />}
      {authOpen && <AuthSheet />}
      {filesOpen && <LocalFilesSheet />}
      {novelsOpen && (
        <Suspense fallback={null}>
          <NovelsSheet />
        </Suspense>
      )}
      {boosterOpen && <BoosterPackModal />}
      {musicOpen && <MusicSheet />}
      {notificationsOpen && <NotificationCenter />}
      <NotificationBanner />
      {/* « Quel livre est-ce ? » : un EPUB importé à rattacher à sa fiche. */}
      <EpubMatchModal />
      {adminOpen && isAdmin && (
        <Suspense fallback={<div className="fixed inset-0 z-[76] bg-void" />}>
          <AdminView />
        </Suspense>
      )}
      {publicProfileId && (
        <Suspense fallback={<div className="fixed inset-0 z-[75] bg-void" />}>
          <PublicProfileView key={publicProfileId} userId={publicProfileId} />
        </Suspense>
      )}
      {reader && (
        <Suspense fallback={<div className="fixed inset-0 z-[100] bg-black" />}>
          <UniversalReader session={reader} />
        </Suspense>
      )}
      {showSplash && <SplashIntro onDone={finishSplash} />}
    </>
  )
}
