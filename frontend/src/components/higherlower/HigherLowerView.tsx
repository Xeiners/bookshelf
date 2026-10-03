import { useEffect, useRef } from 'react'
import { UserPlus } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { useHigherLowerStore } from '../../store/useHigherLowerStore'
import { useUiStore } from '../../store/useUiStore'
import { DleBar } from '../dle/DleBar'
import { StardustBadge } from '../dle/StardustBadge'
import { HlGame } from './HlGame'
import { HlGameOver } from './HlGameOver'
import { HlHome } from './HlHome'
import { SoundToggle } from './SoundToggle'
import { HL_GRADIENT } from './hlStyle'

/**
 * Higher or Lower : accueil, duel, bilan. Chaque écran a sa barre (retour toujours
 * en haut à gauche, comme le BookshelfDLE) et arrive en glissant.
 */
export function HigherLowerView() {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const screen = useHigherLowerStore((state) => state.screen)
  const loadOverview = useHigherLowerStore((state) => state.loadOverview)
  const openActivity = useUiStore((state) => state.openActivity)
  const stardust = useDleStore((state) => state.overview?.stardust ?? null)
  const loadDle = useDleStore((state) => state.loadOverview)
  const signedIn = useAuthStore((state) => state.user !== null)
  const openAuth = useUiStore((state) => state.openAuth)

  useEffect(() => {
    if (!signedIn) return
    void loadOverview()
    // Solde de Poussières : lu une fois à l'ouverture, il suit ensuite les parties.
    if (useDleStore.getState().overview === null) void loadDle()
  }, [signedIn, loadOverview, loadDle])

  useGSAP(
    () => {
      gsap.fromTo(rootRef.current, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: EASE.glide })
    },
    { dependencies: [screen] },
  )

  return (
    <div ref={rootRef} key={screen} className="flex min-h-0 flex-1 flex-col">
      {screen === 'play' ? (
        <HlGame />
      ) : screen === 'over' ? (
        <HlGameOver />
      ) : (
        <>
          <DleBar label={t.activities.back} onBack={() => openActivity('hub')}>
            {signedIn && <SoundToggle />}
            {stardust !== null && <StardustBadge balance={stardust} />}
          </DleBar>
          {signedIn ? (
            <HlHome />
          ) : (
            // Sans compte : records, classements et Poussières vivent sur le serveur.
            <div className="grid flex-1 place-items-center px-6 pb-16 text-center">
              <div className="flex max-w-xs flex-col items-center gap-4">
                <p className="font-display text-3xl" style={{ backgroundImage: HL_GRADIENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                  {t.hl.title}
                </p>
                <p className="text-sm text-cream/65">{t.hl.guest}</p>
                <button
                  type="button"
                  onClick={openAuth}
                  className="inline-flex h-12 items-center gap-2 rounded-2xl px-6 text-sm font-bold text-[#04241a] transition-transform active:scale-95"
                  style={{ background: HL_GRADIENT }}
                >
                  <UserPlus size={17} aria-hidden />
                  {t.hl.guestCta}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
