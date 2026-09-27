import { z } from 'zod'
import type { Language } from '../../lib/language.js'
import type { NormalizedChapter, SourceProvider } from '../types.js'
import { getJson, ProviderHttpError, providerLogger } from './http.js'
import type { LibraryOptions } from './komga.provider.js'
import { createSeriesResolver, isNumberingOnly, libraryDate, originImageFetcher } from './library.js'

/**
 * Bibliothèque personnelle Kavita. Authentification par clé d'API
 * (profil utilisateur → « API Key ») échangée contre un jeton JWT via
 * `/api/Plugin/authenticate` ; jeton renouvelé tout seul s'il expire (401).
 * Les images passent par `fetchImage`, depuis l'instance configurée seulement.
 */

const AuthSchema = z.object({ token: z.string().min(1) })

const SearchSchema = z.object({
  series: z
    .array(
      z.object({
        seriesId: z.number().int(),
        name: z.string(),
        originalName: z.string().nullish(),
        localizedName: z.string().nullish(),
      }),
    )
    .nullish(),
})

const ChapterSchema = z.object({
  id: z.number().int(),
  range: z.string().nullish(),
  number: z.string().nullish(),
  minNumber: z.number().nullish(),
  title: z.string().nullish(),
  titleName: z.string().nullish(),
  pages: z.number().int().nonnegative().nullish(),
  isSpecial: z.boolean().nullish(),
  releaseDate: z.string().nullish(),
  created: z.string().nullish(),
})

const VolumeSchema = z.object({
  name: z.string().nullish(),
  number: z.number().nullish(),
  minNumber: z.number().nullish(),
  chapters: z.array(ChapterSchema),
})

const VolumesSchema = z.array(VolumeSchema)
const ChapterInfoSchema = z.object({ pages: z.number().int().nonnegative() })

type KavitaSeries = NonNullable<z.infer<typeof SearchSchema>['series']>[number]

/**
 * Numéros réservés de Kavita (0.8+) : chapitres « en vrac » hors volume, et
 * volume des hors-séries. Les versions plus anciennes utilisaient 0.
 */
const LOOSE_LEAF = -100_000
const SPECIAL = 100_000
const format = (value: number) => String(Number(value.toFixed(3)))

export function normalizeKavitaChapter(
  chapter: z.infer<typeof ChapterSchema>,
  volume: z.infer<typeof VolumeSchema>,
  language: Language,
): NormalizedChapter {
  const volumeNumber = volume.minNumber ?? volume.number ?? null
  const hasVolume = volumeNumber !== null && volumeNumber !== LOOSE_LEAF && volumeNumber !== SPECIAL && volumeNumber > 0
  const chapterNumber = chapter.minNumber ?? Number.parseFloat(chapter.number ?? chapter.range ?? '')
  const special = Boolean(chapter.isSpecial) || volumeNumber === SPECIAL
  // Un fichier « tome entier » a pour chapitre le numéro réservé (ou 0 dans les anciennes versions).
  const hasChapter = !special && Number.isFinite(chapterNumber) && chapterNumber !== LOOSE_LEAF && !(chapterNumber === 0 && hasVolume)
  const number = hasChapter ? format(chapterNumber) : null
  const named = chapter.titleName?.trim() || chapter.title?.trim() || ''
  return {
    id: String(chapter.id),
    number,
    volume: hasVolume ? format(volumeNumber) : null,
    title: named && !isNumberingOnly(named) ? named : number === null ? (volume.name?.trim() || chapter.range?.trim() || null) : null,
    language,
    pages: chapter.pages ?? 0,
    groups: [],
    publishedAt: libraryDate(chapter.releaseDate, chapter.created),
  }
}

export function createKavitaProvider(options: LibraryOptions): SourceProvider {
  const log = options.log ?? providerLogger(options.name)
  const api = `${options.baseUrl}/api`
  const apiKey = options.apiKey ?? ''
  if (!apiKey) log('OPEN_COMIC_API_KEY manquante : Kavita exige une clé d’API (profil utilisateur → API Key)')

  let token: Promise<string> | null = null
  const authenticate = () =>
    (token ??= getJson(
      `${api}/Plugin/authenticate?apiKey=${encodeURIComponent(apiKey)}&pluginName=Bookshelf`,
      AuthSchema,
      { userAgent: options.userAgent, label: options.name, endpoint: 'authenticate', log, method: 'POST' },
    )
      .then((payload) => {
        if (!payload) throw new ProviderHttpError(404, `${options.name} : authentification introuvable.`)
        return payload.token
      })
      // Échec : on ne garde pas une promesse rejetée, le prochain appel réessaiera.
      .catch((error: unknown) => {
        token = null
        throw error
      }))

  /** Requête authentifiée ; jeton expiré (401) → une nouvelle authentification, un nouvel essai. */
  const call = async <S extends z.ZodType>(path: string, schema: S, endpoint: string, retried = false): Promise<z.infer<S> | null> => {
    // Hors du `try` : une clé refusée à l'authentification ne mérite pas un second essai.
    const bearer = await authenticate()
    try {
      return await getJson(`${api}${path}`, schema, {
        userAgent: options.userAgent,
        label: options.name,
        endpoint,
        log,
        headers: { Authorization: `Bearer ${bearer}` },
      })
    } catch (error) {
      if (!retried && error instanceof ProviderHttpError && error.upstreamStatus === 401) {
        token = null
        return call(path, schema, endpoint, true)
      }
      throw error
    }
  }

  const resolveSeries = createSeriesResolver<KavitaSeries>({
    search: async (query) => (await call(`/Search/search?queryString=${encodeURIComponent(query)}`, SearchSchema, 'search'))?.series ?? [],
    titlesOf: (series) => [series.name, series.originalName ?? '', series.localizedName ?? ''],
    log,
  })

  return {
    id: 'kavita',
    name: options.name,
    baseUrl: options.baseUrl,
    supportedLanguages: [options.language],
    priority: 60,
    timeoutMs: 20_000,
    usesAliases: true,

    async fetchChapterList(mangaId, titleAliases) {
      const series = await resolveSeries(mangaId, titleAliases)
      if (!series) return []
      const volumes = (await call(`/Series/volumes?seriesId=${series.seriesId}`, VolumesSchema, 'volumes')) ?? []
      const chapters = volumes.flatMap((volume) => volume.chapters.map((chapter) => normalizeKavitaChapter(chapter, volume, options.language)))
      log(`série « ${series.name} » -> ${chapters.length} fichier(s) dans ${volumes.length} volume(s)`)
      return chapters
    },

    async fetchPageUrls(chapterId) {
      const info = await call(`/Reader/chapter-info?chapterId=${encodeURIComponent(chapterId)}`, ChapterInfoSchema, 'chapter-info')
      const count = info?.pages ?? 0
      if (count === 0) log(`chapitre ${chapterId} -> aucune page`)
      // La clé voyage dans l'URL (exigence de Kavita pour les images) : URL gardée côté serveur, jamais envoyée au navigateur.
      return Array.from({ length: count }, (_, index) => ({
        index,
        url: `${api}/Reader/image?chapterId=${encodeURIComponent(chapterId)}&page=${index}&apiKey=${encodeURIComponent(apiKey)}&extractPdf=true`,
      }))
    },

    fetchImage: originImageFetcher({
      baseUrl: options.baseUrl,
      headers: async () => ({ Authorization: `Bearer ${await authenticate()}` }),
      userAgent: options.userAgent,
    }),
  }
}
