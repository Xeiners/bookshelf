import { stackApi, type StackCover } from '../../services/stackApi'

/*
 * Couvertures de tomes de Page Stack : la liste vient du serveur (les mangas du set de cartes, couvertures
 * relayées par `/api/covers/`), chaque image est chargée une fois et gardée par le navigateur.
 * Sans couverture (hors-ligne, collection pas prête), le jeu dessine ses tomes.
 */

const LIST_KEY = 'bookshelf:stack:covers'
/** Couvertures utilisées par partie : assez pour varier, peu pour charger vite. */
export const COVERS_PER_GAME = 12

function readList(): StackCover[] {
  try {
    const stored = JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]') as unknown
    return Array.isArray(stored) ? (stored as StackCover[]).filter((cover) => typeof cover?.id === 'number') : []
  } catch {
    return []
  }
}

/** Liste des affiches : celle du serveur, sinon la dernière connue (hors-ligne). */
export async function coverList(signal?: AbortSignal): Promise<StackCover[]> {
  try {
    const covers = await stackApi.covers(signal)
    if (covers.length > 0) {
      try {
        localStorage.setItem(LIST_KEY, JSON.stringify(covers))
      } catch {
        // Stockage plein : la liste se relira au prochain passage.
      }
      return covers
    }
  } catch {
    // Hors-ligne : repli sur la liste gardée.
  }
  return readList()
}

/** Tire `count` couvertures au hasard. */
export function chooseCovers(list: readonly StackCover[], count = COVERS_PER_GAME, random: () => number = Math.random): StackCover[] {
  const pool = [...list]
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[pool[index], pool[swap]] = [pool[swap]!, pool[index]!]
  }
  return pool.slice(0, count)
}

const loaded = new Map<string, Promise<HTMLImageElement | null>>()

/** Une couverture chargée, ou `null` si elle n'est pas disponible. */
export function loadCover(url: string): Promise<HTMLImageElement | null> {
  let promise = loaded.get(url)
  if (!promise) {
    promise = new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => resolve(image)
      image.onerror = () => {
        loaded.delete(url)
        resolve(null)
      }
      image.src = url
    })
    loaded.set(url, promise)
  }
  return promise
}

/** Charge ces couvertures ; `onImage` reçoit chacune dès qu'elle est prête (la partie n'attend personne). */
export async function loadCovers(covers: readonly StackCover[], onImage: (image: HTMLImageElement, cover: StackCover) => void): Promise<void> {
  await Promise.all(
    covers.map(async (cover) => {
      const image = await loadCover(cover.url)
      if (image) onImage(image, cover)
    }),
  )
}
