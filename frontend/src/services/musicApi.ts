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

/** Playlist YouTube à importer (`GET /api/music/playlist/:id`). */
export interface ImportedPlaylist {
  id: string
  title: string
  channel: string | null
  videos: { id: string; title: string; channel: string | null; duration: string | null }[]
  /** Plus de vidéos que la limite d'une playlist : seules les premières sont là. */
  truncated: boolean
}

export const musicApi = {
  /** 404 : playlist introuvable ou privée ; 400 : mix automatique (non importable). */
  playlist: (id: string, lang: Language, signal?: AbortSignal) =>
    api<ImportedPlaylist>(`/music/playlist/${encodeURIComponent(id)}?lang=${lang}`, { signal }),

  search: (query: string, type: MusicSearchType, lang: Language, signal?: AbortSignal) =>
    api<{ results: MusicSearchResult[] }>(
      `/music/search?${new URLSearchParams({ q: query, type, lang }).toString()}`,
      { signal },
    ).then((response) => response.results),
}
