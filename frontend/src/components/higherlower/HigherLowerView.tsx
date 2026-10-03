import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { useHigherLowerStore, useStardustBalance } from '../../store/useHigherLowerStore'
import { useHlCoopStore } from '../../store/useHlCoopStore'
import { useUiStore } from '../../store/useUiStore'
import { DleBar } from '../dle/DleBar'
import { StardustBadge } from '../dle/StardustBadge'
import { HlCoop } from './HlCoop'
import { HlGame } from './HlGame'
import { HlGameOver } from './HlGameOver'
import { HlHome } from './HlHome'
import { SoundToggle } from './SoundToggle'

/**
 * Higher or Lower : accueil, duel, bilan (et le COOP). Chaque écran a sa barre (retour
 * toujours en haut à gauche, comme le BookshelfDLE) et arrive en glissant.
 *
 * Sans compte, on joue en invité, comme au BookshelfDLE : un pseudo (`Guest_1234` au
 * départ) gardé dans un cookie, des records sur cet appareil seulement, et des
 * Poussières en reçus que l'inscription ajoute au compte.
 */
export function HigherLowerView() {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const screen = useHigherLowerStore((state) => state.screen)
  const loadOverview = useHigherLowerStore((state) => state.loadOverview)
  const openActivity = useUiStore((state) => state.openActivity)
  const notify = useUiStore((state) => state.notify)
  const stardust = useStardustBalance()
  const signedIn = useAuthStore((state) => state.user !== null)
  const dleOverview = useDleStore((state) => state.overview)
  const loadDle = useDleStore((state) => state.loadOverview)
  const ensureGuest = useDleStore((state) => state.ensureGuest)
  const guest = dleOverview?.guest ?? null
  const ready = signedIn || guest !== null
  const coop = useHlCoopStore((state) => state.room)
  const pendingCode = useHlCoopStore((state) => state.pendingCode)
  const currentCoop = useHigherLowerStore((state) => state.overview?.currentCoop ?? null)

  // Accueil du BookshelfDLE : le solde de Poussières d'un compte, ou l'identité d'un invité.
  useEffect(() => {
    if (useDleStore.getState().overview === null) void loadDle()
  }, [signedIn, loadDle])

  // Sans compte ni pseudo : un pseudo d'invité est attribué d'office (modifiable sur l'accueil).
  const asking = useRef(false)
  useEffect(() => {
    if (signedIn || guest || !dleOverview || asking.current) return
    asking.current = true
    ensureGuest('')
      .catch((error: unknown) => notify(apiErrorMessage(error, t), 'nope'))
      .finally(() => (asking.current = false))
  }, [signedIn, guest, dleOverview, ensureGuest, notify, t])

  useEffect(() => {
    if (ready) void loadOverview()
  }, [ready, signedIn, loadOverview])

  // COOP : une invitation reçue (`?hl=<code>`) est rejointe dès que le joueur est là ;
  // un salon en cours (rechargement de la page) est repris.
  const joining = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || coop) return
    const code = pendingCode ?? currentCoop
    if (!code || joining.current === code) return
    joining.current = code
    const store = useHlCoopStore.getState()
    const enter = pendingCode ? store.join(code) : store.resume(code)
    enter
      .catch((error: unknown) => {
        store.setPendingCode(null)
        if (pendingCode) notify(apiErrorMessage(error, t), 'nope')
      })
      .finally(() => (joining.current = null))
  }, [ready, coop, pendingCode, currentCoop, notify, t])

  const shown = coop && ready ? `coop:${coop.code}` : screen
  useGSAP(
    () => {
      gsap.fromTo(rootRef.current, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: EASE.glide })
    },
    { dependencies: [shown] },
  )

  return (
    <div ref={rootRef} key={shown} className="flex min-h-0 flex-1 flex-col">
      {coop && ready ? (
        <HlCoop room={coop} />
      ) : screen === 'play' ? (
        <HlGame />
      ) : screen === 'over' ? (
        <HlGameOver />
      ) : (
        <>
          <DleBar label={t.activities.back} onBack={() => openActivity('hub')}>
            {ready && <SoundToggle />}
            <StardustBadge balance={stardust} />
          </DleBar>
          {ready ? (
            <HlHome />
          ) : (
            <div className="grid flex-1 place-items-center pb-16">
              <Loader2 size={26} className="animate-spin text-glow" aria-hidden />
            </div>
          )}
        </>
      )}
    </div>
  )
}
