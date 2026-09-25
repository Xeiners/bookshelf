import { liveStreak, localDay } from '../lib/oracle'
import { useOracleStore } from '../store/useOracleStore'

/**
 * État de l'Oracle pour la navigation : le tirage du jour attend-il, et quelle
 * série afficher. Le jour est relu à chaque rendu (la navigation re-rend à
 * chaque changement de vue : pas besoin d'horloge dédiée).
 */
export function useOracleStatus(): { available: boolean; streak: number } {
  const lastDay = useOracleStore((state) => state.lastDay)
  const streak = useOracleStore((state) => state.streak)
  const best = useOracleStore((state) => state.best)
  const today = localDay()
  return {
    available: lastDay !== today,
    streak: liveStreak({ lastDay, streak, best }, today),
  }
}
