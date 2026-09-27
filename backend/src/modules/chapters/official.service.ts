import { TtlCache } from '../../lib/cache.js'
import { HttpError } from '../../lib/errors.js'
import type { Language } from '../../lib/language.js'
import { fetchExternalLinks, type AlExternalLink } from '../../services/anilist.service.js'
import { anilistIdFor } from '../../services/catalog.service.js'
import { mangaLinks } from '../manga/manga.service.js'
import { buildOfficialPlatforms, type OfficialPlatform, type PlatformSources } from './official.normalize.js'

export type { OfficialPlatform }

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

/** UUID MangaDex, ou `al-<id>` : œuvre connue d'AniList seulement. */
export const OFFICIAL_WORK_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|al-\d{1,9})$/i

/**
 * Liens bruts par œuvre, indépendants de la langue : ils changent rarement,
 * 24 h de cache. Si AniList ou MangaDex a manqué, 10 min seulement.
 */
const sourcesCache = new TtlCache<PlatformSources & { complete: boolean }>({ maxEntries: 2000, ttlMs: DAY })

async function loadSources(workId: string): Promise<PlatformSources & { complete: boolean }> {
  let anilistId: number | null = null
  let mangadexLinks: PlatformSources['mangadexLinks'] = null
  let originalLanguage: string | null = null
  let complete = true

  const al = /^al-(\d+)$/i.exec(workId)
  if (al) {
    anilistId = Number(al[1])
  } else {
    try {
      const manga = await mangaLinks(workId)
      mangadexLinks = manga.links
      originalLanguage = manga.originalLanguage
      const linked = Number(manga.links.al)
      if (Number.isInteger(linked) && linked > 0) anilistId = linked
    } catch (error) {
      // Œuvre inconnue : une vraie 404. Panne MangaDex : on continue avec AniList.
      if (error instanceof HttpError && error.status === 404) throw error
      complete = false
    }
    // Jointure du catalogue quand MangaDex ne cite pas AniList.
    anilistId ??= await anilistIdFor(workId).catch(() => null)
  }

  let anilist: AlExternalLink[] = []
  if (anilistId !== null) {
    try {
      anilist = await fetchExternalLinks(anilistId)
    } catch {
      complete = false
    }
  }
  return { anilist, mangadexLinks, originalLanguage, complete }
}

/** Plateformes officielles où lire l'œuvre, triées pour la langue demandée. */
export async function officialPlatforms(workId: string, language: Language): Promise<OfficialPlatform[]> {
  const sources = await sourcesCache.getOrLoad(
    workId,
    () => loadSources(workId),
    (value) => (value.complete ? DAY : 10 * MINUTE),
  )
  return buildOfficialPlatforms(sources, language)
}

/**
 * Variante qui n'échoue jamais et ne fait pas attendre au-delà de `timeoutMs` :
 * pour enrichir une autre réponse (liste des chapitres) sans la retarder.
 */
export async function officialPlatformsSoft(workId: string, language: Language, timeoutMs = 4_000): Promise<OfficialPlatform[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<OfficialPlatform[]>((resolve) => {
    timer = setTimeout(() => resolve([]), timeoutMs)
  })
  try {
    return await Promise.race([officialPlatforms(workId, language).catch(() => []), timeout])
  } finally {
    clearTimeout(timer)
  }
}
