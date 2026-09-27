import { useEffect, useState } from 'react'
import { useLanguage } from '../i18n'
import { readerApi } from '../services/readerApi'
import type { OfficialPlatform } from '../types/reader'

const EMPTY: OfficialPlatform[] = []

/**
 * Plateformes de lecture officielles d'une œuvre, dans la langue de
 * l'interface. `null` : rien à demander (livre hors catalogue). Une erreur
 * réseau laisse simplement la liste vide : la section ne s'affiche pas.
 */
export function useOfficialPlatforms(workId: string | null): OfficialPlatform[] {
  const language = useLanguage()
  const key = workId ? `${workId}:${language}` : null
  const [loaded, setLoaded] = useState<{ key: string | null; platforms: OfficialPlatform[] }>({ key: null, platforms: EMPTY })

  useEffect(() => {
    if (!workId || !key) return
    let cancelled = false
    readerApi
      .platforms(workId, language)
      .then((platforms) => {
        if (!cancelled) setLoaded({ key, platforms })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workId, key, language])

  // Autre œuvre ou autre langue : l'ancienne liste ne vaut plus (état dérivé d'une prop, cf. HANDOFF §5.9).
  return loaded.key === key ? loaded.platforms : EMPTY
}
