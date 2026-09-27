import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { MAX_ALTERNATES } from '../../extensions/aggregator.js'
import { decodeChapterKey, MANGADEX_SOURCE_ID } from '../../extensions/chapterKey.js'
import { sourceAggregator } from '../../extensions/index.js'
import { badRequest, upstreamError } from '../../lib/errors.js'
import { relayImage } from './proxy.fetch.js'

/**
 * Relais d'images des sources externes (StreamProxyController). Même rôle
 * que le relais MangaDex : même origine pour le navigateur (cache du Service
 * Worker, lecture hors-ligne), et les en-têtes de provenance exigés par le
 * serveur d'images (Referer, User-Agent) sont ajoutés ici, côté serveur.
 *
 * Le client ne fournit JAMAIS d'URL : seulement un chapitre et un numéro de
 * page, que l'agrégateur résout auprès de la source. Pas de proxy ouvert.
 */
export const proxyRouter = Router()

const isRelayedKey = (key: string) => {
  const decoded = decodeChapterKey(key)
  return decoded !== null && decoded.sourceId !== MANGADEX_SOURCE_ID
}

const PageQuery = z.object({
  /** Nombre de pages de la version demandée (cf. `relayUrl`). */
  n: z.coerce.number().int().positive().max(10_000).optional().catch(undefined),
  alt: z.string().max(4_000).optional().catch(undefined),
})

proxyRouter.get('/page/:chapterKey/:index', async (req, res) => {
  const { chapterKey, index: rawIndex } = req.params
  // MangaDex a son propre relais (`/api/chapters/:id/image/…`), avec ses règles.
  if (!isRelayedKey(chapterKey) || !/^\d{1,4}$/.test(rawIndex)) throw badRequest('Page invalide.')
  const index = Number(rawIndex)
  const { n: count, alt } = PageQuery.parse(req.query)
  const alternates = (alt ?? '')
    .split(',')
    .filter((key) => key !== chapterKey && isRelayedKey(key))
    .slice(0, MAX_ALTERNATES)

  /*
   * Repli gracieux, page par page : la version demandée (URL fraîchement
   * redemandée à la source si la première échoue : URL signée expirée,
   * serveur remplacé), puis la même page chez les autres sources, si leur
   * version du chapitre a le même nombre de pages. Le lecteur reçoit une
   * image sans savoir qu'une source est tombée.
   */
  const attempts: { key: string; fresh: boolean }[] = [
    { key: chapterKey, fresh: false },
    { key: chapterKey, fresh: true },
    ...alternates.map((key) => ({ key, fresh: false })),
  ]
  let previousUrl: string | null = null
  for (const { key, fresh } of attempts) {
    if (fresh) sourceAggregator.forgetPages(key)
    const resolved = await sourceAggregator.resolvePage(key, index).catch(() => null)
    if (!resolved) continue
    const primary = key === chapterKey
    if (!primary && count !== undefined && resolved.count !== count) continue
    // Même URL qu'à l'essai précédent : rien de neuf à tenter.
    if (fresh && resolved.page.url === previousUrl) continue
    if (primary) previousUrl = resolved.page.url

    // Bibliothèque personnelle : elle télécharge elle-même, depuis sa seule origine configurée.
    const { image, reason } = resolved.fetchImage
      ? await resolved.fetchImage(resolved.page)
      : await relayImage(resolved.page, config.mangadexUserAgent)
    if (!image) {
      console.warn(`[proxy] ${resolved.source.id} ${key}/${index} : ${reason ?? 'échec'}`)
      continue
    }
    if (primary) {
      res.set('Cache-Control', 'public, max-age=86400')
    } else {
      // Page d'une autre source : servie, mais sans s'installer dans les caches.
      res.set('Cache-Control', 'public, max-age=300')
      res.set('X-Reader-Fallback', resolved.source.id)
    }
    res.type(image.contentType).send(image.body)
    return
  }

  throw upstreamError('Page indisponible sur toutes les sources.')
})
