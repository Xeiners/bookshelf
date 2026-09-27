import { fetchChapterFeed } from '../../modules/chapters/chapters.client.js'
import { normalizeChapter } from '../../modules/chapters/chapters.normalize.js'
import { listPages } from '../../modules/chapters/mangadex.pages.js'
import { MANGADEX_API } from '../../modules/manga/mangadex.client.js'
import { READABLE_LANGUAGES } from '../../modules/manga/normalize.js'
import { MANGADEX_SOURCE_ID } from '../chapterKey.js'
import type { SourceProvider } from '../types.js'

/**
 * MangaDex (API REST officielle) : la source de référence, en tête de
 * priorité (équipes créditées, métadonnées complètes, pages hébergées).
 * Ses pages passent par son relais dédié (`/api/chapters/:id/image/…`), qui
 * gère les nœuds MD@Home et le rapport exigé par MangaDex.
 */
export const mangadexProvider: SourceProvider = {
  id: MANGADEX_SOURCE_ID,
  name: 'MangaDex',
  baseUrl: MANGADEX_API,
  supportedLanguages: READABLE_LANGUAGES,
  priority: 100,
  // Jusqu'à 10 pages de flux, espacées par le limiteur de débit MangaDex.
  timeoutMs: 30_000,
  selfRelayed: true,

  async fetchChapterList(mangaId) {
    return (await fetchChapterFeed(mangaId, READABLE_LANGUAGES)).map(normalizeChapter)
  },

  fetchPageUrls(chapterId, { quality }) {
    return listPages(chapterId, quality)
  },
}
