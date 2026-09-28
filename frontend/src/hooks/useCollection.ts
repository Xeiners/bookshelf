import { useEffect } from 'react'
import { useAuthStore } from '../store/useAuthStore'
import { useBoosterStore } from '../store/useBoosterStore'
import { useCollectionStore } from '../store/useCollectionStore'
import { useGuestCardsStore } from '../store/useGuestCardsStore'

/**
 * Album du compte connecté — ou, en invité, celui de ses boosters d'essai —
 * chargé au besoin et rechargé après chaque booster ouvert.
 */
export function useCollection() {
  const signedIn = useAuthStore((state) => state.user !== null)
  const receipts = useGuestCardsStore((state) => state.receipts)
  const version = useBoosterStore((state) => state.collectionVersion)
  const data = useCollectionStore((state) => state.data)
  const status = useCollectionStore((state) => state.status)
  const loadedVersion = useCollectionStore((state) => state.loadedVersion)
  const load = useCollectionStore((state) => state.load)
  const source = signedIn ? null : receipts

  useEffect(() => {
    if (loadedVersion !== version) void load(version, source)
  }, [version, loadedVersion, load, source])

  return { signedIn, data, status, retry: () => void load(version, source) }
}
