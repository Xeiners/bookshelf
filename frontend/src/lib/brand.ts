/** Nom de marque : identique dans toutes les langues, jamais traduit. */
export const BRAND = 'Bookshelf'

/** Sources de données citées dans l'interface (noms propres, jamais traduits). */
export const SOURCE_NAME = {
  mangadex: 'MangaDex', // i18n-ignore : nom propre
  openLibrary: 'Open Library', // i18n-ignore : nom propre
} as const

/**
 * Source d'une fiche d'après son lien externe : MangaDex, Open Library (anciens
 * livres), sinon le nom de domaine (fiches plus anciennes encore, restées en
 * bibliothèque).
 */
export function sourceOfLink(link: string): string {
  if (link.includes('mangadex.org')) return SOURCE_NAME.mangadex
  if (link.includes('openlibrary.org')) return SOURCE_NAME.openLibrary
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return link
  }
}
