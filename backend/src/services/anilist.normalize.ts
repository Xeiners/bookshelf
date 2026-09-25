import type { Language } from '../lib/language.js'
import type { Book, BookKind, PublicationStatus } from '../modules/books/book.schema.js'
import { cleanDescription } from '../modules/manga/normalize.js'
import { tagLabel } from '../modules/manga/tags.js'
import type { AlMedia, AlStatus } from './anilist.service.js'
import type { TagWeight } from './recommendation/scoring.js'

/**
 * Fiche AniList conservée en base (`CatalogWork.anilist`) : juste ce qu'il faut
 * pour afficher une carte sans rappeler AniList.
 */
export interface StoredAnilist {
  title: { romaji: string | null; english: string | null; native: string | null }
  description: string | null
  cover: string | null
  status: AlStatus | null
  chapters: number | null
  year: number | null
  siteUrl: string
  authors: string[]
}

/** Un tag spoiler ou adulte n'entre ni dans le profil, ni sur la carte. */
const MAX_TAGS = 12
const MAX_CATEGORIES = 4
const MAX_AUTHORS = 3

/** Genres AniList sans équivalent direct dans la liste blanche des libellés. */
const GENRE_ALIASES: Record<string, string> = { 'Mahou Shoujo': 'Magical Girls' }

const STATUS: Record<AlStatus, PublicationStatus | null> = {
  FINISHED: 'completed',
  RELEASING: 'ongoing',
  HIATUS: 'hiatus',
  CANCELLED: 'cancelled',
  NOT_YET_RELEASED: null,
}

export function kindOfCountry(country: string): BookKind {
  if (country === 'KR') return 'manhwa'
  if (country === 'CN' || country === 'TW') return 'manhua'
  return 'manga'
}

/** Tags retenus pour le moteur : pertinents, sans spoiler ni contenu adulte. */
export function usableTags(media: AlMedia): TagWeight[] {
  return media.tags
    .filter((tag) => !tag.isMediaSpoiler && !tag.isAdult)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_TAGS)
    .map(({ name, rank }) => ({ name, rank }))
}

/** Scénario et dessin d'abord ; « Original Story » (romancier) ensuite. */
function authorsOf(media: AlMedia): string[] {
  const edges = [...media.staff.edges].sort((a, b) => rolePriority(a.role) - rolePriority(b.role))
  const names = edges.map((edge) => edge.node.name.full).filter((name): name is string => Boolean(name))
  return [...new Set(names)].slice(0, MAX_AUTHORS)
}

function rolePriority(role: string): number {
  if (/story\s*&\s*art/i.test(role)) return 0
  if (/^(story|art)\b/i.test(role)) return 1
  if (/original/i.test(role)) return 2
  return 3
}

export function toStoredAnilist(media: AlMedia): StoredAnilist {
  return {
    title: media.title,
    description: media.description,
    cover: media.coverImage.extraLarge ?? media.coverImage.large,
    status: media.status,
    chapters: media.chapters,
    year: media.startDate.year,
    siteUrl: media.siteUrl,
    authors: authorsOf(media),
  }
}

/** Les résumés AniList finissent souvent par « (Source: …) » et contiennent du HTML léger. */
export function cleanAnilistDescription(raw: string | null): string {
  if (!raw) return ''
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\(\s*source:[^)]*\)/gi, '')
    .replace(/\n\s*(?:note|notes)\s*:[\s\S]*$/i, '')
  return cleanDescription(text)
}

/** Libellés affichés : genres puis tags, traduits via la liste blanche commune. */
export function categoriesOf(genres: string[], tags: TagWeight[], language: Language): string[] {
  const labels = [...genres.map((genre) => GENRE_ALIASES[genre] ?? genre), ...tags.map((tag) => tag.name)]
    .map((name) => tagLabel(name, language))
    .filter((label): label is string => Boolean(label))
  return [...new Set(labels)].slice(0, MAX_CATEGORIES)
}

/**
 * Œuvre connue d'AniList seulement (absente de MangaDex) → `Book`. AniList n'a
 * de textes qu'en anglais : le résumé est marqué `synopsisLanguage: 'en'`,
 * comme le repli MangaDex, et le front l'affiche avec la bonne langue.
 */
export function anilistBook(
  anilistId: number,
  stored: StoredAnilist,
  country: string,
  genres: string[],
  tags: TagWeight[],
  meanScore: number | null,
  language: Language,
): Book {
  const { romaji, english, native } = stored.title
  const title = english ?? romaji ?? native ?? (language === 'fr' ? 'Sans titre' : 'Untitled')
  const alternate = romaji && romaji.toLowerCase() !== title.toLowerCase() ? romaji : native
  const synopsis = cleanAnilistDescription(stored.description)

  return {
    id: `al-${anilistId}`,
    title,
    subtitle: alternate && alternate !== title ? alternate : null,
    authors: stored.authors,
    cover: stored.cover,
    synopsis,
    categories: categoriesOf(genres, tags, language),
    rating: meanScore === null ? null : Math.round(meanScore / 2) / 10,
    ratingsCount: 0,
    pages: null,
    year: stored.year,
    publisher: null,
    previewLink: stored.siteUrl,
    kind: kindOfCountry(country),
    publicationStatus: stored.status ? STATUS[stored.status] : null,
    chapters: stored.chapters,
    languages: [],
    lang: language,
    synopsisLanguage: synopsis ? 'en' : null,
  }
}
