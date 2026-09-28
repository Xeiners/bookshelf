import { useBoosters } from './useBoosters'
import { useOracleStatus } from './useOracleStatus'

/**
 * État de l'onglet « Activités » pour la navigation : quelque chose attend-il
 * (tirage du jour, booster prêt, ou booster d'essai pour un invité), et quelle série de l'Oracle afficher.
 */
export function useActivitiesStatus(): { attention: boolean; streak: number } {
  const oracle = useOracleStatus()
  // Pas de décompte à la seconde : la navigation n'affiche que « un booster attend ».
  const boosters = useBoosters({ tick: false })
  return {
    attention: oracle.available || boosters.available > 0,
    streak: oracle.streak,
  }
}
