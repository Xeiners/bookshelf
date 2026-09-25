/** Nom de marque : identique dans toutes les langues, jamais traduit. */
export const BRAND = 'Bookshelf'

/** Sources de données citées dans l'interface (noms propres, jamais traduits). */
export const SOURCE_NAME = {
  mangadex: 'MangaDex', // i18n-ignore : nom propre
  openLibrary: 'Open Library', // i18n-ignore : nom propre
  anilist: 'AniList', // i18n-ignore : nom propre
} as const

/** Source d'une fiche d'après son lien externe (deck : MangaDex ou AniList). */
export function sourceOfLink(link: string): string {
  if (link.includes('mangadex.org')) return SOURCE_NAME.mangadex
  if (link.includes('anilist.co')) return SOURCE_NAME.anilist
  return SOURCE_NAME.openLibrary
}
