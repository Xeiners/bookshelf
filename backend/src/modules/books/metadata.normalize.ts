import { normalizeTitle, titleSimilarity } from '../../extensions/titleMatch.js'
import type { Language } from '../../lib/language.js'
import type { Book } from './book.schema.js'
import { isbnOf, languageCode, plainText } from './epub.parser.js'

/**
 * Fiches de romans venues d'Open Library et de Google Books, ramenées à une
 * forme commune, fusionnées et classées — pur, testé (`backend/test/books.test.ts`).
 *
 * Les deux sources se complètent : Open Library est gratuite et sans quota
 * mais pauvre en résumés et en éditions françaises récentes ; Google Books a
 * les résumés et les couvertures des nouveautés, mais un quota serré.
 */

export type MetadataSource = 'openlibrary' | 'google'

export interface NovelMetadata {
  /** `ol:OL82563W` (œuvre Open Library) ou `gb:<id de volume>`. */
  id: string
  /** Identifiant du livre chez chaque source qui le connaît (œuvre Open Library, volume Google). */
  refs: Partial<Record<MetadataSource, string>>
  title: string
  subtitle: string | null
  authors: string[]
  /** Couverture la plus grande disponible (HTTPS). */
  cover: string | null
  synopsis: string
  /** Langue du résumé et du titre. */
  language: string | null
  categories: string[]
  pages: number | null
  year: number | null
  publisher: string | null
  isbn: string | null
  rating: number | null
  ratingsCount: number
  link: string | null
}

/* ---- Open Library ---------------------------------------------------------------- */

export interface OpenLibraryDoc {
  key?: string
  title?: string
  subtitle?: string
  author_name?: string[]
  first_publish_year?: number
  number_of_pages_median?: number
  cover_i?: number
  language?: string[]
  isbn?: string[]
  publisher?: string[]
  subject?: string[]
  ratings_average?: number
  ratings_count?: number
  /** Meilleure édition pour la langue demandée (`lang=` de la recherche). */
  editions?: { docs?: OpenLibraryEdition[] }
}

export interface OpenLibraryEdition {
  title?: string
  subtitle?: string
  language?: string[]
  cover_i?: number
}

/** Champs demandés à `search.json` : la réponse reste légère. */
export const OPEN_LIBRARY_FIELDS =
  'key,title,subtitle,author_name,first_publish_year,number_of_pages_median,cover_i,language,isbn,publisher,subject,ratings_average,ratings_count,' +
  'editions,editions.title,editions.subtitle,editions.language,editions.cover_i'

export const openLibraryCover = (coverId: number) => `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`

/**
 * Langue d'une œuvre Open Library : celle demandée si une édition existe dans
 * cette langue, sinon la première des deux langues de l'app qu'elle a.
 */
function openLibraryLanguage(codes: readonly string[] | undefined, wanted: Language): string | null {
  const languages = (codes ?? []).map(languageCode).filter((code): code is string => code !== null)
  if (languages.includes(wanted)) return wanted
  return languages.find((code) => code === 'fr' || code === 'en') ?? languages[0] ?? null
}

export function fromOpenLibrary(doc: OpenLibraryDoc, wanted: Language): NovelMetadata | null {
  const workId = doc.key?.match(/OL\d+W$/)?.[0]
  // L'édition dans la langue voulue donne son titre et sa couverture : « Le Nom de la
  // Rose » plutôt que « Il nome della rosa », la couverture française plutôt que l'originale.
  const edition = doc.editions?.docs?.find((candidate) => (candidate.language ?? []).map(languageCode).includes(wanted) && candidate.title?.trim())
  const title = (edition?.title ?? doc.title)?.trim()
  const coverId = edition?.cover_i ?? doc.cover_i
  if (!workId || !title) return null
  const rating = typeof doc.ratings_average === 'number' ? Math.round(doc.ratings_average * 10) / 10 : null
  return {
    id: `ol:${workId}`,
    refs: { openlibrary: workId },
    title,
    subtitle: (edition ? edition.subtitle : doc.subtitle)?.trim() || null,
    authors: (doc.author_name ?? []).slice(0, 5),
    cover: typeof coverId === 'number' && coverId > 0 ? openLibraryCover(coverId) : null,
    // Le résumé d'Open Library est sur la fiche de l'œuvre : hydraté à part.
    synopsis: '',
    language: openLibraryLanguage(doc.language, wanted),
    categories: (doc.subject ?? []).slice(0, 6),
    pages: positiveInt(doc.number_of_pages_median),
    year: positiveInt(doc.first_publish_year),
    publisher: doc.publisher?.[0]?.trim() || null,
    isbn: (doc.isbn ?? []).map(isbnOf).find((isbn) => isbn?.length === 13) ?? null,
    rating: rating && rating > 0 ? Math.min(5, rating) : null,
    ratingsCount: positiveInt(doc.ratings_count) ?? 0,
    link: `https://openlibrary.org/works/${workId}`,
  }
}

