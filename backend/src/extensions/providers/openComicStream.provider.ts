import { z } from 'zod'
import { LANGUAGES, type Language } from '../../lib/language.js'
import type { NormalizedChapter, SourceProvider } from '../types.js'
import { getJson, provenanceHeaders, providerLogger, type ProviderLog } from './http.js'

/**
 * Connecteur générique pour une API JSON/REST au contrat « OpenComicStream »
 * (documenté dans docs/BACKEND.md) : un serveur perso, une bibliothèque
 * auto-hébergée ou une passerelle maison n'a qu'à exposer deux routes.
 *
 *   GET {base}/chapters?mangadexId=<uuid>&title=<titre>&title=…
 *     → { chapters: [{ id, number?, volume?, title?, language, pages?, groups?, publishedAt? }] }
 *   GET {base}/chapters/{id}/pages
 *     → { headers?: {…}, pages: [url | { url, headers? }] }
 */

const Scalar = z.union([z.string(), z.number()]).transform(String)

export const OpenComicChapterSchema = z.object({
  id: Scalar,
  number: Scalar.nullish(),
  volume: Scalar.nullish(),
  title: z.string().nullish(),
  language: z.string(),
  pages: z.number().int().nonnegative().nullish(),
  groups: z.array(z.union([z.string(), z.object({ id: Scalar.optional(), name: z.string() })])).nullish(),
  publishedAt: z.string().nullish(),
})

const ChaptersSchema = z.object({ chapters: z.array(OpenComicChapterSchema) })

const HeadersSchema = z.record(z.string(), z.string())

const PagesSchema = z.object({
  headers: HeadersSchema.nullish(),
  pages: z.array(z.union([z.string(), z.object({ url: z.string(), headers: HeadersSchema.nullish() })])),
})

const EPOCH = new Date(0).toISOString()

export function normalizeOpenComicChapter(chapter: z.infer<typeof OpenComicChapterSchema>): NormalizedChapter | null {
  const language = chapter.language.toLowerCase().slice(0, 2)
  if (!LANGUAGES.includes(language as Language)) return null
  return {
    id: chapter.id,
    number: chapter.number?.trim() || null,
    volume: chapter.volume?.trim() || null,
    title: chapter.title?.trim() || null,
    language: language as Language,
    pages: chapter.pages ?? 0,
    groups: (chapter.groups ?? []).map((group) =>
      typeof group === 'string' ? { id: group, name: group } : { id: group.id ?? group.name, name: group.name },
    ),
    publishedAt: chapter.publishedAt ?? EPOCH,
  }
}

export function createOpenComicStreamProvider(options: {
  baseUrl: string
  name: string
  userAgent: string
  /** Envoyée en `Authorization: Bearer` si renseignée. */
  apiKey?: string
  log?: ProviderLog
}): SourceProvider {
  const log = options.log ?? providerLogger(options.name)
  const headers: Record<string, string> = options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}
  const request = (endpoint: string) => ({ userAgent: options.userAgent, label: options.name, endpoint, log, headers })
  return {
    id: 'opencomic',
    name: options.name,
    baseUrl: options.baseUrl,
    supportedLanguages: LANGUAGES,
    priority: 50,
    timeoutMs: 12_000,
    usesAliases: true,

    async fetchChapterList(mangaId, titleAliases) {
      const query = new URLSearchParams({ mangadexId: mangaId })
      for (const title of titleAliases.slice(0, 5)) query.append('title', title)
      const payload = await getJson(`${options.baseUrl}/chapters?${query}`, ChaptersSchema, request('chapters'))
      const received = payload?.chapters ?? []
      const chapters = received.map(normalizeOpenComicChapter).filter((chapter) => chapter !== null)
      log(`chapters (${titleAliases.length} titre(s)) -> ${chapters.length} chapitre(s) retenus sur ${received.length}`)
      return chapters
    },

    async fetchPageUrls(chapterId) {
      const payload = await getJson(`${options.baseUrl}/chapters/${encodeURIComponent(chapterId)}/pages`, PagesSchema, request('pages'))
      if (!payload || payload.pages.length === 0) log(`pages « ${chapterId} » -> aucune image`)
      if (!payload) return []
      const shared = payload.headers ?? {}
      return payload.pages.map((page, index) =>
        typeof page === 'string'
          ? { index, url: page, headers: provenanceHeaders(shared) }
          : { index, url: page.url, headers: provenanceHeaders({ ...shared, ...page.headers }) },
      )
    },
  }
}
