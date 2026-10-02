import { useBoosters } from './useBoosters'
import { useUnreadTrades } from './useNotifications'
import { useOracleStatus } from './useOracleStatus'

/**
 * État de l'onglet « Activités » pour la navigation : quelque chose attend-il
 * (tirage du jour, booster prêt, booster d'essai pour un invité, nouvelle du Marché), et quelle série de
 * l'Oracle afficher.
 */
export function useActivitiesStatus(): { attention: boolean; streak: number; trades: number } {
  const oracle = useOracleStatus()
  // Pas de décompte à la seconde : la navigation n'affiche que « un booster attend ».
  const boosters = useBoosters({ tick: false })
  const trades = useUnreadTrades()
  return {
    attention: oracle.available || boosters.available > 0 || trades > 0,
    streak: oracle.streak,
    trades,
  }
}
