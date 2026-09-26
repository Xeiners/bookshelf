import { useCallback, useEffect, useRef } from 'react'
import { savePosition, type LocalPosition } from '../../lib/reader/localFiles'

const SAVE_DELAY_MS = 800

/**
 * Position d'un fichier importé, écrite dans IndexedDB une fois la page posée,
 * et tout de suite quand on quitte le lecteur ou que l'application passe en
 * arrière-plan (un téléphone peut la fermer sans prévenir).
 */
export function useLocalPosition(fileId: string): (position: Omit<LocalPosition, 'at'>) => void {
  const pending = useRef<LocalPosition | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const flush = () => {
      window.clearTimeout(timer.current)
      if (pending.current) void savePosition(fileId, pending.current).catch(() => {})
      pending.current = null
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [fileId])

  // Stable : les vues l'utilisent dans leurs abonnements au défilement.
  return useCallback(
    (position: Omit<LocalPosition, 'at'>) => {
      pending.current = { ...position, at: Date.now() }
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        if (pending.current) void savePosition(fileId, pending.current).catch(() => {})
        pending.current = null
      }, SAVE_DELAY_MS)
    },
    [fileId],
  )
}
