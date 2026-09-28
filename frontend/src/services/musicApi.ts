import type { Language } from '../i18n'
import { api } from './api'

export type MusicSearchType = 'video' | 'playlist'

/** Résultat de `GET /api/music/search` (cf. `backend/src/modules/music/youtubeSearch.ts`). */
export interface MusicSearchResult {
  kind: MusicSearchType
  /** Identifiant YouTube (vidéo ou `list=`). */
  id: string
  title: string
  channel: string | null
  duration: string | null
  live: boolean
  /** « 30 vidéos », tel que YouTube l'affiche. */
  videoCount: string | null
  thumbnail: string | null
}

export const musicApi = {
  search: (query: string, type: MusicSearchType, lang: Language, signal?: AbortSignal) =>
    api<{ results: MusicSearchResult[] }>(
      `/music/search?${new URLSearchParams({ q: query, type, lang }).toString()}`,
      { signal },
    ).then((response) => response.results),
}
