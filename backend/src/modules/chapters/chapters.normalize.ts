import type { Language } from '../../lib/language.js'
import type { MdChapter } from './chapters.client.js'

/** Chapitre tel que le lecteur du front le consomme. */
export interface ReaderChapter {
  id: string
  /** Numéro affiché (« 12 », « 12.5 »), `null` pour un one-shot. */
  number: string | null
  volume: string | null
  title: string | null
  language: Language
  pages: number
  /** Équipes de traduction (scanlation), à créditer. */
  groups: { id: string; name: string }[]
  publishedAt: string
}

export function normalizeChapter(chapter: MdChapter): ReaderChapter {
  const { attributes, relationships } = chapter
  return {
    id: chapter.id,
    number: attributes.chapter?.trim() || null,
    volume: attributes.volume?.trim() || null,
    title: attributes.title?.trim() || null,
    language: attributes.translatedLanguage === 'fr' ? 'fr' : 'en',
    pages: attributes.pages,
    groups: relationships
      .filter((rel) => rel.type === 'scanlation_group' && rel.attributes?.name)
      .map((rel) => ({ id: rel.id, name: rel.attributes?.name ?? '' })),
    publishedAt: attributes.readableAt ?? attributes.publishAt,
  }
}

/** « 12.5 » → 12.5 ; one-shot ou numéro exotique → `null`. */
const numeric = (value: string | null) => {
  const parsed = value === null ? Number.NaN : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Ordre de lecture : numéro de chapitre, puis volume, puis date. MangaDex trie
 * ses numéros comme des chaînes quand le volume manque (« 10 » avant « 9 ») :
 * on retrie numériquement. Les one-shots (sans numéro) passent en tête.
 */
export function compareChapters(a: ReaderChapter, b: ReaderChapter): number {
  const na = numeric(a.number)
  const nb = numeric(b.number)
  if (na !== nb) {
    if (na === null) return -1
    if (nb === null) return 1
    return na - nb
  }
  const va = numeric(a.volume) ?? Number.POSITIVE_INFINITY
  const vb = numeric(b.volume) ?? Number.POSITIVE_INFINITY
  if (va !== vb) return va - vb
  return a.publishedAt.localeCompare(b.publishedAt)
}
