/**
 * Service Open Library.
 *
 * Google Books a été écarté : sans clé API, son endpoint renvoie un 429 permanent
 * (quota du projet anonyme partagé). Open Library est gratuite, sans clé, sans
 * quota, et répond `Access-Control-Allow-Origin: *`.
 *
 * Deux endpoints : /search.json pour les listes, /works/{id}.json pour le
 * synopsis, hydraté à la demande (cf. `fetchSynopsis`).
 */
import type { Book } from '../types/book'
import { stripHtml } from '../lib/format'

const SEARCH_ENDPOINT = 'https://openlibrary.org/search.json'
const WORKS_ENDPOINT = 'https://openlibrary.org/works'
const COVERS_ENDPOINT = 'https://covers.openlibrary.org/b/id'

const SEARCH_FIELDS = [
  'key',
  'title',
  'subtitle',
  'author_name',
  'cover_i',
  'first_publish_year',
  'subject',
  'number_of_pages_median',
  'ratings_average',
  'ratings_count',
  'first_sentence',
  'publisher',
].join(',')

/** Profondeur de pagination : `sort=rating` garde des titres solides jusque-là. */
const MAX_PAGE = 6
const PAGE_SIZE = 24

export interface Shelf {
  id: string
  label: string
  query: string
}

/** Étagères thématiques — toutes vérifiées comme non vides côté API. */
export const SHELVES: Shelf[] = [
  { id: 'fiction', label: 'Romans cultes', query: 'subject:fiction' },
  { id: 'scifi', label: 'Science-fiction', query: 'subject:science_fiction' },
  { id: 'fantasy', label: 'Fantasy', query: 'subject:fantasy' },
  { id: 'crime', label: 'Polar', query: 'subject:detective_and_mystery_stories' },
  { id: 'philosophy', label: 'Philosophie', query: 'subject:philosophy' },
  { id: 'history', label: 'Histoire', query: 'subject:history' },
  { id: 'psychology', label: 'Psychologie', query: 'subject:psychology' },
  { id: 'biography', label: 'Biographies', query: 'subject:biography' },
  { id: 'poetry', label: 'Poésie', query: 'subject:poetry' },
  { id: 'art', label: 'Art & design', query: 'subject:art' },
  { id: 'comics', label: 'BD & romans graphiques', query: 'subject:graphic_novels' },
  { id: 'adventure', label: 'Aventure', query: 'subject:adventure_stories' },
]

interface OpenLibraryDoc {
  key: string
  title?: string
  subtitle?: string
  author_name?: string[]
  cover_i?: number
  first_publish_year?: number
  subject?: string[]
  number_of_pages_median?: number
  ratings_average?: number
  ratings_count?: number
  first_sentence?: string | string[]
  publisher?: string[]
}

interface SearchResponse {
  numFound?: number
  docs?: OpenLibraryDoc[]
}

/** Sujets parasites d'Open Library (métadonnées internes, mentions d'accessibilité). */
const SUBJECT_BLOCKLIST =
  /accessible book|protected daisy|in library|large type|overdrive|lending library|internet archive|open library|reading level|fiction in |^\d/i

/** Traduction des sujets les plus fréquents pour une UI 100 % francophone. */
const SUBJECT_FR: Record<string, string> = {
  fiction: 'Fiction',
  fantasy: 'Fantasy',
  'science fiction': 'Science-fiction',
  'juvenile fiction': 'Jeunesse',
  'young adult fiction': 'Young adult',
  history: 'Histoire',
  philosophy: 'Philosophie',
  psychology: 'Psychologie',
  biography: 'Biographie',
  autobiography: 'Autobiographie',
  poetry: 'Poésie',
  drama: 'Théâtre',
  adventure: 'Aventure',
  'adventure stories': 'Aventure',
  'love stories': 'Romance',
  romance: 'Romance',
  'detective and mystery stories': 'Policier',
  mystery: 'Mystère',
  thriller: 'Thriller',
  horror: 'Horreur',
  'graphic novels': 'Roman graphique',
  comics: 'BD',
  art: 'Art',
  economics: 'Économie',
  politics: 'Politique',
  religion: 'Religion',
  science: 'Science',
  cooking: 'Cuisine',
  travel: 'Voyage',
  war: 'Guerre',
  friendship: 'Amitié',
  magic: 'Magie',
}

function prettifySubject(subject: string): string {
  const key = subject.toLowerCase().trim()
  const translated = SUBJECT_FR[key]
  if (translated) return translated
  return subject.charAt(0).toUpperCase() + subject.slice(1)
}

/** Les `subject` d'Open Library sont bruités : on filtre, déduplique, traduit. */
function cleanSubjects(subjects: string[] | undefined): string[] {
  if (!subjects) return []
  const seen = new Set<string>()
  const output: string[] = []

  for (const subject of subjects) {
    const trimmed = subject.trim()
    if (trimmed.length < 3 || trimmed.length > 26) continue
    if (/[:=(){}]/.test(trimmed)) continue
    if (SUBJECT_BLOCKLIST.test(trimmed)) continue

    const pretty = prettifySubject(trimmed)
    const dedupeKey = pretty.toLowerCase()
    if (seen.has(dedupeKey)) continue

    seen.add(dedupeKey)
    output.push(pretty)
    if (output.length === 4) break
  }

  return output
}

