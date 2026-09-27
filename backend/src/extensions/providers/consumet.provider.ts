import { z } from 'zod'
import type { Language } from '../../lib/language.js'
import type { NormalizedChapter, SourceProvider } from '../types.js'
import { getJson, numberFromTitle, provenanceHeaders, providerLogger, type ProviderLog } from './http.js'
import { createSeriesResolver } from './library.js'

/**
 * Client d'une instance de l'API REST open-source Consumet (auto-hébergée),
 * pour UN de ses catalogues manga (`/manga/<catalogue>/…`). Consumet ne
 * connaît pas les identifiants MangaDex : l'œuvre est retrouvée par titre,
 * avec une correspondance exacte obligatoire (cf. titleMatch.ts).
 *
 * Les catalogues Consumet n'ont pas tous la même forme de réponse : les
 * schémas ci-dessous acceptent les variantes connues (numéro dans
 * `chapterNumber`, `chapter` ou le titre ; titre texte ou localisé) et
 * rejettent le reste, ce qui met la source en échec sans rien casser.
 */

const Scalar = z.union([z.string(), z.number()]).transform(String)
const Title = z.union([z.string(), z.record(z.string(), z.string().nullish())])

const SearchSchema = z.object({
  results: z.array(z.object({ id: Scalar, title: Title.nullish(), altTitles: z.array(Title).nullish() })),
})

const ChapterSchema = z.object({
  id: Scalar,
  title: z.string().nullish(),
  chapterNumber: Scalar.nullish(),
  chapter: Scalar.nullish(),
  volumeNumber: Scalar.nullish(),
  volume: Scalar.nullish(),
  pages: z.number().int().nonnegative().nullish(),
  releaseDate: z.string().nullish(),
  releasedDate: z.string().nullish(),
})

const InfoSchema = z.object({ chapters: z.array(ChapterSchema).nullish() })

const ReadSchema = z.array(
  z.object({ img: z.string(), page: z.number().nullish(), headerForImage: z.record(z.string(), z.string()).nullish() }),
)

/** Catalogues dont les routes prennent l'identifiant dans le chemin, et non en paramètre. */
const PATH_PARAM_CATALOGS = new Set(['mangadex'])

const titlesOf = (value: z.infer<typeof Title> | null | undefined): string[] =>
  !value ? [] : typeof value === 'string' ? [value] : Object.values(value).filter((title): title is string => Boolean(title))

const EPOCH = new Date(0).toISOString()

export function normalizeConsumetChapter(chapter: z.infer<typeof ChapterSchema>, language: Language): NormalizedChapter {
  const title = chapter.title?.trim() || null
  const number = chapter.chapterNumber?.trim() || chapter.chapter?.trim() || numberFromTitle(title)
  const released = chapter.releaseDate ?? chapter.releasedDate
  return {
    id: chapter.id,
    number,
    volume: chapter.volumeNumber?.trim() || chapter.volume?.trim() || null,
    // Un titre qui ne fait que répéter le numéro (« Chapter 12 ») n'apporte rien.
    title: title && numberFromTitle(title) !== null && title.length < 16 ? null : title,
    language,
    pages: chapter.pages ?? 0,
    groups: [],
    publishedAt: released && !Number.isNaN(Date.parse(released)) ? new Date(released).toISOString() : EPOCH,
  }
}

export function createConsumetProvider(options: {
  baseUrl: string
  provider: string
  language: Language
  userAgent: string
  log?: ProviderLog
}): SourceProvider {
  const root = `${options.baseUrl}/manga/${options.provider}`
  const log = options.log ?? providerLogger(`Consumet/${options.provider}`)
  const request = (endpoint: string) => ({ userAgent: options.userAgent, label: 'Consumet', endpoint, log, timeoutMs: 8_000 })
  const pathParams = PATH_PARAM_CATALOGS.has(options.provider)
  const infoUrl = (id: string) => (pathParams ? `${root}/info/${encodeURIComponent(id)}` : `${root}/info?id=${encodeURIComponent(id)}`)
  const readUrl = (id: string) =>
    pathParams ? `${root}/read/${encodeURIComponent(id)}` : `${root}/read?chapterId=${encodeURIComponent(id)}`

  const resolveSeries = createSeriesResolver({
    search: async (query) => (await getJson(`${root}/${encodeURIComponent(query)}`, SearchSchema, request('search')))?.results ?? [],
    titlesOf: (result) => [...titlesOf(result.title), ...(result.altTitles ?? []).flatMap(titlesOf)],
    log,
  })

  return {
    id: 'consumet',
    name: 'Consumet',
    baseUrl: options.baseUrl,
    supportedLanguages: [options.language],
    priority: 30,
    // Jusqu'à 4 recherches puis la fiche, 8 s chacune au plus.
    timeoutMs: 25_000,
    usesAliases: true,

    async fetchChapterList(mangaId, titleAliases) {
      const seriesId = (await resolveSeries(mangaId, titleAliases))?.id
      if (!seriesId) return []
      const info = await getJson(infoUrl(seriesId), InfoSchema, request('info'))
      const chapters = (info?.chapters ?? []).map((chapter) => normalizeConsumetChapter(chapter, options.language))
      log(`info « ${seriesId} » -> ${chapters.length} chapitre(s)`)
      return chapters
    },

    async fetchPageUrls(chapterId) {
      const pages = (await getJson(readUrl(chapterId), ReadSchema, request('read'))) ?? []
      if (pages.length === 0) log(`read « ${chapterId} » -> aucune image`)
      return [...pages]
        .sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
        .map((page, index) => ({ index, url: page.img, headers: provenanceHeaders(page.headerForImage) }))
    },
  }
}
