import type { Language } from '../../lib/language.js'

/**
 * Origine éditoriale, déduite de la langue originale sur MangaDex :
 * japonais → manga, coréen → manhwa. Le manhua (chinois) n'est pas proposé.
 */
export type Origin = 'all' | 'manga' | 'manhwa'

export const ORIGIN_LANGUAGES: Record<Origin, string[]> = {
  all: ['ja', 'ko'],
  manga: ['ja'],
  manhwa: ['ko'],
}

export interface ShelfDefinition {
  id: string
  label: Record<Language, string>
  origin: Origin
  /** Noms anglais des tags MangaDex, résolus en UUID au démarrage (cf. `tags.ts`). */
  tags: string[]
}

/**
 * Étagères du deck et du catalogue. Le front a ses propres libellés dans ses
 * dictionnaires (`frontend/src/i18n/`) : l'id est le contrat, les filtres restent ici.
 */
export const SHELVES: ShelfDefinition[] = [
  { id: 'tendances', label: { fr: 'Tendances', en: 'Trending' }, origin: 'all', tags: [] },
  { id: 'manga', label: { fr: 'Manga', en: 'Manga' }, origin: 'manga', tags: [] },
  { id: 'manhwa', label: { fr: 'Manhwa', en: 'Manhwa' }, origin: 'manhwa', tags: [] },
  { id: 'action', label: { fr: 'Action', en: 'Action' }, origin: 'all', tags: ['Action'] },
  { id: 'romance', label: { fr: 'Romance', en: 'Romance' }, origin: 'all', tags: ['Romance'] },
  { id: 'fantasy', label: { fr: 'Fantasy', en: 'Fantasy' }, origin: 'all', tags: ['Fantasy'] },
  { id: 'isekai', label: { fr: 'Isekai', en: 'Isekai' }, origin: 'all', tags: ['Isekai'] },
  { id: 'tranche-de-vie', label: { fr: 'Tranche de vie', en: 'Slice of life' }, origin: 'all', tags: ['Slice of Life'] },
  { id: 'comedie', label: { fr: 'Comédie', en: 'Comedy' }, origin: 'all', tags: ['Comedy'] },
  { id: 'mystere', label: { fr: 'Mystère', en: 'Mystery' }, origin: 'all', tags: ['Mystery'] },
  { id: 'horreur', label: { fr: 'Horreur', en: 'Horror' }, origin: 'all', tags: ['Horror'] },
  { id: 'psychologique', label: { fr: 'Psychologique', en: 'Psychological' }, origin: 'all', tags: ['Psychological'] },
  { id: 'arts-martiaux', label: { fr: 'Arts martiaux', en: 'Martial arts' }, origin: 'all', tags: ['Martial Arts'] },
  { id: 'sport', label: { fr: 'Sport', en: 'Sports' }, origin: 'all', tags: ['Sports'] },
]

export function findShelf(id: string): ShelfDefinition | undefined {
  return SHELVES.find((shelf) => shelf.id === id)
}
