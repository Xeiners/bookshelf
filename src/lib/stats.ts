import type { LibraryEntry, ReadingStatus } from '../types/book'
import { readingMinutes } from './format'

export interface GenreCount {
  label: string
  count: number
}

export interface LibraryStats {
  total: number
  byStatus: Record<ReadingStatus, number>
  /** Pages terminées : 100 % des livres lus + progression des lectures en cours. */
  pagesRead: number
  minutesRead: number
  averageRating: number | null
  topGenres: GenreCount[]
  /** Le plus gros pavé terminé — donnée « trophée » du profil. */
  longestTitle: string | null
}

const EMPTY_BY_STATUS: Record<ReadingStatus, number> = { read: 0, reading: 0, wishlist: 0 }

export function computeStats(entries: Record<string, LibraryEntry>): LibraryStats {
  const list = Object.values(entries)
  const byStatus = { ...EMPTY_BY_STATUS }

  let pagesRead = 0
  let minutesRead = 0
  let ratingSum = 0
  let ratingCount = 0
  let longestPages = 0
  let longestTitle: string | null = null

  const genres = new Map<string, number>()

  for (const entry of list) {
    byStatus[entry.status] += 1

    const pages = entry.book.pages ?? 0
    const ratio = entry.status === 'read' ? 1 : entry.status === 'reading' ? entry.progress : 0
    const done = Math.round(pages * ratio)

    pagesRead += done
    minutesRead += readingMinutes(done) ?? 0

    if (entry.status === 'read' && pages > longestPages) {
      longestPages = pages
      longestTitle = entry.book.title
    }

    if (entry.book.rating !== null) {
      ratingSum += entry.book.rating
      ratingCount += 1
    }

    // Les genres ne comptent que pour les livres engagés (lus ou en cours).
    if (entry.status !== 'wishlist') {
      for (const category of entry.book.categories.slice(0, 2)) {
        genres.set(category, (genres.get(category) ?? 0) + 1)
      }
    }
  }

  const topGenres = [...genres.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 4)

  return {
    total: list.length,
    byStatus,
    pagesRead,
    minutesRead,
    averageRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
    topGenres,
    longestTitle,
  }
}
