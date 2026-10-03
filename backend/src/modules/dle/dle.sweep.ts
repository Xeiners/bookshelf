import { TtlCache } from '../../lib/cache.js'
import type { CachedImage } from '../manga/manga.routes.js'
import { SWEEP_COLS, SWEEP_ROWS, SWEEP_TILE_PX, isSweepTile } from './dle.logic.js'

/*
 * Chiffon (cf. `dle.logic.ts`) : l'image de l'énigme ne quitte JAMAIS le serveur en entier
 * avant la fin. Elle est ramenée à 480 × 640 (portrait cadré en haut, sur le visage ;
 * couverture centrée), posée sur un fond opaque (les détourages des wikis sont
 * transparents), puis découpée en tuiles JPEG. Le joueur ne reçoit que les tuiles qu'il
 * frotte — et chacune compte.
 */

export const SWEEP_WIDTH = SWEEP_COLS * SWEEP_TILE_PX
export const SWEEP_HEIGHT = SWEEP_ROWS * SWEEP_TILE_PX
/** Fond des images détourées : le même violet nuit que les cadres du jeu. */
const BACKGROUND = { r: 22, g: 20, b: 31 }

/**
 * sharp (binaire natif) chargé à la demande : s'il manque sur la machine, seul le
 * format Chiffon échoue — l'API, elle, démarre quand même.
 */
const loadSharp = async () => (await import('sharp')).default

/** Énigme → ses tuiles (adresses `data:` prêtes à dessiner), dans l'ordre de la grille. */
const prepared = new TtlCache<string[]>({ maxEntries: 40, ttlMs: 6 * 60 * 60 * 1000 })

/** Découpe une image en tuiles (une fois par énigme, puis en cache). */
export function sweepTiles(key: string, load: () => Promise<CachedImage>, portrait: boolean): Promise<string[]> {
  return prepared.getOrLoad(key, async () => {
    const [source, sharp] = await Promise.all([load(), loadSharp()])
    const { data, info } = await sharp(source.body)
      .rotate()
      .resize(SWEEP_WIDTH, SWEEP_HEIGHT, { fit: 'cover', position: portrait ? 'north' : 'centre' })
      .flatten({ background: BACKGROUND })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const raw = { width: info.width, height: info.height, channels: info.channels }
    // Toutes les tuiles en parallèle : sharp répartit le travail sur ses fils d'exécution.
    return Promise.all(
      Array.from({ length: SWEEP_ROWS * SWEEP_COLS }, async (_, index) => {
        const jpeg = await sharp(data, { raw })
          .extract({ left: (index % SWEEP_COLS) * SWEEP_TILE_PX, top: Math.floor(index / SWEEP_COLS) * SWEEP_TILE_PX, width: SWEEP_TILE_PX, height: SWEEP_TILE_PX })
          .jpeg({ quality: 78, mozjpeg: true })
          .toBuffer()
        return `data:image/jpeg;base64,${jpeg.toString('base64')}`
      }),
    )
  })
}

/** Les tuiles demandées (indices valides, sans doublon), avec leur image. */
export function pickTiles(all: readonly string[], wanted: Iterable<number>): Record<number, string> {
  const picked: Record<number, string> = {}
  for (const index of wanted) if (isSweepTile(index) && all[index]) picked[index] = all[index] as string
  return picked
}

/** Indices valides, sans doublon, triés. */
export const cleanTiles = (values: Iterable<number>): number[] => [...new Set([...values].filter(isSweepTile))].sort((a, b) => a - b)

/** Tests : repartir d'un cache vide. */
export const forgetSweepTiles = () => prepared.clear()
