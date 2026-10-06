import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChapterLanguage, ChapterSource, ReaderPage } from '../types/reader'

/*
 * Registre des chapitres téléchargés pour la lecture hors-ligne (propre à l'appareil).
 * Les images, elles, vivent dans le cache `bookshelf-downloads-v1` (cf. `lib/reader/downloads.ts`) ;
 * ce registre dit ce qu'il contient, chapitre par chapitre, et où en est chaque téléchargement.
 */

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'error'
/** `network` : coupure (reprise possible) ; `quota` : stockage plein ; `unavailable` : chapitre introuvable. */
export type DownloadError = 'network' | 'quota' | 'unavailable'

export interface DownloadedChapter {
  chapterId: string
  manga: { id: string; title: string; cover: string | null }
  number: string | null
  title: string | null
  language: ChapterLanguage
  /** Le même chapitre chez d'autres sources (repli si la sienne ne répond pas). */
  alternates: string[]
  status: DownloadStatus
  error?: DownloadError
  /** Manifeste : les pages dans l'ordre (adresses WebP), connu dès le début du téléchargement. */
  pages: ReaderPage[]
  servedBy: string | null
  source: ChapterSource | null
  /** Pages déjà dans le cache, et leur poids. */
  done: number
  bytes: number
  queuedAt: number
  downloadedAt: number | null
}

interface DownloadState {
  chapters: Record<string, DownloadedChapter>
  put: (chapter: DownloadedChapter) => void
  patch: (chapterId: string, change: Partial<DownloadedChapter>) => void
  forget: (chapterId: string) => void
  forgetAll: () => void
}

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set) => ({
      chapters: {},
      put: (chapter) => set((state) => ({ chapters: { ...state.chapters, [chapter.chapterId]: chapter } })),
      patch: (chapterId, change) =>
        set((state) => {
          const current = state.chapters[chapterId]
          return current ? { chapters: { ...state.chapters, [chapterId]: { ...current, ...change } } } : state
        }),
      forget: (chapterId) =>
        set((state) => {
          if (!state.chapters[chapterId]) return state
          const chapters = { ...state.chapters }
          delete chapters[chapterId]
          return { chapters }
        }),
      forgetAll: () => set({ chapters: {} }),
    }),
    { name: 'bookshelf:downloads:v1', version: 1, partialize: (state) => ({ chapters: state.chapters }) },
  ),
)

/** Chapitre lisible hors-ligne (téléchargement terminé). */
export const isDownloaded = (chapter: DownloadedChapter | undefined): chapter is DownloadedChapter => chapter?.status === 'done'
