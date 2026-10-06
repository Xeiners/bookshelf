/**
 * Pages de chapitre téléchargées pour la lecture hors-ligne (`?format=webp`) : réencodées
 * en WebP, deux à trois fois plus légères qu'un PNG — l'espace d'un téléphone est compté.
 *
 * Jamais bloquant : sharp introuvable, image illisible ou trop grande pour WebP (bande de
 * webtoon de plus de 16 383 px), ou WebP plus lourd que l'original → l'original, tel quel.
 */

/** WebP plafonne chaque côté à 16 383 px. */
const WEBP_MAX_SIDE = 16_383
const QUALITY = 80

type Sharp = typeof import('sharp')['default']
let sharpModule: Promise<Sharp | null> | null = null
/** Chargé à la demande : sans sharp, les pages partent simplement dans leur format d'origine. */
const loadSharp = () =>
  (sharpModule ??= import('sharp').then(
    (module) => module.default,
    (error: unknown) => {
      console.warn('[webp] sharp indisponible, pages servies sans conversion :', error instanceof Error ? error.message : error)
      return null
    },
  ))

export interface ImageBody {
  body: Buffer | Uint8Array
  contentType: string
}

export const wantsWebp = (format: unknown) => format === 'webp'

export async function toWebp(image: ImageBody): Promise<ImageBody> {
  // Déjà en WebP, ou animée (GIF) : rien à gagner.
  if (/webp|gif/i.test(image.contentType)) return image
  const sharp = await loadSharp()
  if (!sharp) return image
  try {
    const source = sharp(image.body, { failOn: 'error' })
    const { width = 0, height = 0 } = await source.metadata()
    if (width === 0 || height === 0 || width > WEBP_MAX_SIDE || height > WEBP_MAX_SIDE) return image
    const body = await source.webp({ quality: QUALITY, effort: 4 }).toBuffer()
    return body.length < image.body.length ? { body, contentType: 'image/webp' } : image
  } catch {
    return image
  }
}

/** Ajoute `format=webp` à l'adresse d'une page (en gardant ses autres paramètres). */
export function withWebp(url: string): string
export function withWebp(url: string | null): string | null
export function withWebp(url: string | null): string | null {
  if (!url) return url
  return `${url}${url.includes('?') ? '&' : '?'}format=webp`
}
