import type { Book } from '../types/book'
import type { CloudBook, CloudBookPatch } from '../types/novel'

/**
 * Roman du compte vu comme un `Book` : `BookCover` et ses replis (couverture
 * typographique si l'image manque) servent tels quels.
 */
export function novelAsBook(book: CloudBook): Book {
  return {
    id: `novel:${book.id}`,
    title: book.title,
    subtitle: null,
    authors: book.author ? book.author.split(',').map((name) => name.trim()).filter(Boolean) : [],
    cover: book.coverUrl,
    synopsis: book.synopsis,
    categories: [],
    rating: null,
    ratingsCount: 0,
    pages: book.pages,
    year: book.year,
    publisher: book.publisher,
    previewLink: null,
    kind: 'book',
  }
}

/** Hôtes de couverture acceptés par l'API (`PATCH /api/books/:id`). */
const COVER_HOSTS = new Set(['covers.openlibrary.org', 'books.google.com', 'books.googleusercontent.com'])

function acceptedCover(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && COVER_HOSTS.has(parsed.hostname) ? parsed.href : null
  } catch {
    return null
  }
}

/** Fiche en ligne choisie (résultat de recherche) → correction de la fiche d'un roman. */
export function patchFromRecord(record: Book): CloudBookPatch {
  const cover = acceptedCover(record.cover)
  return {
    title: record.title.slice(0, 500),
    author: record.authors.slice(0, 3).join(', ') || null,
    ...(record.synopsis && { synopsis: record.synopsis.slice(0, 10_000) }),
    ...(cover && { coverUrl: cover }),
    ...(record.publisher && { publisher: record.publisher.slice(0, 200) }),
    ...(record.year !== null && { year: record.year }),
    ...(record.pages !== null && { pages: record.pages }),
  }
}

/** `true` si la couverture vient d'une fiche en ligne (et non du fichier). */
export const hasExternalCover = (book: CloudBook) => !!book.coverUrl && /^https?:/.test(book.coverUrl)
