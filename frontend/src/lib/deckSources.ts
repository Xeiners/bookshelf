/**
 * Ce que montre le deck de Découverte : plusieurs types cochés à la fois
 * (manga, manhwa, manhua, romans) — pur, testé (`frontend/test/deckSources.test.ts`).
 */

export type DeckSource = 'manga' | 'manhwa' | 'manhua' | 'novel'
/** Origines du catalogue MangaDex (les romans viennent d'Open Library). */
export type CatalogOrigin = Exclude<DeckSource, 'novel'>

/** Ordre de présentation, et ordre canonique d'une sélection. */
export const DECK_SOURCES: readonly DeckSource[] = ['manga', 'manhwa', 'manhua', 'novel']
/** Par défaut : tout le catalogue manga, comme avant les romans. */
export const DEFAULT_SOURCES: readonly DeckSource[] = ['manga', 'manhwa', 'manhua']

const isSource = (value: unknown): value is DeckSource => DECK_SOURCES.includes(value as DeckSource)

/** Sélection enregistrée (localStorage, autre version) → sélection valide, jamais vide. */
export function sanitizeSources(value: unknown): DeckSource[] {
  const picked = Array.isArray(value) ? DECK_SOURCES.filter((source) => value.some((item) => item === source && isSource(item))) : []
  return picked.length > 0 ? picked : [...DEFAULT_SOURCES]
}

/** Coche ou décoche un type. Le dernier coché reste coché : un deck vide n'a pas de sens. */
export function toggleSource(sources: readonly DeckSource[], source: DeckSource): DeckSource[] {
  const selected = sources.includes(source)
  if (selected && sources.length === 1) return [...sources]
  return DECK_SOURCES.filter((item) => (item === source ? !selected : sources.includes(item)))
}

export const sameSources = (a: readonly DeckSource[], b: readonly DeckSource[]) =>
  a.length === b.length && a.every((source) => b.includes(source))

/** Origines MangaDex cochées. */
export const catalogOrigins = (sources: readonly DeckSource[]): CatalogOrigin[] =>
  sources.filter((source): source is CatalogOrigin => source !== 'novel')

/** Id d'une fiche de roman (Open Library, Google Books), par opposition à un UUID MangaDex. */
export const isNovelId = (id: string) => /^(ol|gb):/.test(id)

/** Cartes déjà dans la file, réparties par source : chaque API ne reçoit que les siennes. */
export function splitSeen(ids: readonly string[]): { catalog: string[]; novel: string[] } {
  const catalog: string[] = []
  const novel: string[] = []
  for (const id of ids) (isNovelId(id) ? novel : catalog).push(id)
  return { catalog, novel }
}

/** Mêle deux fournées une carte sur deux, le reste de la plus longue à la fin. */
export function interleave<T>(first: readonly T[], second: readonly T[]): T[] {
  const mixed: T[] = []
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    if (index < first.length) mixed.push(first[index]!)
    if (index < second.length) mixed.push(second[index]!)
  }
  return mixed
}
