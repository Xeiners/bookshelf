import { TtlCache } from '../../lib/cache.js'
import { notFound } from '../../lib/errors.js'
import { preferenceOrder, type Language } from '../../lib/language.js'
import type { Book } from '../books/book.schema.js'
import {
  mangadexGet,
  type MdCollection,
  type MdEntity,
  type MdManga,
  type MdStatistics,
} from './mangadex.client.js'
import { normalizeManga } from './normalize.js'
import { ORIGIN_LANGUAGES, type Origin, type ShelfDefinition } from './shelves.js'
import { resolveTagIds } from './tags.js'

const MINUTE = 60 * 1000

/*
 * Les caches gardent la réponse MangaDex BRUTE, indépendante de la langue :
 * la normalisation (choix du titre, du résumé, des genres) est refaite à chaque
 * requête pour la langue demandée. Basculer FR ↔ EN ne coûte donc aucun appel
 * MangaDex supplémentaire, et le cache n'est jamais dupliqué par langue.
 */
interface RawPage {
  mangas: MdManga[]
  total: number
}

/** Pages d'étagère : le deck en redemande souvent, le classement bouge peu. */
const listCache = new TtlCache<RawPage>({ maxEntries: 400, ttlMs: 15 * MINUTE })
const searchCache = new TtlCache<RawPage>({ maxEntries: 300, ttlMs: 5 * MINUTE })
const mangaCache = new TtlCache<MdManga>({ maxEntries: 2000, ttlMs: 60 * MINUTE })
/** `null` = pas de note connue ; mis en cache aussi pour ne pas redemander. */
const ratingCache = new TtlCache<number | null>({ maxEntries: 5000, ttlMs: 6 * 60 * MINUTE })

export const INCLUDES = ['cover_art', 'author', 'artist'] as const

/**
 * Paramètres communs. `availableTranslatedLanguage` contient la langue demandée
 * ET l'autre : une œuvre lisible seulement en anglais reste proposée à un
 * lecteur francophone (avec ses textes en anglais), au lieu d'amputer le
 * catalogue de la moitié des titres.
 */
export function baseQuery(origin: Origin, language: Language) {
  return {
    'includes': INCLUDES,
    'availableTranslatedLanguage': preferenceOrder(language),
    'originalLanguage': ORIGIN_LANGUAGES[origin],
    'contentRating': ['safe', 'suggestive'],
    'hasAvailableChapters': 'true',
  } as const
}

/** Notes bayésiennes, en un seul appel `/statistics/manga` pour les ids manquants. */
export async function ratingsFor(ids: string[]): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>()
  const missing: string[] = []

  for (const id of ids) {
    const cached = ratingCache.get(id)
    if (cached === undefined) missing.push(id)
    else result.set(id, cached)
  }

  if (missing.length > 0) {
    try {
      const payload = await mangadexGet<MdStatistics>('/statistics/manga', { manga: missing })
      for (const id of missing) {
        const rating = payload.statistics[id]?.rating?.bayesian ?? null
        ratingCache.set(id, rating)
        result.set(id, rating)
      }
    } catch {
      // Une note manquante n'empêche pas d'afficher la carte.
    }
  }

  return result
}

/** Normalise dans la langue demandée ; mémorise aussi chaque œuvre pour `/manga/:id`. */
export async function localize(mangas: MdManga[], language: Language): Promise<Book[]> {
  const ratings = await ratingsFor(mangas.map((manga) => manga.id))
  return mangas.map((manga) => {
    mangaCache.set(manga.id, manga)
    return normalizeManga(manga, ratings.get(manga.id), language)
  })
}

/** MangaDex refuse `offset + limit > 10 000` : au-delà, une liste est considérée finie. */
const MAX_WINDOW = 10_000

export interface CatalogPage {
  books: Book[]
  total: number
  page: number
  /** `true` s'il existe une page suivante exploitable (défilement infini du catalogue). */
  hasMore: boolean
}

const hasNextPage = (page: number, limit: number, total: number) =>
  (page + 1) * limit <= MAX_WINDOW && page * limit < total

export async function listShelf(
  shelf: ShelfDefinition,
  page: number,
  limit: number,
  language: Language,
): Promise<CatalogPage> {
  // La langue ne change pas l'ensemble des œuvres (cf. `baseQuery`) : clé sans langue.
  const { mangas, total } = await listCache.getOrLoad(`${shelf.id}:${page}:${limit}`, async () => {
    const tagIds = await resolveTagIds(shelf.tags)
    const fetchAt = (offset: number) =>
      mangadexGet<MdCollection<MdManga>>('/manga', {
        ...baseQuery(shelf.origin, language),
        'includedTags': tagIds.length > 0 ? tagIds : undefined,
        'order[followedCount]': 'desc',
        limit,
        offset,
      })

    let payload = await fetchAt((page - 1) * limit)

    // Étagère étroite : le front tire des pages au hasard, on reboucle au lieu
    // de renvoyer une page vide (qui ferait croire à une étagère épuisée).
    if (payload.data.length === 0 && payload.total > 0 && page > 1) {
      const pageCount = Math.ceil(payload.total / limit)
      payload = await fetchAt(((page - 1) % pageCount) * limit)
    }

    return { mangas: payload.data, total: payload.total }
  })

  return { books: await localize(mangas, language), total, page, hasMore: hasNextPage(page, limit, total) }
}

