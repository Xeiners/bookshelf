/**
 * Moteur de fusion (« Matched Grouping ») — fonctions pures, testées
 * (`backend/test/extensions.test.ts`).
 *
 * Plusieurs sources publient souvent le même chapitre. On regroupe par langue
 * et numéro ; dans chaque groupe, la meilleure source fournit la ou les
 * versions principales, les autres deviennent des `alternates` : bascule
 * manuelle dans le lecteur, et repli automatique si la principale tombe.
 */
import { compareChapters } from '../modules/chapters/chapters.normalize.js'
import type { MergedChapter, SourcedChapter } from './types.js'

/** « 012 » → « 12 », « 12.50 » → « 12.5 » : deux sources doivent tomber sur la même clé. */
export function canonicalNumber(value: string | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return /^\d+(?:\.\d+)?$/.test(trimmed) ? String(Number(trimmed)) : trimmed
}

/** Complétude des métadonnées : pages connues, équipe créditée, titre, volume. */
export function completeness(chapter: SourcedChapter): number {
  return (chapter.pages > 0 ? 4 : 0) + (chapter.groups.length > 0 ? 2 : 0) + (chapter.title ? 1 : 0) + (chapter.volume ? 1 : 0)
}

/**
 * Ordre de préférence dans un groupe, total et déterministe : priorité de la
 * source (qualité de traduction), complétude, nombre de pages, puis des
 * critères stables (source, date, identifiant) pour qu'aucun ordre d'arrivée
 * des réponses ne change le résultat.
 */
export function rankVersions(priorityOf: (sourceId: string) => number) {
  return (a: SourcedChapter, b: SourcedChapter): number =>
    priorityOf(b.source.id) - priorityOf(a.source.id) ||
    completeness(b) - completeness(a) ||
    b.pages - a.pages ||
    a.source.id.localeCompare(b.source.id) ||
    a.publishedAt.localeCompare(b.publishedAt) ||
    a.id.localeCompare(b.id)
}

/**
 * Fusionne les chapitres de toutes les sources en un flux unique.
 *
 * - Clé de groupe : langue + numéro canonique. Un one-shot (sans numéro)
 *   n'est jamais fusionné : deux one-shots n'ont rien en commun.
 * - La source gagnante garde TOUTES ses versions du groupe (MangaDex en a
 *   souvent plusieurs, d'équipes différentes : le lecteur choisit la bonne
 *   pour suivre la même équipe). Chaque autre source n'y apporte que sa
 *   meilleure version, en `alternates`.
 * - Tri final : ordre de lecture, puis source et identifiant.
 */
export function mergeChapters(chapters: readonly SourcedChapter[], priorityOf: (sourceId: string) => number): MergedChapter[] {
  const rank = rankVersions(priorityOf)
  const groups = new Map<string, SourcedChapter[]>()
  for (const raw of chapters) {
    const chapter = { ...raw, number: canonicalNumber(raw.number) }
    const key = chapter.number === null ? `${chapter.language}:id:${chapter.source.id}:${chapter.id}` : `${chapter.language}:${chapter.number}`
    const group = groups.get(key)
    if (group) group.push(chapter)
    else groups.set(key, [chapter])
  }

  const merged: MergedChapter[] = []
  for (const group of groups.values()) {
    group.sort(rank)
    const winner = group[0]!.source.id
    const alternates: SourcedChapter[] = []
    const seen = new Set<string>([winner])
    for (const version of group) {
      if (seen.has(version.source.id)) continue
      seen.add(version.source.id)
      alternates.push(version)
    }
    for (const version of group) {
      if (version.source.id === winner) merged.push({ ...version, alternates })
    }
  }

  return merged.sort((a, b) => compareChapters(a, b) || a.source.id.localeCompare(b.source.id) || a.id.localeCompare(b.id))
}