function firstSentence(value: string | string[] | undefined): string {
  if (!value) return ''
  const raw = Array.isArray(value) ? (value[0] ?? '') : value
  return stripHtml(raw)
}

export function coverUrl(coverId: number, size: 'S' | 'M' | 'L' = 'L'): string {
  return `${COVERS_ENDPOINT}/${coverId}-${size}.jpg`
}

function normalize(doc: OpenLibraryDoc): Book | null {
  // Sans titre, sans auteur ou sans visuel, la carte ne tient pas debout.
  if (!doc.title || !doc.key || !doc.author_name?.length || !doc.cover_i) return null

  const rating = doc.ratings_average
  const id = doc.key.replace('/works/', '')

  return {
    id,
    title: doc.title.trim(),
    subtitle: doc.subtitle?.trim() || null,
    authors: doc.author_name.slice(0, 3),
    cover: coverUrl(doc.cover_i, 'L'),
    // Le vrai résumé arrive via `fetchSynopsis` ; la 1re phrase sert de teaser.
    synopsis: firstSentence(doc.first_sentence),
    categories: cleanSubjects(doc.subject),
    rating: typeof rating === 'number' ? Math.round(rating * 10) / 10 : null,
    ratingsCount: doc.ratings_count ?? 0,
    pages: doc.number_of_pages_median ?? null,
    year: doc.first_publish_year ?? null,
    publisher: doc.publisher?.[0] ?? null,
    previewLink: `https://openlibrary.org${doc.key}`,
  }
}

export function randomPage(): number {
  return 1 + Math.floor(Math.random() * MAX_PAGE)
}

export interface FetchShelfOptions {
  page?: number
  limit?: number
  signal?: AbortSignal
}

/** Récupère une page d'une étagère, triée par note moyenne. */
export async function fetchShelf(shelf: Shelf, options: FetchShelfOptions = {}): Promise<Book[]> {
  const { page = randomPage(), limit = PAGE_SIZE, signal } = options

  const params = new URLSearchParams({
    q: shelf.query,
    fields: SEARCH_FIELDS,
    sort: 'rating',
    limit: String(limit),
    page: String(page),
  })

  const response = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`, { signal })
  if (!response.ok) throw new Error(`Open Library a répondu ${response.status}`)

  const payload = (await response.json()) as SearchResponse
  const books: Book[] = []

  for (const doc of payload.docs ?? []) {
    const book = normalize(doc)
    if (book) books.push(book)
  }

  return books
}

export interface SearchOptions {
  limit?: number
  signal?: AbortSignal
}

/**
 * Recherche plein texte. Volontairement sans `sort=rating` : sur une requête
 * libre, trier par note écrase la pertinence et remonte des titres hors sujet.
 */
export async function searchBooks(query: string, options: SearchOptions = {}): Promise<Book[]> {
  const term = query.trim()
  if (term.length < 2) return []

  const { limit = 20, signal } = options
  const params = new URLSearchParams({
    q: term,
    fields: SEARCH_FIELDS,
    limit: String(limit),
  })

  const response = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`, { signal })
  if (!response.ok) throw new Error(`Open Library a répondu ${response.status}`)

  const payload = (await response.json()) as SearchResponse
  const books: Book[] = []

  for (const doc of payload.docs ?? []) {
    const book = normalize(doc)
    if (book) books.push(book)
  }

  return books
}

const synopsisCache = new Map<string, string>()

/** Nettoie le markdown / le bloc « ---- [source] » propre à Open Library. */
function cleanDescription(raw: string): string {
  const body = raw.split(/\n\s*-{3,}\s*\n?/)[0] ?? raw
  return stripHtml(
    body
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\[\d+\]/g, '$1')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1'),
  )
}

/**
 * Hydrate le synopsis d'un livre (endpoint /works). Mis en cache mémoire :
 * le deck préchauffe les cartes à venir, on ne paie jamais deux fois.
 */
export async function fetchSynopsis(bookId: string, signal?: AbortSignal): Promise<string> {
  const cached = synopsisCache.get(bookId)
  if (cached !== undefined) return cached

  const response = await fetch(`${WORKS_ENDPOINT}/${bookId}.json`, { signal })
  if (!response.ok) throw new Error(`Synopsis indisponible (${response.status})`)

  const payload = (await response.json()) as { description?: string | { value?: string } }
  const raw =
    typeof payload.description === 'string'
      ? payload.description
      : (payload.description?.value ?? '')

  const synopsis = cleanDescription(raw)
  // On mémorise même une chaîne vide : inutile de re-tenter un livre sans résumé.
  synopsisCache.set(bookId, synopsis)
  return synopsis
}

export function getCachedSynopsis(bookId: string): string | undefined {
  return synopsisCache.get(bookId)
}
