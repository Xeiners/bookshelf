import type { ReadingStatus } from '../types/book'
import type { ChapterLanguage, ChapterList, ReaderPage, ReadingPosition } from '../types/reader'
import { api } from './api'

interface PagesResponse {
  chapterId: string
  quality: 'data' | 'data-saver'
  pages: ReaderPage[]
}

/**
 * Pages déjà résolues, par chapitre et qualité : revenir sur un chapitre (ou
 * ouvrir celui qu'on a préchargé) ne coûte aucun appel. Les URL pointent vers
 * notre relais, stables : les garder toute la session est sans risque.
 */
const pagesCache = new Map<string, Promise<ReaderPage[]>>()

export const readerApi = {
  chapters: (mangaId: string, lang: ChapterLanguage, signal?: AbortSignal) =>
    api<ChapterList>(`/manga/${encodeURIComponent(mangaId)}/chapters?lang=${lang}`, { signal }),

  pages(chapterId: string, quality: 'data' | 'data-saver'): Promise<ReaderPage[]> {
    const key = `${chapterId}:${quality}`
    let pending = pagesCache.get(key)
    if (!pending) {
      pending = api<PagesResponse>(`/chapters/${encodeURIComponent(chapterId)}/pages?quality=${quality}`).then(
        (response) => response.pages,
      )
      // Un échec ne reste pas en cache : « Réessayer » doit vraiment réessayer.
      pending.catch(() => pagesCache.delete(key))
      pagesCache.set(key, pending)
    }
    return pending
  },

  progress: (input: {
    workId: string
    position: ReadingPosition
    chaptersRead?: number
    progress?: number
    status?: ReadingStatus
    at: number
  }) => api<unknown>('/library/progress', { method: 'PATCH', body: input }),
}