/**
 * Recherche MangaDex, réponse BRUTE (liens externes compris : le catalogue
 * agrégé s'en sert pour écarter les doublons). Les doujinshi (œuvres de fans)
 * sont exclus : ils noyaient les vrais titres.
 */
export async function searchMangaRaw(
  query: string,
  page: number,
  limit: number,
  origin: Origin,
  language: Language,
): Promise<RawPage> {
  const term = query.trim().toLowerCase()
  return searchCache.getOrLoad(`${origin}:${page}:${limit}:${term}`, async () => {
    const excluded = await resolveTagIds(['Doujinshi'])
    const payload = await mangadexGet<MdCollection<MdManga>>('/manga', {
      ...baseQuery(origin, language),
      'title': term,
      'excludedTags': excluded.length > 0 ? excluded : undefined,
      'order[relevance]': 'desc',
      limit,
      'offset': (page - 1) * limit,
    })
    return { mangas: payload.data, total: payload.total }
  })
}

export async function searchManga(
  query: string,
  page: number,
  limit: number,
  origin: Origin,
  language: Language,
): Promise<CatalogPage> {
  const { mangas, total } = await searchMangaRaw(query, page, limit, origin, language)
  return { books: await localize(mangas, language), total, page, hasMore: hasNextPage(page, limit, total) }
}

export async function getManga(id: string, language: Language): Promise<Book> {
  const manga = await mangaCache.getOrLoad(id, async () => {
    const payload = await mangadexGet<MdEntity<MdManga>>(`/manga/${id}`, { includes: INCLUDES })
    if (!payload.data) throw notFound()
    return payload.data
  })
  const [book] = await localize([manga], language)
  if (!book) throw notFound()
  return book
}

/** Classements par note : ils bougent peu, 30 min de cache suffisent largement. */
const rankedCache = new TtlCache<MdManga[]>({ maxEntries: 100, ttlMs: 30 * MINUTE })

/**
 * Les 100 œuvres les mieux notées (note bayésienne MangaDex) pour une
 * combinaison de tags (en ET) et un statut de parution — matière première de
 * l'Oracle. Réponse brute, indépendante de la langue, comme les autres caches.
 */
export async function topRated(tagNames: string[], status?: 'completed' | 'ongoing'): Promise<MdManga[]> {
  return rankedCache.getOrLoad(`${tagNames.join('+')}:${status ?? 'any'}`, async () => {
    const tagIds = await resolveTagIds(tagNames)
    const payload = await mangadexGet<MdCollection<MdManga>>('/manga', {
      // La langue n'influe pas sur l'ensemble (fr + en demandés dans tous les cas).
      ...baseQuery('all', 'fr'),
      'includedTags': tagIds.length > 0 ? tagIds : undefined,
      'status': status ? [status] : undefined,
      'order[rating]': 'desc',
      'limit': 100,
    })
    return payload.data
  })
}

/** Taille maximale d'une page `/manga?ids[]=` côté MangaDex. */
export const BATCH_LIMIT = 100

/**
 * Plusieurs œuvres d'un coup, dans la langue demandée : sert à traduire une
 * bibliothèque enregistrée quand l'utilisateur change de langue. Les ids
 * inconnus de MangaDex sont simplement absents de la réponse.
 */
export async function getMangas(ids: string[], language: Language): Promise<Book[]> {
  const unique = [...new Set(ids)].slice(0, BATCH_LIMIT)
  const missing = unique.filter((id) => mangaCache.get(id) === undefined)

  if (missing.length > 0) {
    // Pas de filtre de contenu ni de langue : une œuvre enregistrée doit
    // toujours pouvoir être retrouvée, même si elle ne serait plus proposée.
    const payload = await mangadexGet<MdCollection<MdManga>>('/manga', {
      ids: missing,
      includes: INCLUDES,
      contentRating: ['safe', 'suggestive', 'erotica'],
      limit: BATCH_LIMIT,
    })
    for (const manga of payload.data) mangaCache.set(manga.id, manga)
  }

  const found = unique.map((id) => mangaCache.get(id)).filter((manga): manga is MdManga => manga !== undefined)
  return localize(found, language)
}
