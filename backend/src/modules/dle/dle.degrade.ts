import type { CachedImage } from '../manga/manga.routes.js'
import { TtlCache } from '../../core/infra/cache.js'
import { zoomScale } from './dle.logic.js'

/*
 * Anti-triche des formats à image (Pixels, Zoom) : l'image d'une énigme est PRÉPARÉE par le
 * serveur, au cran mérité par le joueur — quelques gros pixels, ou le petit détail zoomé. Le
 * navigateur ne reçoit jamais l'image nette avant la victoire (ou la fin de la manche) : rien
 * à repêcher dans l'inspecteur ou l'onglet Réseau pour une recherche d'image inversée.
 */

/** Mode Pixels : largeur de l'image en pixels, selon les erreurs (même échelle que l'app). */
export const PIXEL_STEPS = [8, 10, 12, 15, 18, 22, 27, 33, 40, 48, 58, 72, 90, 115, 150] as const

/** Largeur en pixels au cran `errors` ; `null` : l'image nette (toutes les erreurs consommées). */
export const pixelColumns = (errors: number): number | null => (errors >= PIXEL_STEPS.length ? null : (PIXEL_STEPS[Math.max(0, errors)] ?? null))

/** Format du cadre (largeur / hauteur), le même que les couvertures. */
const RATIO = 3 / 4
/** Détail zoomé : envoyé à la taille du cadre, pas plus (480 × 640). */
const ZOOM_WIDTH = 480
/** Fond des portraits détourés : rien de l'image d'origine ne transparaît. */
const BACKGROUND = { r: 11, g: 11, b: 18 }

const loadSharp = async () => (await import('sharp')).default

/** Images préparées (énigme × cran) : quelques Ko chacune, recalculées rarement. */
const prepared = new TtlCache<CachedImage>({ maxEntries: 400, ttlMs: 6 * 60 * 60 * 1000 })

/** Cadre 3:4 dans l'image (comme `object-cover`) ; `top` : calé en haut (le visage d'un portrait). */
export function coverBox(width: number, height: number, top: boolean): { left: number; top: number; width: number; height: number } {
  const wide = width / height > RATIO
  const boxWidth = Math.max(1, Math.round(wide ? height * RATIO : width))
  const boxHeight = Math.max(1, Math.round(wide ? height : width / RATIO))
  return {
    left: Math.max(0, Math.round((width - boxWidth) / 2)),
    top: wide || top ? 0 : Math.max(0, Math.round((height - boxHeight) / 2)),
    width: Math.min(boxWidth, width),
    height: Math.min(boxHeight, height),
  }
}

/**
 * Fenêtre visible d'un zoom ×`scale` autour du point `focus` (en % du cadre) : le point reste
 * fixe, le reste s'éloigne (comme un `transform: scale` d'origine `focus`). En fractions du cadre.
 */
export function zoomWindow(scale: number, focus: { x: number; y: number }): { x: number; y: number; size: number } {
  const size = 1 / Math.max(1, scale)
  const fx = Math.min(100, Math.max(0, focus.x)) / 100
  const fy = Math.min(100, Math.max(0, focus.y)) / 100
  return { x: fx * (1 - size), y: fy * (1 - size), size }
}

/**
 * L'image telle que le joueur a le droit de la voir à ce cran : `key` identifie l'énigme (même
 * image pour tous ses joueurs), `errors` ses erreurs. Au dernier cran, l'image entière.
 */
export async function puzzleImageAt(
  key: string,
  load: () => Promise<CachedImage>,
  mode: 'pixel' | 'zoom',
  errors: number,
  options: { portrait: boolean; focus: { x: number; y: number } | null },
): Promise<CachedImage> {
  if (mode === 'pixel' && pixelColumns(errors) === null) return load()
  if (mode === 'zoom' && zoomScale(errors) <= 1) return load()
  const step = mode === 'pixel' ? pixelColumns(errors) : zoomScale(errors)
  return prepared.getOrLoad(`${key}:${mode}:${step}`, async () => {
    const [source, sharp] = await Promise.all([load(), loadSharp()])
    // Orientation EXIF appliquée et transparence aplatie d'abord : les mesures valent pour l'image vue.
    const { data, info } = await sharp(source.body).rotate().flatten({ background: BACKGROUND }).toBuffer({ resolveWithObject: true })
    const { width, height } = info
    if (mode === 'pixel') {
      const columns = pixelColumns(errors)!
      // Lissage à la réduction : chaque pixel prend la couleur moyenne de sa zone, puis PNG minuscule.
      const body = await sharp(data)
        .extract(coverBox(width, height, options.portrait))
        .resize(columns, Math.round(columns / RATIO), { fit: 'fill' })
        .png()
        .toBuffer()
      return { body, contentType: 'image/png' }
    }
    const box = coverBox(width, height, false)
    const window = zoomWindow(zoomScale(errors), options.focus ?? { x: 50, y: 50 })
    const left = box.left + Math.round(window.x * box.width)
    const top = box.top + Math.round(window.y * box.height)
    const body = await sharp(data)
      .extract({
        left,
        top,
        width: Math.max(1, Math.min(Math.round(window.size * box.width), width - left)),
        height: Math.max(1, Math.min(Math.round(window.size * box.height), height - top)),
      })
      .resize(ZOOM_WIDTH, Math.round(ZOOM_WIDTH / RATIO), { fit: 'fill' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer()
    return { body, contentType: 'image/jpeg' }
  })
}
