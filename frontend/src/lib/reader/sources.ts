/**
 * Sources de chapitres côté lecteur — fonctions pures, testées
 * (`frontend/test/sources.test.ts`). L'API fusionne déjà les sources : chaque
 * chapitre porte sa version principale et, en `alternates`, ses versions chez
 * les autres sources. Ici, on applique le choix du lecteur.
 */
import type { ChapterSource, ReaderChapter, SourceStatus } from '../../types/reader'

/** Copie hors-ligne d'avant les sources multiples : tout venait de MangaDex. */
export const LEGACY_SOURCE: ChapterSource = { id: 'mangadex', name: 'MangaDex' } // i18n-ignore — nom propre, identique dans toutes les langues

export const sourceOf = (chapter: ReaderChapter): ChapterSource => chapter.source ?? LEGACY_SOURCE

/**
 * Source préférée pour une œuvre : là où une alternative de cette source
 * existe, elle prend la place de la version principale (qui devient à son
 * tour une alternative). Le chapitre suivant reste ainsi chez la même source
 * que le précédent. Sans préférence, ou sans alternative, rien ne change.
 */
export function applySourcePreference(chapters: readonly ReaderChapter[], sourceId: string | null): ReaderChapter[] {
  if (!sourceId) return [...chapters]
  const seen = new Set<string>()
  const result: ReaderChapter[] = []
  for (const chapter of chapters) {
    const alternates = chapter.alternates ?? []
    const preferred = sourceOf(chapter).id === sourceId ? undefined : alternates.find((alt) => sourceOf(alt).id === sourceId)
    const next = preferred
      ? { ...preferred, alternates: [{ ...chapter, alternates: [] }, ...alternates.filter((alt) => alt !== preferred)] }
      : chapter
    // La source gagnante peut avoir plusieurs versions d'un numéro (équipes) :
    // toutes partageaient la même alternative, qui ne doit apparaître qu'une fois.
    if (seen.has(next.id)) continue
    seen.add(next.id)
    result.push(next)
  }
  return result
}

/** Retrouve un chapitre par son id, qu'il soit version principale ou alternative. */
export function findChapter(chapters: readonly ReaderChapter[], id: string | null): ReaderChapter | undefined {
  if (!id) return undefined
  for (const chapter of chapters) {
    if (chapter.id === id) return chapter
    const alternate = chapter.alternates?.find((alt) => alt.id === id)
    if (alternate) {
      // Vue « principale » de l'alternative : les autres versions deviennent SES alternatives.
      return { ...alternate, alternates: [{ ...chapter, alternates: [] }, ...(chapter.alternates ?? []).filter((alt) => alt.id !== id)] }
    }
  }
  return undefined
}

/**
 * Chapitre ouvert chez une autre source que la préférée (reprise d'une
 * position, lien direct) : il est inséré juste après la version dont il est
 * l'alternative, pour que l'ordre de lecture (et `readingOrder(…, keep)`) le
 * trouve à sa place au lieu de le perdre.
 */
export function ensureChapter(chapters: readonly ReaderChapter[], id: string | null): ReaderChapter[] {
  if (!id || chapters.some((chapter) => chapter.id === id)) return [...chapters]
  const host = chapters.findIndex((chapter) => chapter.alternates?.some((alt) => alt.id === id))
  const opened = findChapter(chapters, id)
  if (host === -1 || !opened) return [...chapters]
  return [...chapters.slice(0, host + 1), opened, ...chapters.slice(host + 1)]
}

/** Toutes les sources qui publient ce chapitre, la sienne en premier. */
export function chapterSources(chapter: ReaderChapter | undefined): ChapterSource[] {
  if (!chapter) return []
  const sources = [sourceOf(chapter), ...(chapter.alternates ?? []).map(sourceOf)]
  return sources.filter((source, index) => sources.findIndex((other) => other.id === source.id) === index)
}

/** La version de ce chapitre chez une source donnée, s'il y en a une. */
export function versionFrom(chapter: ReaderChapter, sourceId: string): ReaderChapter | undefined {
  if (sourceOf(chapter).id === sourceId) return chapter
  return chapter.alternates?.find((alt) => sourceOf(alt).id === sourceId)
}

/** Plus d'une source a répondu avec des chapitres : le badge de provenance devient utile. */
export function isMultiSource(sources: readonly SourceStatus[] | undefined): boolean {
  return (sources ?? []).filter((source) => source.status === 'ok' && source.chapters > 0).length > 1
}

/**
 * Site d'une extension Tachiyomi / Mihon (pont Suwayomi côté API) : l'API le
 * publie sous `tachiyomi:<id du site>`, avec le nom du site (« Asura Scans »).
 */
export const isExtensionSource = (source: ChapterSource): boolean => source.id.startsWith('tachiyomi:')

/**
 * Noms des sources qui ont fourni des chapitres, pour les crédits. Un
 * fournisseur qui regroupe plusieurs sites (`tachiyomi`) est crédité par les
 * noms de ses sites présents dans la liste, pas par le sien.
 */
export function creditedSources(sources: readonly SourceStatus[] | undefined, chapters: readonly ReaderChapter[] = []): string[] {
  const sites = new Map<string, Set<string>>()
  for (const chapter of chapters) {
    for (const version of [chapter, ...(chapter.alternates ?? [])]) {
      const { id, name } = sourceOf(version)
      const separator = id.indexOf(':')
      if (separator === -1) continue
      const provider = id.slice(0, separator)
      sites.set(provider, (sites.get(provider) ?? new Set()).add(name))
    }
  }
  const names = (sources ?? [])
    .filter((source) => source.status === 'ok' && source.chapters > 0)
    .flatMap((source) => {
      const own = sites.get(source.id)
      return own && own.size > 0 ? [...own].sort((a, b) => a.localeCompare(b)) : [source.name]
    })
  return names.length > 0 ? names : [LEGACY_SOURCE.name]
}
