import { useEffect, useState } from 'react'
import { cardsApi, type DuplicatesView } from '../services/cardsApi'

/** Les doublons du compte, chargés à l'ouverture (`null` : en cours). */
export function useDuplicates(version = 0): [DuplicatesView | null, () => void] {
  const [view, setView] = useState<DuplicatesView | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    cardsApi
      .duplicates(controller.signal)
      .then(setView)
      .catch(() => {
        if (!controller.signal.aborted) setView({ values: { COMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0, MYTHIC: 0 }, items: [] })
      })
    return () => controller.abort()
  }, [version, reload])
  return [view, () => setReload((value) => value + 1)]
}
