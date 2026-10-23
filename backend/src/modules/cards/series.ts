import { prisma } from '../../core/db.js'
import { SERIES_3, SERIES_3_SIZE } from './seeds/series3.seed.js'

/**
 * Séries retirées : la 1 et la 2. Dès que la Série 3 est complète, elle est la seule à se tirer,
 * à se collectionner et à s'échanger ; les cartes des séries retirées sont converties en Poussières
 * (cf. `retirement/`). Les lignes `Card` de ces séries restent en base : le BookshelfDLE s'appuie
 * sur leurs œuvres, et l'historique du Marché les cite.
 */
export const RETIRED_SERIES: readonly number[] = [1, 2]

/** La Série 3 ne se retire jamais d'elle-même : une fois complète, le retrait est acquis. */
let retired = false

/** Les séries 1 et 2 sont-elles retirées ? (La Série 3 est complète.) */
export async function seriesRetired(): Promise<boolean> {
  if (retired) return true
  retired = (await prisma.card.count({ where: { series: SERIES_3 } })) >= SERIES_3_SIZE
  return retired
}

/** Filtre Prisma des cartes en jeu : toutes tant que la Série 3 n'est pas prête, sinon la Série 3. */
export async function liveCardFilter(): Promise<{ series?: { notIn: number[] } }> {
  return (await seriesRetired()) ? { series: { notIn: [...RETIRED_SERIES] } } : {}
}

/** Pour les tests : relit l'état au prochain appel. */
export function resetSeriesRetirement(): void {
  retired = false
}
