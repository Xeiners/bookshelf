import type { ReadingStatus } from '../types/book'
import type { ChapterLanguage, ChapterList, ChapterPages, ChapterSource, OfficialPlatform, ReaderPage, ReadingPosition } from '../types/reader'
import { downloadedChapterList, downloadedPages } from '../lib/reader/downloads'
import { api, isNetworkError } from './api'

interface PagesResponse {
  chapterId: string
  /** Absents des copies hors-ligne d'avant les sources multiples. */
  servedBy?: string
  source?: ChapterSource
  fallback?: boolean
  quality: 'data' | 'data-saver'
  pages: ReaderPage[]
}

/**
 * Pages déjà résolues, par chapitre et qualité : revenir sur un chapitre (ou
 * ouvrir celui qu'on a préchargé) ne coûte aucun appel. Les URL pointent vers
 * notre relais, stables : les garder toute la session est sans risque.
 */
const pagesCache = new Map<string, Promise<ChapterPages>>()

/** Plateformes officielles déjà demandées, par œuvre et langue : rouvrir une fiche ne coûte rien. */
const platformsCache = new Map<string, Promise<OfficialPlatform[]>>()

export const readerApi = {
  chapters: (mangaId: string, lang: ChapterLanguage, signal?: AbortSignal) =>
    api<ChapterList>(`/manga/${encodeURIComponent(mangaId)}/chapters?lang=${lang}`, { signal }).catch((error: unknown) => {
      // Hors-ligne, sans copie de la liste : les chapitres téléchargés suffisent à lire.
      const local = isNetworkError(error) ? downloadedChapterList(mangaId, lang) : null
      if (local) return local
      throw error
    }),

  /**
   * `alternates` : le même chapitre chez d'autres sources, que l'API essaie si
   * celle-ci ne répond pas. Ils ne font pas partie de la clé de cache : c'est
   * le même chapitre, quelle que soit la liste de replis.
   */
  pages(chapterId: string, quality: 'data' | 'data-saver', alternates: readonly string[] = []): Promise<ChapterPages> {
    // Chapitre téléchargé : ses pages sont sur l'appareil, aucun appel (même en ligne).
    const local = downloadedPages(chapterId)
    if (local) return Promise.resolve(local)
    const key = `${chapterId}:${quality}`
    let pending = pagesCache.get(key)
    if (!pending) {
      const alt = alternates.length > 0 ? `&alt=${alternates.map(encodeURIComponent).join(',')}` : ''
      pending = api<PagesResponse>(`/chapters/${encodeURIComponent(chapterId)}/pages?quality=${quality}${alt}`).then(
        (response) => ({
          pages: response.pages,
          servedBy: response.servedBy ?? chapterId,
          source: response.source ?? null,
          fallback: response.fallback ?? false,
        }),
      )
      // Un échec ne reste pas en cache : « Réessayer » doit vraiment réessayer.
      // Un repli non plus : la source demandée doit pouvoir reprendre la main.
      pending.then(
        (result) => {
          if (result.fallback) pagesCache.delete(key)
        },
        () => pagesCache.delete(key),
      )
      pagesCache.set(key, pending)
    }
    return pending
  },

  /** Où lire l'œuvre officiellement (UUID MangaDex ou `al-<id>`). */
  platforms(workId: string, lang: ChapterLanguage): Promise<OfficialPlatform[]> {
    const key = `${workId}:${lang}`
    let pending = platformsCache.get(key)
    if (!pending) {
      pending = api<{ platforms: OfficialPlatform[] }>(`/manga/${encodeURIComponent(workId)}/platforms?lang=${lang}`).then(
        (response) => response.platforms,
      )
      pending.catch(() => platformsCache.delete(key))
      platformsCache.set(key, pending)
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
