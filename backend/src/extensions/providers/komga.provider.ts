import { z } from 'zod'
import { LANGUAGES, type Language } from '../../lib/language.js'
import type { NormalizedChapter, SourceProvider } from '../types.js'
import { getJson, providerLogger, type ProviderLog } from './http.js'
import { createSeriesResolver, isNumberingOnly, libraryDate, originImageFetcher } from './library.js'

/**
 * Bibliothèque personnelle Komga (API REST `/api/v1`). Authentification par
 * clé d'API (`X-API-Key`, Komga ≥ 1.16) ou, à défaut, Basic avec un compte.
 * Une série Komga est retrouvée par titre ; ses « livres » (un fichier CBZ /
 * PDF / EPUB chacun) deviennent des chapitres, ou des tomes quand leur nom le dit.
 * Les images sont servies par Komga lui-même, via `fetchImage` : jamais
 * exposées au navigateur, jamais demandées ailleurs qu'à l'instance configurée.
 */

const Page = <T extends z.ZodType>(item: T) => z.object({ content: z.array(item) })

const SeriesSchema = z.object({
  id: z.string(),
  name: z.string(),
  metadata: z
    .object({
      title: z.string().nullish(),
      language: z.string().nullish(),
      alternateTitles: z.array(z.object({ title: z.string() })).nullish(),
    })
    .nullish(),
})

const BookSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.number().nullish(),
  created: z.string().nullish(),
  metadata: z
    .object({ title: z.string().nullish(), number: z.string().nullish(), releaseDate: z.string().nullish() })
    .nullish(),
  media: z.object({ pagesCount: z.number().int().nonnegative().nullish() }).nullish(),
})

const PagesSchema = z.array(z.object({ number: z.number().int().positive() }))

type KomgaSeries = z.infer<typeof SeriesSchema>
type KomgaBook = z.infer<typeof BookSchema>

/** « Tome 3 », « Vol. 3 », « T03 » : le fichier est un volume entier, pas un chapitre. */
const VOLUME_HINT = /\b(?:t(?:ome)?|vol(?:ume)?)\.?\s*\d/i
const CHAPTER_HINT = /\b(?:ch(?:apter|apitre)?|c)\.?\s*\d/i

export function normalizeKomgaBook(book: KomgaBook, language: Language): NormalizedChapter {
  const label = book.metadata?.title?.trim() || book.name
  const rawNumber = book.metadata?.number?.trim() || (book.number != null ? String(book.number) : '')
  const number = /^\d+(?:\.\d+)?$/.test(rawNumber) ? rawNumber : null
  const isVolume = VOLUME_HINT.test(`${label} ${book.name}`) && !CHAPTER_HINT.test(`${label} ${book.name}`)
  return {
    id: book.id,
    number: isVolume ? null : number,
    volume: isVolume ? number : null,
    // Un tome garde son nom (le lecteur l'affiche) ; un chapitre, seulement s'il apporte quelque chose.
    title: isVolume || !isNumberingOnly(label) ? label : null,
    language,
    pages: book.media?.pagesCount ?? 0,
    groups: [],
    publishedAt: libraryDate(book.metadata?.releaseDate, book.created),
  }
}

export interface LibraryOptions {
  baseUrl: string
  name: string
  language: Language
  userAgent: string
  apiKey?: string
  user?: string
  password?: string
  log?: ProviderLog
}

export function createKomgaProvider(options: LibraryOptions): SourceProvider {
  const log = options.log ?? providerLogger(options.name)
  const api = `${options.baseUrl}/api/v1`
  const auth: Record<string, string> = options.apiKey
    ? { 'X-API-Key': options.apiKey }
    : options.user && options.password
      ? { Authorization: `Basic ${Buffer.from(`${options.user}:${options.password}`).toString('base64')}` }
      : {}
  if (Object.keys(auth).length === 0) log('ni OPEN_COMIC_API_KEY ni OPEN_COMIC_USER / OPEN_COMIC_PASSWORD : Komga refusera les requêtes')
  const request = (endpoint: string) => ({ userAgent: options.userAgent, label: options.name, endpoint, log, headers: auth })

  const languageOf = (series: KomgaSeries): Language => {
    const code = series.metadata?.language?.slice(0, 2).toLowerCase()
    return LANGUAGES.includes(code as Language) ? (code as Language) : options.language
  }

  const resolveSeries = createSeriesResolver<KomgaSeries>({
    search: async (query) =>
      (await getJson(`${api}/series?search=${encodeURIComponent(query)}&size=20`, Page(SeriesSchema), request('search')))?.content ?? [],
    titlesOf: (series) => [
      series.metadata?.title ?? '',
      series.name,
      ...(series.metadata?.alternateTitles ?? []).map((alternate) => alternate.title),
    ],
    log,
  })

  return {
    id: 'komga',
    name: options.name,
    baseUrl: options.baseUrl,
    supportedLanguages: LANGUAGES,
    // Fichiers de l'utilisateur : après MangaDex (équipes créditées), avant les agrégateurs.
    priority: 60,
    timeoutMs: 20_000,
    usesAliases: true,

    async fetchChapterList(mangaId, titleAliases) {
      const series = await resolveSeries(mangaId, titleAliases)
      if (!series) return []
      const books = await getJson(
        `${api}/series/${encodeURIComponent(series.id)}/books?unpaged=true&sort=metadata.numberSort,asc`,
        Page(BookSchema),
        request('books'),
      )
      const language = languageOf(series)
      const chapters = (books?.content ?? []).map((book) => normalizeKomgaBook(book, language))
      log(`série « ${series.metadata?.title ?? series.name} » -> ${chapters.length} livre(s)`)
      return chapters
    },

    async fetchPageUrls(bookId) {
      const book = `${api}/books/${encodeURIComponent(bookId)}`
      const pages = (await getJson(`${book}/pages`, PagesSchema, request('pages'))) ?? []
      if (pages.length === 0) log(`pages du livre ${bookId} -> aucune image (fichier en cours d’analyse ?)`)
      return pages.map((page, index) => ({ index, url: `${book}/pages/${page.number}` }))
    },

    fetchImage: originImageFetcher({ baseUrl: options.baseUrl, headers: () => auth, userAgent: options.userAgent }),
  }
}
