import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { DailyGame } from './DailyGame'
import { DleBar } from './DleBar'
import { BentoHome } from './BentoHome'
import { CategoryMenu } from './DleHome'
import { DleMulti } from './DleMulti'
import { RoomScreen } from './RoomScreen'

/**
 * Activité « BookshelfDLE » : la grille des catégories, le menu d'une catégorie,
 * une énigme du jour, le multijoueur, ou un salon. Sans compte : le multijoueur
 * (avec un pseudo d'invité) ; les énigmes du jour demandent un compte.
 * Un lien d'invitation (`?dle=<code>`) mène droit au salon.
 */
export function DleView() {
  const t = useT()
  const signedIn = useAuthStore((state) => state.user !== null)
  const screen = useDleStore((state) => state.screen)
  const category = useDleStore((state) => state.category)
  const openHome = useDleStore((state) => state.openHome)
  const overview = useDleStore((state) => state.overview)
  const overviewStatus = useDleStore((state) => state.overviewStatus)
  const pendingCode = useDleStore((state) => state.pendingCode)
  const loadOverview = useDleStore((state) => state.loadOverview)
  const loadWorks = useDleStore((state) => state.loadWorks)
  const joinRoom = useDleStore((state) => state.joinRoom)
  const setPendingCode = useDleStore((state) => state.setPendingCode)
  const openActivity = useUiStore((state) => state.openActivity)
  const notify = useUiStore((state) => state.notify)
  const rootRef = useRef<HTMLDivElement>(null)

  // Accueil : celui du compte, ou celui d'un invité (le multijoueur s'ouvre sans compte).
  useEffect(() => {
    void loadOverview()
  }, [signedIn, loadOverview])

  // Propositions de la catégorie choisie (saisie des énigmes et des salons).
  useEffect(() => {
    void loadWorks(category)
  }, [category, loadWorks])

  // Invitation reçue : on entre dans le salon (sans compte, avec un pseudo d'invité).
  const ensureGuest = useDleStore((state) => state.ensureGuest)
  const hasGuest = overview?.guest != null
  const joining = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingCode || !overview || joining.current === pendingCode) return
    joining.current = pendingCode
    const enter = signedIn || hasGuest ? Promise.resolve() : ensureGuest('')
    enter
      .then(() => joinRoom(pendingCode))
      .catch((error: unknown) => {
        setPendingCode(null)
        notify(apiErrorMessage(error, t), 'nope')
      })
      .finally(() => (joining.current = null))
  }, [signedIn, hasGuest, overview, pendingCode, ensureGuest, joinRoom, setPendingCode, notify, t])

  // Chaque écran du jeu arrive en glissant.
  const screenKey = screen.kind === 'daily' ? `daily:${category}:${screen.mode}` : screen.kind === 'category' ? `category:${category}` : screen.kind
  useGSAP(
    () => {
      // Seul le contenu glisse : la barre du haut (et son retour) ne bouge jamais.
      gsap.fromTo('[data-dle-body]', { autoAlpha: 0, x: screen.kind === 'home' ? -12 : 14 }, { autoAlpha: 1, x: 0, duration: 0.4, ease: EASE.glide })
    },
    { scope: rootRef, dependencies: [screenKey] },
  )

  const back = <DleBar label={t.activities.back} onBack={() => openActivity('hub')} />

  return (
    <div ref={rootRef} key={screenKey} className="flex min-h-0 flex-1 flex-col">
      {screen.kind === 'room' ? (
        <RoomScreen />
      ) : screen.kind === 'multi' ? (
        <DleMulti currentRoom={overview?.currentRoom ?? null} />
      ) : screen.kind === 'daily' ? (
        // Une énigme = un état neuf (victoire, vitre…), et le défilement repart du haut.
        <DailyGame key={`${category}:${screen.mode}`} mode={screen.mode} />
      ) : overview && screen.kind === 'category' ? (
        <>
          <DleBar label={t.dle.title} onBack={openHome} />
          <div data-dle-body className="flex min-h-0 flex-1 flex-col">
            <CategoryMenu overview={overview} category={category} />
          </div>
        </>
      ) : overview ? (
        <>
          {back}
          <div data-dle-body className="flex min-h-0 flex-1 flex-col">
            <BentoHome overview={overview} />
          </div>
        </>
      ) : (
        <>
          {back}
          <div className="grid flex-1 place-items-center pb-16">
            {overviewStatus === 'error' ? (
              <div role="alert" className="flex flex-col items-center gap-3 text-center">
                <p className="text-sm text-cream/80">{t.dle.home.loadError}</p>
                <button type="button" onClick={() => void loadOverview()} className="rounded-full bg-cream px-5 py-2.5 text-xs font-medium text-void">
                  {t.dle.home.retry}
                </button>
              </div>
            ) : (
              <Loader2 size={26} className="animate-spin text-glow" aria-hidden />
            )}
          </div>
        </>
      )}
    </div>
  )
}
