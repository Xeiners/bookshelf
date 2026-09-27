import { TtlCache } from '../../lib/cache.js'
import type { Language } from '../../lib/language.js'
import { sourceAggregator } from '../../extensions/index.js'
import type { AggregatedList, AggregatedPages, SourceStatus } from '../../extensions/aggregator.js'
import type { MergedChapter, Quality } from '../../extensions/types.js'
import { officialPlatformsSoft, type OfficialPlatform } from './official.service.js'

export type { Quality }

const MINUTE = 60 * 1000

export interface ChapterList {
  mangaId: string
  /** Langue réellement servie : celle demandée, ou l'autre si elle n'a aucun chapitre. */
  language: Language
  /** Nombre de chapitres par langue, pour proposer la bascule FR ↔ EN. */
  available: Record<Language, number>
  /** État de chaque source pour cette œuvre (badge de provenance, sélecteur de source). */
  sources: SourceStatus[]
  chapters: MergedChapter[]
  /**
   * Plateformes officielles (MANGA Plus, WEBTOON, Tappytoon…). Surtout utiles
   * quand `chapters` est vide : titre sous licence, sans page hébergée.
   */
  officialPlatforms: OfficialPlatform[]
}

/**
 * Flux fusionné, indépendant de la langue demandée (fr + en en une fois) :
 * bascule FR ↔ EN gratuite. Une source a manqué ? Le résultat partiel n'est
 * gardé qu'une minute, pour qu'elle réapparaisse vite une fois rétablie.
 */
const feedCache = new TtlCache<AggregatedList>({ maxEntries: 300, ttlMs: 10 * MINUTE })
const PARTIAL_TTL_MS = MINUTE

export async function listChapters(mangaId: string, language: Language): Promise<ChapterList> {
  // En parallèle : les liens officiels ne retardent jamais la liste (4 s au plus, jamais d'erreur).
  const [feed, officialPlatforms] = await Promise.all([
    feedCache.getOrLoad(
      mangaId,
      () => sourceAggregator.fetchChapterList(mangaId),
      (value) => (value.partial ? PARTIAL_TTL_MS : 10 * MINUTE),
    ),
    officialPlatformsSoft(mangaId, language),
  ])

  const available: Record<Language, number> = { fr: 0, en: 0 }
  for (const chapter of feed.chapters) available[chapter.language] += 1

  const other: Language = language === 'fr' ? 'en' : 'fr'
  const served = available[language] > 0 || available[other] === 0 ? language : other
  return {
    mangaId,
    language: served,
    available,
    sources: feed.sources,
    chapters: feed.chapters.filter((chapter) => chapter.language === served),
    officialPlatforms,
  }
}

/** Pages d'un chapitre, avec repli sur les versions des autres sources (`alternates`). */
export function listPages(chapterId: string, quality: Quality, alternates: readonly string[]): Promise<AggregatedPages> {
  return sourceAggregator.fetchPages(chapterId, quality, alternates)
}
