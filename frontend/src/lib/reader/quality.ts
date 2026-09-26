import type { ImageQuality } from '../../types/reader'

/** Sous-ensemble de la Network Information API (absente de Safari et Firefox). */
interface NetworkInformation {
  saveData?: boolean
  effectiveType?: string
}

const SLOW_CONNECTIONS = new Set(['slow-2g', '2g', '3g'])

/** L'appareil signale-t-il une connexion lente ou le mode économie de données ? */
export function isConstrainedNetwork(): boolean {
  if (typeof navigator === 'undefined') return false
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection
  return Boolean(connection?.saveData || (connection?.effectiveType && SLOW_CONNECTIONS.has(connection.effectiveType)))
}

/** Qualité MangaDex effective : `auto` passe en « Data Saver » sur une connexion lente. */
export function resolveQuality(preference: ImageQuality): 'data' | 'data-saver' {
  if (preference !== 'auto') return preference
  return isConstrainedNetwork() ? 'data-saver' : 'data'
}
