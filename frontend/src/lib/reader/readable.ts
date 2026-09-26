import type { Book } from '../../types/book'

const MANGADEX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Le lecteur intégré sait-il ouvrir ce titre ? Il faut une fiche MangaDex (les
 * œuvres connues d'AniList seulement, `al-…`, et les anciens livres Open
 * Library n'ont pas de chapitres à lire).
 */
export const isReadable = (book: Book) => MANGADEX_ID.test(book.id) && book.kind !== 'book'
