import { config } from '../config.js'
import { titleAliases } from '../modules/manga/manga.service.js'
import { anilistTitles } from '../services/catalog.service.js'
import { SourceAggregatorService } from './aggregator.js'
import { createConsumetProvider } from './providers/consumet.provider.js'
import { createKavitaProvider } from './providers/kavita.provider.js'
import { createKomgaProvider } from './providers/komga.provider.js'
import { mangadexProvider } from './providers/mangadex.provider.js'
import { createOpenComicStreamProvider } from './providers/openComicStream.provider.js'
import { SourceRegistry } from './registry.js'
import { normalizeTitle } from './titleMatch.js'

/*
 * Câblage des sources de chapitres. MangaDex est toujours actif ; les autres
 * ne s'enregistrent que si leur URL est configurée (cf. config.ts, .env.example).
 */

export const sourceRegistry = new SourceRegistry().register(mangadexProvider)

const { consumet, openComic } = config.sources
if (consumet) sourceRegistry.register(createConsumetProvider({ ...consumet, userAgent: config.mangadexUserAgent }))
if (openComic) {
  const library = { ...openComic, userAgent: config.mangadexUserAgent }
  sourceRegistry.register(
    openComic.kind === 'komga'
      ? createKomgaProvider(library)
      : openComic.kind === 'kavita'
        ? createKavitaProvider(library)
        : createOpenComicStreamProvider(library),
  )
}

/**
 * Tous les noms connus d'une œuvre : AniList (anglais, romaji, synonymes —
 * souvent ceux qu'emploient les sites tiers) puis MangaDex (titres de toutes
 * langues : « L'Attaque des Titans », « Shingeki no Kyojin »…). Une panne
 * d'une des deux listes n'empêche pas l'autre de servir.
 */
async function allTitles(mangaId: string): Promise<string[]> {
  const [anilist, mangadex] = await Promise.all([
    anilistTitles(mangaId).catch(() => []),
    titleAliases(mangaId).catch(() => []),
  ])
  const seen = new Set<string>()
  return [...anilist, ...mangadex].filter((title) => {
    const key = normalizeTitle(title)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const sourceAggregator = new SourceAggregatorService(sourceRegistry, {
  resolveAliases: allTitles,
  relayUrl: (chapterKey, index, { count, alternates }) => {
    const query = new URLSearchParams({ n: String(count) })
    if (alternates.length > 0) query.set('alt', alternates.join(','))
    return `${config.publicApiBase}/proxy/page/${chapterKey}/${index}?${query}`
  },
  log: (message) => console.warn(`[sources] ${message}`),
})
