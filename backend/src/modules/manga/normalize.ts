import { config } from '../../config.js'
import type { Book, BookKind } from '../books/book.schema.js'
import { preferenceOrder, type Language } from '../../lib/language.js'
import type { LocalizedString, MdManga } from './mangadex.client.js'
import { tagLabel } from './tags.js'

/** Langues de lecture servies (chapitres disponibles), quelle que soit la langue d'affichage. */
export const READABLE_LANGUAGES = ['fr', 'en'] as const

const UNTITLED: Record<Language, string> = { fr: 'Sans titre', en: 'Untitled' }

/** Repli pour le titre : romanisation, puis script original. */
const TITLE_FALLBACKS = ['ja-ro', 'ko-ro', 'ja', 'ko']

const MAX_SYNOPSIS = 2000
const MAX_CATEGORIES = 4
const MAX_AUTHORS = 3

function firstValue(record: LocalizedString): string | undefined {
  return Object.values(record).find((value): value is string => Boolean(value?.trim()))
}

/**
 * Premier texte non vide, en parcourant les langues dans l'ordre de préférence.
 * Pour chaque langue, tous les enregistrements sont essayés avant de passer à la
 * suivante : un titre alternatif français bat un titre principal anglais.
 */
function pickLocalized(
  records: LocalizedString[],
  languages: readonly string[],
): { value: string; language: string } | undefined {
  for (const language of languages) {
    for (const record of records) {
      const value = record[language]?.trim()
      if (value) return { value, language }
    }
  }
  return undefined
}

/**
 * Titre dans la langue demandée, sinon dans l'autre langue servie (titre
 * officiel, puis titres alternatifs), sinon la romanisation : jamais de vide.
 */
function pickTitle(manga: MdManga, language: Language): { title: string; subtitle: string | null } {
  const { title: main, altTitles } = manga.attributes
  const records = [main, ...altTitles]
  const original = firstValue(main) ?? UNTITLED[language]
  const title =
    pickLocalized(records, preferenceOrder(language))?.value ??
    pickLocalized(records, TITLE_FALLBACKS)?.value ??
    original

  // Le titre original sert de sous-titre quand il diffère : « Solo Leveling » / « Na Honjaman Level-Up ».
  const subtitle = original.toLowerCase() !== title.toLowerCase() ? original : null
  return { title, subtitle }
}

/**
 * Les descriptions MangaDex sont en markdown et finissent souvent par un bloc
 * de liens séparé par `---` : on garde le texte, sans balisage.
 */
export function cleanDescription(raw: string): string {
  const body = raw.split(/\n\s*[-*_]{3,}\s*(?:\n|$)/)[0] ?? raw
  const text = body
    .split('\n')
    .filter((line) => !/^\s*[-*]\s*\[/.test(line)) // listes de liens
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, '$2')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text.length > MAX_SYNOPSIS ? `${text.slice(0, MAX_SYNOPSIS - 1).trimEnd()}…` : text
}

function kindOf(originalLanguage: string): BookKind {
  if (originalLanguage === 'ko') return 'manhwa'
  if (originalLanguage.startsWith('zh')) return 'manhua'
  return 'manga'
}

/** « Chugong (추공) » → « Chugong » : le nom natif alourdit la carte. */
function cleanPersonName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name
}

export function coverPath(mangaId: string, fileName: string): string {
  return `${config.publicApiBase}/covers/${mangaId}/${encodeURIComponent(fileName)}?size=512`
}

/** Note bayésienne MangaDex (/10) → échelle /5 du front. */
function toFiveStars(bayesian: number | null | undefined): number | null {
  if (typeof bayesian !== 'number' || bayesian <= 0) return null
  return Math.round((bayesian / 2) * 10) / 10
}

/**
 * Œuvre MangaDex → `Book` du front, dans la langue demandée avec repli sur
 * l'autre : titre, résumé et genres ne sont jamais vides à cause de la langue.
 */
export function normalizeManga(manga: MdManga, rating: number | null | undefined, language: Language): Book {
  const { attributes, relationships } = manga
  const { title, subtitle } = pickTitle(manga, language)

  const description = pickLocalized([attributes.description], preferenceOrder(language))
  const synopsis = description ? cleanDescription(description.value) : ''

  const genres: string[] = []
  const themes: string[] = []
  for (const tag of attributes.tags) {
    const english = tag.attributes.name.en
    const label = english ? tagLabel(english, language) : undefined
    if (!label) continue
    if (tag.attributes.group === 'genre') genres.push(label)
    else if (tag.attributes.group === 'theme') themes.push(label)
  }

  const authors = [
    ...new Set(
      relationships
        .filter((rel) => rel.type === 'author' || rel.type === 'artist')
        .map((rel) => rel.attributes?.name)
        .filter((name): name is string => Boolean(name))
        .map(cleanPersonName),
    ),
  ].slice(0, MAX_AUTHORS)

  const coverFile = relationships.find((rel) => rel.type === 'cover_art')?.attributes?.fileName
  const lastChapter = Number.parseFloat(attributes.lastChapter ?? '')
  const available = new Set(attributes.availableTranslatedLanguages)

  return {
    id: manga.id,
    title,
    subtitle,
    authors,
    cover: coverFile ? coverPath(manga.id, coverFile) : null,
    synopsis,
    categories: [...genres, ...themes].slice(0, MAX_CATEGORIES),
    rating: toFiveStars(rating),
    ratingsCount: 0,
    pages: null,
    year: attributes.year,
    publisher: null,
    previewLink: `https://mangadex.org/title/${manga.id}`,
    kind: kindOf(attributes.originalLanguage),
    publicationStatus: attributes.status,
    chapters: Number.isFinite(lastChapter) && lastChapter > 0 ? Math.floor(lastChapter) : null,
    languages: READABLE_LANGUAGES.filter((readable) => available.has(readable)),
    lang: language,
    synopsisLanguage: synopsis ? (description?.language as Language) : null,
  }
}