/** `description` d'une œuvre Open Library : texte brut, ou `{ type, value }`. */
export function openLibraryDescription(work: { description?: string | { value?: string } }): string {
  const raw = typeof work.description === 'string' ? work.description : (work.description?.value ?? '')
  // Les descriptions citent souvent leurs sources en Markdown après une ligne « ---- ».
  const body = raw.split(/\r?\n-{3,}/)[0] ?? ''
  // Markdown d'Open Library : liens `[texte](url)` et emphase `*texte*`, `**texte**`, `_texte_`.
  const text = body.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*{1,2}|_{1,2})(\S(?:[^*_]*\S)?)\1/g, '$2')
  return plainText(text)
}

/* ---- Google Books ---------------------------------------------------------------- */

export interface GoogleVolume {
  id?: string
  volumeInfo?: {
    title?: string
    subtitle?: string
    authors?: string[]
    publisher?: string
    publishedDate?: string
    description?: string
    industryIdentifiers?: { type?: string; identifier?: string }[]
    pageCount?: number
    categories?: string[]
    averageRating?: number
    ratingsCount?: number
    imageLinks?: Partial<Record<'smallThumbnail' | 'thumbnail' | 'small' | 'medium' | 'large' | 'extraLarge', string>>
    language?: string
    infoLink?: string
    canonicalVolumeLink?: string
  }
}

/**
 * Couverture Google Books en grand : la plus grande taille fournie, en HTTPS,
 * sans l'effet « page cornée » (`edge=curl`), agrandie par `fife` (la
 * recherche ne donne que des vignettes de 128 px).
 */
export function googleCover(links: NonNullable<GoogleVolume['volumeInfo']>['imageLinks']): string | null {
  const url = links?.extraLarge ?? links?.large ?? links?.medium ?? links?.small ?? links?.thumbnail ?? links?.smallThumbnail
  if (!url) return null
  try {
    const parsed = new URL(url.replace(/^http:/, 'https:'))
    parsed.searchParams.delete('edge')
    if (parsed.pathname.endsWith('/books/content') || parsed.pathname.endsWith('/books/publisher/content')) {
      parsed.searchParams.set('fife', 'w800-h1200')
    }
    return parsed.href
  } catch {
    return null
  }
}

export function fromGoogle(volume: GoogleVolume): NovelMetadata | null {
  const info = volume.volumeInfo
  const title = info?.title?.trim()
  if (!volume.id || !info || !title) return null
  const isbns = (info.industryIdentifiers ?? []).map((identifier) => isbnOf(identifier.identifier ?? '')).filter(Boolean)
  return {
    id: `gb:${volume.id}`,
    refs: { google: volume.id },
    title,
    subtitle: info.subtitle?.trim() || null,
    authors: (info.authors ?? []).slice(0, 5),
    cover: googleCover(info.imageLinks),
    synopsis: plainText(info.description ?? ''),
    language: languageCode(info.language),
    categories: (info.categories ?? []).slice(0, 6),
    pages: positiveInt(info.pageCount),
    year: positiveInt(Number(info.publishedDate?.slice(0, 4))),
    publisher: info.publisher?.trim() || null,
    isbn: isbns.find((isbn) => isbn?.length === 13) ?? isbns[0] ?? null,
    rating: typeof info.averageRating === 'number' && info.averageRating > 0 ? Math.min(5, info.averageRating) : null,
    ratingsCount: positiveInt(info.ratingsCount) ?? 0,
    link: info.canonicalVolumeLink ?? info.infoLink ?? null,
  }
}

/* ---- Fusion et classement -------------------------------------------------------- */

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

/** Nom de famille normalisé du premier auteur : « Colleen Hoover » → « hoover ». */
export const authorKey = (authors: readonly string[]) => normalizeTitle(authors[0] ?? '').split(' ').pop() ?? ''

/** Clé de dédoublonnage : titre normalisé + nom du premier auteur. */
export const dedupeKey = (item: Pick<NovelMetadata, 'title' | 'authors'>) => `${normalizeTitle(item.title)}|${authorKey(item.authors)}`

