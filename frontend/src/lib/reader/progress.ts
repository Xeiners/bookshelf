/**
 * Calculs de progression du lecteur — fonctions pures, testées
 * (`frontend/test/progress.test.ts`).
 */
import type { PublicationStatus } from '../../types/book'
import type { ReaderChapter, ReadingPosition } from '../../types/reader'

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/** « 12.5 » → 12.5 ; one-shot ou numéro exotique → `null`. */
export function chapterNumber(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** À partir de ce seuil, un chapitre compte comme terminé (la dernière page n'a pas à être défilée au pixel). */
export const COMPLETION_THRESHOLD = 0.98

/**
 * Compteur de chapitres lus après avoir fini un chapitre. Il ne recule jamais :
 * relire le chapitre 3 quand on en est au 40 ne change rien. Un chapitre 12.5
 * (bonus) compte pour 12 ; un one-shot compte selon sa place dans la liste.
 */
export function chaptersReadAfter(previous: number, finished: { number: string | null; orderIndex: number }): number {
  const numeric = chapterNumber(finished.number)
  const reached = numeric !== null ? Math.floor(numeric) : finished.orderIndex + 1
  return Math.max(previous, reached)
}

/**
 * Avancement global de l'œuvre (0 → 1), ou `null` si le nombre de chapitres est
 * inconnu. Une série en cours plafonne à 99 % : avoir rattrapé la parution
 * ne veut pas dire l'avoir terminée (100 % la classerait en « Lus »).
 */
export function overallProgress(
  chaptersRead: number,
  totalChapters: number | null | undefined,
  status: PublicationStatus | null | undefined,
): number | null {
  if (!totalChapters || totalChapters <= 0) return null
  const ratio = clamp01(chaptersRead / totalChapters)
  return status === 'completed' ? ratio : Math.min(ratio, 0.99)
}

/** Avancement dans un chapitre paginé : la page affichée (ou la dernière d'une double page) est lue. */
export function pagedRatio(lastVisiblePage: number, pageCount: number): number {
  if (pageCount <= 0) return 0
  return clamp01((lastVisiblePage + 1) / pageCount)
}

/** Avancement dans un chapitre en défilement vertical. Un chapitre plus court que l'écran est lu d'emblée. */
export function scrollRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const range = scrollHeight - clientHeight
  if (range <= 0) return 1
  return clamp01(scrollTop / range)
}

/**
 * Page en haut de l'écran et part déjà défilée de cette page, d'après les
 * positions (`offsetTop`, triées) et hauteurs des pages. Sert au mode webtoon :
 * la reprise tombe au même endroit quelle que soit la hauteur de l'écran.
 */
export function pageAtScroll(scrollTop: number, tops: readonly number[], heights: readonly number[]): { page: number; offset: number } {
  if (tops.length === 0) return { page: 0, offset: 0 }
  let low = 0
  let high = tops.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((tops[middle] ?? 0) <= scrollTop) low = middle
    else high = middle - 1
  }
  const height = heights[low] ?? 0
  const offset = height > 0 ? clamp01((scrollTop - (tops[low] ?? 0)) / height) : 0
  return { page: low, offset }
}

/**
 * Chapitre à ouvrir : celui de la dernière position s'il existe encore (le
 * suivant s'il était terminé), sinon le premier après le compteur de chapitres
 * lus, sinon le tout premier.
 */
export function initialChapterId(
  order: readonly ReaderChapter[],
  position: ReadingPosition | null | undefined,
  chaptersRead: number,
): string | null {
  if (order.length === 0) return null
  if (position) {
    const index = order.findIndex((chapter) => chapter.id === position.chapterId || (position.chapter !== null && chapter.number === position.chapter))
    if (index !== -1) {
      const finished = position.ratio >= COMPLETION_THRESHOLD
      return (finished ? order[index + 1] : undefined)?.id ?? order[index]?.id ?? null
    }
  }
  if (chaptersRead > 0) {
    const next = order.find((chapter) => (chapterNumber(chapter.number) ?? 0) > chaptersRead)
    if (next) return next.id
  }
  return order[0]?.id ?? null
}

/** Mots d'un texte (lettres et chiffres, ponctuation exclue). */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0
}

/** Vitesse de lecture moyenne d'un roman, en mots par minute. */
export const WORDS_PER_MINUTE = 230

/**
 * Minutes restantes dans un chapitre de texte : mots du chapitre × part non
 * encore lue. `page` est 1-based (page affichée sur `totalPages`).
 */
export function remainingMinutes(words: number, page: number, totalPages: number, wpm = WORDS_PER_MINUTE): number {
  if (words <= 0 || totalPages <= 0) return 0
  const left = clamp01(1 - (page - 1) / totalPages)
  return Math.ceil((words * left) / wpm)
}
