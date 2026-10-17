/**
 * Préchargement des romans du compte : un EPUB n'est lisible hors-ligne que s'il est
 * déjà sur l'appareil. Plutôt que d'attendre une première ouverture en ligne, ceux qui
 * manquent sont téléchargés en arrière-plan, les plus récemment lus d'abord, dans la
 * limite d'un budget d'octets (un roman pèse quelques Mo, une bibliothèque entière non).
 */
import type { CachedCloudBook } from './cloudBooks'

/** Octets téléchargés au plus par passe : au-delà, la suite attend la prochaine ouverture de l'app. */
export const PREFETCH_BUDGET_BYTES = 250 * 1024 * 1024
/** Un seul fichier plus lourd que ça n'est pas préchargé (il se télécharge à la demande). */
export const PREFETCH_MAX_FILE_BYTES = 120 * 1024 * 1024

const activityOf = (entry: CachedCloudBook) =>
  Math.max(entry.position?.at ?? 0, entry.book.progressAt ?? 0, Date.parse(entry.book.updatedAt) || 0)

/** Livres à télécharger, dans l'ordre : lectures en cours et récentes d'abord, livres terminés en dernier. */
export function planNovelDownloads(
  entries: readonly CachedCloudBook[],
  present: ReadonlySet<string>,
  budget = PREFETCH_BUDGET_BYTES,
): CachedCloudBook[] {
  const missing = entries
    .filter((entry) => !present.has(entry.id) && entry.book.fileSize > 0 && entry.book.fileSize <= PREFETCH_MAX_FILE_BYTES)
    .sort((a, b) => {
      const done = Number(Math.max(a.position?.percent ?? 0, a.book.progressPercent) >= 99) - Number(Math.max(b.position?.percent ?? 0, b.book.progressPercent) >= 99)
      return done || activityOf(b) - activityOf(a)
    })
  const plan: CachedCloudBook[] = []
  let used = 0
  for (const entry of missing) {
    if (used + entry.book.fileSize > budget) continue
    used += entry.book.fileSize
    plan.push(entry)
  }
  return plan
}