/** Complète `base` avec ce qui lui manque dans `other` (même livre, autre source). */
function combine(base: NovelMetadata, other: NovelMetadata): NovelMetadata {
  return {
    ...base,
    refs: { ...other.refs, ...base.refs },
    subtitle: base.subtitle ?? other.subtitle,
    authors: base.authors.length > 0 ? base.authors : other.authors,
    cover: base.cover ?? other.cover,
    synopsis: base.synopsis || other.synopsis,
    language: base.language ?? other.language,
    categories: base.categories.length > 0 ? base.categories : other.categories,
    pages: base.pages ?? other.pages,
    // La première parution connue : Google date souvent la réédition.
    year: base.year && other.year ? Math.min(base.year, other.year) : (base.year ?? other.year),
    publisher: base.publisher ?? other.publisher,
    isbn: base.isbn ?? other.isbn,
    rating: base.rating ?? other.rating,
    ratingsCount: Math.max(base.ratingsCount, other.ratingsCount),
    link: base.link ?? other.link,
  }
}

/**
 * Pertinence d'une fiche pour une recherche : rang dans sa source (la
 * pertinence de la source reste le premier critère), proximité du titre ou de
 * l'auteur avec la requête, langue voulue, puis complétude (couverture, résumé).
 */
export function relevance(item: NovelMetadata, rank: number, query: string, wanted: Language): number {
  const normalizedQuery = normalizeTitle(query)
  const titleScore = Math.max(titleSimilarity(item.title, query), normalizeTitle(item.title).includes(normalizedQuery) ? 0.9 : 0)
  const authorScore = item.authors.some((author) => {
    const name = normalizeTitle(author)
    return name.length > 0 && normalizedQuery.includes(name)
  })
    ? 0.6
    : 0
  return (
    1 / (1 + rank) +
    0.6 * Math.max(titleScore, authorScore) +
    (item.language === wanted ? 0.5 : 0) +
    (item.cover ? 0.15 : 0) +
    (item.synopsis ? 0.1 : 0) +
    (Object.keys(item.refs).length > 1 ? 0.2 : 0)
  )
}

/**
 * Fusionne les listes des sources : un même livre (même titre, même auteur)
 * n'apparaît qu'une fois, avec les champs des deux ; la fiche de la langue
 * voulue sert de base. Classées par pertinence, `limit` au plus.
 */
export function mergeResults(lists: readonly NovelMetadata[][], query: string, wanted: Language, limit = 20): NovelMetadata[] {
  const merged = new Map<string, { item: NovelMetadata; rank: number }>()
  for (const list of lists) {
    list.forEach((item, rank) => {
      const key = dedupeKey(item)
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { item, rank })
        return
      }
      // La fiche dans la langue voulue passe devant (titre et résumé traduits).
      const [base, other] = existing.item.language !== wanted && item.language === wanted ? [item, existing.item] : [existing.item, item]
      merged.set(key, { item: combine(base, other), rank: Math.min(existing.rank, rank) })
    })
  }
  return [...merged.values()]
    .map(({ item, rank }) => ({ item, score: relevance(item, rank, query, wanted) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item)
}

/**
 * Fiche correspondant à un EPUB importé : même titre (à la ponctuation près)
 * et, si le fichier nomme un auteur, un auteur en commun. Mieux vaut aucune
 * fiche que le résumé d'un autre livre.
 */
export function pickMatch(results: readonly NovelMetadata[], wanted: { title: string; author: string | null }): NovelMetadata | null {
  const author = wanted.author ? authorKey([wanted.author.split(',')[0] ?? '']) : null
  let best: { item: NovelMetadata; score: number } | null = null
  for (const item of results) {
    // Série en titre, vrai titre en sous-titre : « Seasons, Tome 2 » / « Un hiver pour te résister ».
    const titles = [item.title, item.subtitle, item.subtitle ? `${item.title} ${item.subtitle}` : null].filter((title): title is string => !!title)
    const score = Math.max(...titles.map((title) => titleSimilarity(title, wanted.title)))
    if (score < 0.8) continue
    if (author && !item.authors.some((name) => authorKey([name]) === author)) continue
    if (!best || score > best.score) best = { item, score }
  }
  return best?.item ?? null
}

/** Fiche au format `Book` partagé avec le front (catalogue, fiche détaillée, bibliothèque). */
export function toBook(item: NovelMetadata, wanted: Language): Book {
  const language = item.language === 'fr' || item.language === 'en' ? item.language : null
  return {
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    authors: item.authors,
    cover: item.cover,
    synopsis: item.synopsis,
    categories: item.categories,
    rating: item.rating,
    ratingsCount: item.ratingsCount,
    pages: item.pages,
    year: item.year,
    publisher: item.publisher,
    previewLink: item.link,
    kind: 'book',
    languages: language ? [language] : [],
    lang: wanted,
    synopsisLanguage: item.synopsis ? language : null,
  }
}
