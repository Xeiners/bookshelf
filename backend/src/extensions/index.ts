import { config } from '../config.js'
import { titleAliases } from '../modules/manga/manga.service.js'
import { SourceAggregatorService } from './aggregator.js'
import { createConsumetProvider } from './providers/consumet.provider.js'
import { createKavitaProvider } from './providers/kavita.provider.js'
import { createKomgaProvider } from './providers/komga.provider.js'
import { mangadexProvider } from './providers/mangadex.provider.js'
import { providerLogger } from './providers/http.js'
import { createOpenComicStreamProvider } from './providers/openComicStream.provider.js'
import { createSuwayomiClient } from './providers/suwayomi.client.js'
import { createTachiyomiBridgeProvider } from './providers/tachiyomiBridge.provider.js'
import { scheduleExtensionSync } from './providers/tachiyomiExtensions.js'
import { SourceRegistry } from './registry.js'
import { normalizeTitle } from './titleMatch.js'

/*
 * Câblage des sources de chapitres. MangaDex est toujours actif ; les autres
 * ne s'enregistrent que si leur URL est configurée, le pont Tachiyomi que si
 * `TACHIYOMI_BRIDGE_ENABLED=true` (cf. config.ts, .env.example).
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

/*
 * Extensions Tachiyomi / Mihon, via le pont Suwayomi. Un pont absent ou lent
 * ne bloque rien : chaque appel est borné, et le disjoncteur de l'agrégateur
 * cesse de l'interroger après trois échecs d'affilée.
 */
const { tachiyomi } = config.sources
if (tachiyomi.enabled) {
  const log = providerLogger('Tachiyomi')
  const client = createSuwayomiClient({ ...tachiyomi, userAgent: config.mangadexUserAgent, log })
  const provider = createTachiyomiBridgeProvider({ ...tachiyomi, client, userAgent: config.mangadexUserAgent, log })
  sourceRegistry.register(provider)
  if (config.env !== 'test') {
    scheduleExtensionSync(client, tachiyomi.extensions, { log, onSynced: () => provider.forgetSources() })
  }
}

/**
 * Tous les noms connus d'une œuvre sur MangaDex (titre principal et
 * alternatifs de toutes langues : « L'Attaque des Titans », « Shingeki no
 * Kyojin »…), dédoublonnés après normalisation.
 */
async function allTitles(mangaId: string): Promise<string[]> {
  const titles = await titleAliases(mangaId).catch(() => [])
  const seen = new Set<string>()
  return titles.filter((title) => {
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
