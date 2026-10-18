import { API_BASE } from '../../services/api'
import { stackApi, type StackCover } from '../../services/stackApi'

/*
 * Affiches d'anime des pages de Page Stack : la liste vient du serveur (relais de MyAnimeList),
 * chaque image est chargée une fois (le navigateur la garde : elle est servie en `immutable`).
 * Sans affiche (hors-ligne, serveur sans accès à MyAnimeList), le jeu dessine ses pages de manga.
 */

const LIST_KEY = 'bookshelf:stack:covers'
/** Affiches utilisées par partie : assez pour varier, peu pour charger vite. */
export const COVERS_PER_GAME = 12

const coverUrl = (id: number) => `${API_BASE}/stack/covers/${id}`

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

/** Tire `count` affiches au hasard (ou, si `ids` est donné, exactement celles-là). */
export function chooseCovers(list: readonly StackCover[], count = COVERS_PER_GAME, random: () => number = Math.random): number[] {
  const pool = [...list]
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[pool[index], pool[swap]] = [pool[swap]!, pool[index]!]
  }
  return pool.slice(0, count).map((cover) => cover.id)
}

const loaded = new Map<number, Promise<HTMLImageElement | null>>()

/** Une affiche chargée (décodée), ou `null` si elle n'est pas disponible. */
export function loadCover(id: number): Promise<HTMLImageElement | null> {
  let promise = loaded.get(id)
  if (!promise) {
    promise = new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => resolve(image)
      image.onerror = () => {
        loaded.delete(id)
        resolve(null)
      }
      image.src = coverUrl(id)
    })
    loaded.set(id, promise)
  }
  return promise
}

/** Charge ces affiches ; `onImage` reçoit chacune dès qu'elle est prête (la partie n'attend personne). */
export async function loadCovers(ids: readonly number[], onImage: (image: HTMLImageElement) => void): Promise<void> {
  await Promise.all(
    ids.map(async (id) => {
      const image = await loadCover(id)
      if (image) onImage(image)
    }),
  )
}
