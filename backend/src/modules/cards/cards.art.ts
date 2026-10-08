import { prisma } from '../../db.js'
import { TtlCache } from '../../lib/cache.js'
import { notFound } from '../../lib/errors.js'
import type { CachedImage } from '../manga/manga.routes.js'
import { series3CardId } from './series3.seed.js'

/*
 * Portraits des cartes de la Série 3, relayés depuis MyAnimeList : agrandis (×2, Lanczos,
 * léger renforcement) pour rester nets sur un écran Retina, puis en WebP. Une carte pleine
 * image s'affiche bien plus grand qu'une vignette de 225 px de large.
 */

const MAL_HOST = 'cdn.myanimelist.net'
/** Largeur servie : deux fois la largeur d'origine des portraits MyAnimeList. */
const ART_WIDTH = 450

const cache = new TtlCache<CachedImage>({ maxEntries: 400, ttlMs: 24 * 60 * 60 * 1000 })

type Sharp = typeof import('sharp')['default']
let sharpModule: Promise<Sharp | null> | null = null
const loadSharp = () => (sharpModule ??= import('sharp').then((module) => module.default, () => null))

/** Agrandi et réencodé ; l'original tel quel si sharp manque ou échoue. */
export async function enhanceArt(image: CachedImage): Promise<CachedImage> {
  const sharp = await loadSharp()
  if (!sharp) return image
  try {
    const body = await sharp(image.body, { failOn: 'error' })
      .resize({ width: ART_WIDTH, kernel: 'lanczos3', withoutEnlargement: false })
      .sharpen({ sigma: 0.7 })
      .webp({ quality: 86, effort: 4 })
      .toBuffer()
    return { body, contentType: 'image/webp' }
  } catch {
    return image
  }
}

export async function characterArt(malId: number): Promise<CachedImage> {
  return cache.getOrLoad(String(malId), async () => {
    const card = await prisma.card.findUnique({ where: { id: series3CardId(malId) }, select: { artUrl: true } })
    const url = card?.artUrl
    if (!url || new URL(url).hostname !== MAL_HOST) throw notFound('Portrait indisponible.')
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
    if (!response?.ok) throw notFound('Portrait indisponible.')
    return enhanceArt({ body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'image/jpeg' })
  })
}
