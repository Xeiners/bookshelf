import { chapterNumber } from './progress'
import type { ReaderChapter } from '../../types/reader'

/**
 * Les `count` prochains chapitres à lire (au-delà de `chaptersRead`), dans l'ordre de
 * lecture, sans ceux déjà téléchargés ou en route. Un chapitre sans numéro (one-shot)
 * n'est jamais compté comme lu.
 */
export function nextUnread(
  order: readonly ReaderChapter[],
  chaptersRead: number,
  taken: (chapterId: string) => boolean,
  count: number,
): ReaderChapter[] {
  return order
    .filter((chapter) => {
      const number = chapterNumber(chapter.number)
      return number === null || number > chaptersRead
    })
    .filter((chapter) => !taken(chapter.id))
    .slice(0, count)
}
