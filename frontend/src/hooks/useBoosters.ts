import { useEffect, useState } from 'react'
import { GUEST_BOOSTERS, refillProgress, remainingSeconds } from '../lib/boosters'
import { useAuthStore } from '../store/useAuthStore'
import { useBoosterStore } from '../store/useBoosterStore'
import { useGuestCardsStore } from '../store/useGuestCardsStore'

export interface BoosterView {
  /** Sans compte : `available` compte les boosters d'essai restants (ni minuteur, ni recharge). */
  signedIn: boolean
  /** Stock connu (réponse du serveur reçue au moins une fois). */
  ready: boolean
  available: number
  max: number
  /** Secondes avant le prochain booster, décomptées localement ; `null` : stock plein. */
  remaining: number | null
  /** Avancement du minuteur, 0 → 1. */
  progress: number
  offline: boolean
  /** Mode recette : jamais à court de boosters. */
  unlimited: boolean
  /** Un booster peut être ouvert maintenant (stock, ou recette). */
  canOpen: boolean
}

/**
 * Stock de boosters pour l'affichage : synchronisé avec le serveur au montage,
 * au retour au premier plan et à l'échéance du minuteur ; décompté entre-temps
 * sur l'horloge monotone du navigateur (cf. `lib/boosters.ts`). Invité : les
 * boosters d'essai restants, comptés sur l'appareil (le serveur a le dernier mot).
 */
export function useBoosters(options: { tick?: boolean } = {}): BoosterView {
  const tick = options.tick ?? true
  const signedIn = useAuthStore((state) => state.user !== null)
  const status = useBoosterStore((state) => state.status)
  const syncedAt = useBoosterStore((state) => state.syncedAt)
  const offline = useBoosterStore((state) => state.offline)
  const refresh = useBoosterStore((state) => state.refresh)
  const guestOpened = useGuestCardsStore((state) => state.receipts.length)
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (!signedIn) return
    void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [signedIn, refresh])

  const counting = tick && status?.secondsUntilNext !== null && status !== null
  useEffect(() => {
    if (!counting) return
    const timer = window.setInterval(() => setNow(performance.now()), 1000)
    return () => window.clearInterval(timer)
  }, [counting])

  const remaining = status ? remainingSeconds(status.secondsUntilNext, syncedAt, now) : null

  // Échéance atteinte : le serveur confirme l'arrivée du booster (lui seul décide).
  useEffect(() => {
    if (tick && signedIn && remaining === 0) void refresh()
  }, [tick, signedIn, remaining, refresh])

  if (!signedIn) {
    const left = Math.max(0, GUEST_BOOSTERS - guestOpened)
    return {
      signedIn,
      ready: true,
      available: left,
      max: GUEST_BOOSTERS,
      remaining: null,
      progress: left > 0 ? 1 : 0,
      offline: false,
      unlimited: false,
      canOpen: left > 0,
    }
  }

  return {
    signedIn,
    ready: status !== null,
    available: status?.available ?? 0,
    max: status?.max ?? 2,
    remaining,
    progress: refillProgress(remaining, status?.intervalSeconds ?? 0),
    offline,
    unlimited: status?.unlimited === true,
    canOpen: signedIn && status !== null && !offline && (status.unlimited === true || status.available > 0),
  }
}
