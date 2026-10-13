import { lazy, Suspense, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { TarotPage } from '../../pages/TarotPage'
import { useAuthStore } from '../../store/useAuthStore'
import { useUiStore } from '../../store/useUiStore'
import { CollectionView } from '../cards/CollectionView'
import { BackButton } from '../ui/BackButton'
import { TradingHubView } from '../trading/TradingHubView'
import { ActivitiesHub } from './ActivitiesHub'
import { SanctumBackdrop } from './SanctumBackdrop'

// BookshelfDLE : chargé à la première partie.
const DleView = lazy(() => import('../dle/DleView').then((module) => ({ default: module.DleView })))
// Higher or Lower : idem.
const HigherLowerView = lazy(() => import('../higherlower/HigherLowerView').then((module) => ({ default: module.HigherLowerView })))
// Anime Bomb Party : idem.
const BombView = lazy(() => import('../bomb/BombView').then((module) => ({ default: module.BombView })))
// Manga Runner 3D : Three.js n'est chargé qu'à l'ouverture du Runner.
const RunnerView = lazy(() => import('../runner/RunnerView').then((module) => ({ default: module.RunnerView })))

/**
 * Onglet « Activités » : le hub, ou un de ses modules (l'Oracle, la
 * collection, le marché d'échange, le BookshelfDLE, le Higher or Lower) avec un
 * retour vers le hub (les deux jeux ont le leur : leurs écrans ont chacun leur retour). Chaque écran arrive en glissant.
 */
export function ActivitiesView() {
  const t = useT()
  const isAdmin = useAuthStore((state) => state.user?.isAdmin === true)
  // Manga Runner 3D : réservé aux administrateurs pour l'instant ; les autres restent sur le hub.
  const requested = useUiStore((state) => state.activity)
  const activity = requested === 'runner' && !isAdmin ? 'hub' : requested
  const openActivity = useUiStore((state) => state.openActivity)
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      gsap.fromTo(rootRef.current, { autoAlpha: 0, x: activity === 'hub' ? -12 : 12 }, { autoAlpha: 1, x: 0, duration: 0.4, ease: EASE.glide })
    },
    { dependencies: [activity] },
  )

  return (
    <div ref={rootRef} key={activity} className="flex min-h-0 flex-1 flex-col">
      {/* Fond du sanctuaire : noir d'encre et halos néon, derrière tout l'onglet. */}
      <SanctumBackdrop />
      {activity === 'hub' ? (
        <ActivitiesHub />
      ) : activity === 'dle' || activity === 'higherlower' || activity === 'bomb' || activity === 'runner' ? (
        <Suspense
          fallback={
            <div className="grid flex-1 place-items-center">
              <Loader2 size={26} className="animate-spin text-glow" aria-hidden />
            </div>
          }
        >
          {activity === 'dle' ? <DleView /> : activity === 'bomb' ? <BombView /> : activity === 'runner' ? <RunnerView /> : <HigherLowerView />}
        </Suspense>
      ) : (
        <>
          <div className="shrink-0 px-4 pb-2">
            <BackButton label={t.activities.back} onBack={() => openActivity('hub')} />
          </div>
          {activity === 'oracle' ? <TarotPage /> : activity === 'market' ? <TradingHubView /> : <CollectionView />}
        </>
      )}
    </div>
  )
}
