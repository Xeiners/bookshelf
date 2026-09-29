import { useEffect } from 'react'
import { useAuthStore } from '../store/useAuthStore'
import { useBoosterStore } from '../store/useBoosterStore'
import { useCollectionStore } from '../store/useCollectionStore'
import { useGuestCardsStore } from '../store/useGuestCardsStore'

/**
 * Album du compte connecté — ou, en invité, celui de ses boosters d'essai —
 * chargé au besoin et rechargé après chaque booster ouvert. `enabled: false` :
 * l'album déjà en mémoire, sans le demander (il pèse tout le set de cartes).
 */
export function useCollection({ enabled = true }: { enabled?: boolean } = {}) {
  const signedIn = useAuthStore((state) => state.user !== null)
  const receipts = useGuestCardsStore((state) => state.receipts)
  const version = useBoosterStore((state) => state.collectionVersion)
  const data = useCollectionStore((state) => state.data)
  const status = useCollectionStore((state) => state.status)
  const loadedVersion = useCollectionStore((state) => state.loadedVersion)
  const load = useCollectionStore((state) => state.load)
  const source = signedIn ? null : receipts

  useEffect(() => {
    if (enabled && loadedVersion !== version) void load(version, source)
  }, [enabled, version, loadedVersion, load, source])

  return { signedIn, data, status, retry: () => void load(version, source) }
}
