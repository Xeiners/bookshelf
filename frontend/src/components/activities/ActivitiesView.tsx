import { useRef } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { TarotPage } from '../../pages/TarotPage'
import { useUiStore } from '../../store/useUiStore'
import { CollectionView } from '../cards/CollectionView'
import { TradingHubView } from '../trading/TradingHubView'
import { ActivitiesHub } from './ActivitiesHub'
import { SanctumBackdrop } from './SanctumBackdrop'

/**
 * Onglet « Activités » : le hub, ou un de ses modules (l'Oracle, la
 * collection, le marché d'échange) avec un retour vers le hub. Chaque écran arrive en glissant.
 */
export function ActivitiesView() {
  const t = useT()
  const activity = useUiStore((state) => state.activity)
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
      ) : (
        <>
          <div className="shrink-0 px-5 pb-2">
            <button
              type="button"
              onClick={() => {
                vibrate(6)
                openActivity('hub')
              }}
              className="inline-flex items-center gap-1 rounded-full py-1.5 pr-3 text-sm text-mist hover:text-cream"
            >
              <ChevronLeft size={18} aria-hidden />
              {t.activities.back}
            </button>
          </div>
          {activity === 'oracle' ? <TarotPage /> : activity === 'market' ? <TradingHubView /> : <CollectionView />}
        </>
      )}
    </div>
  )
}
