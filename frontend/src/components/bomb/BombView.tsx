import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { useAuthStore } from '../../store/useAuthStore'
import { useBombStore } from '../../store/useBombStore'
import { useDleStore } from '../../store/useDleStore'
import { useStardustBalance } from '../../store/useHigherLowerStore'
import { useUiStore } from '../../store/useUiStore'
import { DleBar } from '../dle/DleBar'
import { StardustBadge } from '../dle/StardustBadge'
import { SoundToggle } from '../higherlower/SoundToggle'
import { BombHome } from './BombHome'
import { RoomScreen } from './RoomScreen'
import { SoloGame } from './SoloGame'

/**
 * Anime Bomb Party : accueil, partie solo ou salon. Sans compte, un pseudo d'invité est
 * attribué d'office (le même que celui du BookshelfDLE) ; ses Poussières lui reviennent
 * en reçus que l'inscription ajoute au compte.
 */
export function BombView() {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const screen = useBombStore((state) => state.screen)
  const solo = useBombStore((state) => state.solo)
  const room = useBombStore((state) => state.room)
  const overview = useBombStore((state) => state.overview)
  const pendingCode = useBombStore((state) => state.pendingCode)
  const openActivity = useUiStore((state) => state.openActivity)
  const notify = useUiStore((state) => state.notify)
  const stardust = useStardustBalance()
  const user = useAuthStore((state) => state.user)
  const dleOverview = useDleStore((state) => state.overview)
  const loadDle = useDleStore((state) => state.loadOverview)
  const ensureGuest = useDleStore((state) => state.ensureGuest)
  const guest = dleOverview?.guest ?? null
  const ready = user !== null || guest !== null
  /** Qui je suis dans un salon : le compte, ou l'invité. */
  const me = user?.id ?? guest?.id ?? ''

  useEffect(() => {
    if (useDleStore.getState().overview === null) void loadDle()
  }, [user, loadDle])

  const asking = useRef(false)
  useEffect(() => {
    if (user || guest || !dleOverview || asking.current) return
    asking.current = true
    ensureGuest('')
      .catch((error: unknown) => notify(apiErrorMessage(error, t), 'nope'))
      .finally(() => (asking.current = false))
  }, [user, guest, dleOverview, ensureGuest, notify, t])

  useEffect(() => {
    if (ready) void useBombStore.getState().loadOverview().catch(() => undefined)
  }, [ready, user])

  // Invitation (`?bomb=<code>`) ou salon en cours (page rechargée) : on y retourne.
  const joining = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || room) return
    const code = pendingCode ?? overview?.currentRoom ?? null
    if (!code || joining.current === code) return
    joining.current = code
    useBombStore
      .getState()
      .joinRoom(code)
      .catch((error: unknown) => {
        useBombStore.getState().setPendingCode(null)
        if (pendingCode) notify(apiErrorMessage(error, t), 'nope')
      })
      .finally(() => (joining.current = null))
  }, [ready, room, pendingCode, overview, notify, t])

  const shown = screen === 'room' && room ? `room:${room.code}` : screen === 'solo' && solo ? `solo:${solo.id}` : 'home'
  useGSAP(
    () => {
      gsap.fromTo(rootRef.current, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: EASE.glide })
    },
    { dependencies: [shown] },
  )

  return (
    <div ref={rootRef} key={shown} className="flex min-h-0 flex-1 flex-col">
      {screen === 'room' && room && me ? (
        <RoomScreen room={room} me={me} />
      ) : screen === 'solo' && solo ? (
        <SoloGame solo={solo} />
      ) : (
        <>
          <DleBar label={t.activities.back} onBack={() => openActivity('hub')}>
            {ready && <SoundToggle />}
            <StardustBadge balance={stardust} />
          </DleBar>
          {ready ? (
            <BombHome />
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
