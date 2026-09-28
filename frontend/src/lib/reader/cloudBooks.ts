/**
 * Romans du compte gardés sur l'appareil (IndexedDB) : la fiche, la dernière
 * position lue ici, et le fichier EPUB une fois téléchargé. C'est ce qui rend
 * la lecture possible hors-ligne, et la reprise immédiate sans attendre l'API.
 *
 * Chaque fiche porte l'id du compte : un autre compte connecté sur le même
 * appareil ne voit jamais les livres du précédent. La déconnexion volontaire
 * efface tout (`clearCloudCache`).
 */
import type { CloudBook, CloudPosition } from '../../types/novel'
import { patchRecord, run, STORES } from './db'

export interface CachedCloudBook {
  id: string
  userId: string
  book: CloudBook
  /** Dernière position lue sur CET appareil. */
  position: CloudPosition | null
  /** `position` pas encore confirmée par l'API (lue hors-ligne). */
  pending: boolean
  /** Fichier présent sur l'appareil : lisible hors-ligne. */
  downloaded: boolean
}

const BOOKS = STORES.cloudBooks
const BLOBS = STORES.cloudBlobs
const LOCATIONS = STORES.locations

/** Clé des positions EPUB précalculées d'un roman du compte. */
export const cloudLocationsKey = (id: string) => `cloud:${id}`

export async function listCachedBooks(userId: string): Promise<CachedCloudBook[]> {
  const all = await run<CachedCloudBook[]>([BOOKS], 'readonly', (tx) => tx.objectStore(BOOKS).getAll())
  return all.filter((entry) => entry.userId === userId)
}

export async function getCachedBook(userId: string, id: string): Promise<CachedCloudBook | undefined> {
  const entry = await run<CachedCloudBook | undefined>([BOOKS], 'readonly', (tx) => tx.objectStore(BOOKS).get(id))
  return entry?.userId === userId ? entry : undefined
}

/**
 * Aligne l'appareil sur la liste du serveur : fiches à jour, état local gardé
 * (fichier téléchargé, position en attente), livres disparus du compte
 * (supprimés depuis un autre appareil) effacés avec leur fichier.
 */
export async function syncCachedBooks(userId: string, books: CloudBook[]): Promise<CachedCloudBook[]> {
  const result: CachedCloudBook[] = []
  await run([BOOKS, BLOBS, LOCATIONS], 'readwrite', (tx) => {
    const store = tx.objectStore(BOOKS)
    const request = store.getAll()
    request.onsuccess = () => {
      const existing = new Map((request.result as CachedCloudBook[]).filter((entry) => entry.userId === userId).map((entry) => [entry.id, entry]))
      for (const book of books) {
        const previous = existing.get(book.id)
        const entry: CachedCloudBook = previous
          ? { ...previous, book }
          : { id: book.id, userId, book, position: null, pending: false, downloaded: false }
        store.put(entry)
        result.push(entry)
        existing.delete(book.id)
      }
      for (const gone of existing.values()) {
        store.delete(gone.id)
        tx.objectStore(BLOBS).delete(gone.id)
        tx.objectStore(LOCATIONS).delete(cloudLocationsKey(gone.id))
      }
    }
  })
  return result
}

/** Ajoute ou met à jour une fiche (import, ouverture, correction). */
export async function cacheBook(userId: string, book: CloudBook): Promise<void> {
  await run([BOOKS], 'readwrite', (tx) => {
    const store = tx.objectStore(BOOKS)
    const request = store.get(book.id)
    request.onsuccess = () => {
      const previous = request.result as CachedCloudBook | undefined
      store.put(previous?.userId === userId ? { ...previous, book } : { id: book.id, userId, book, position: null, pending: false, downloaded: false })
    }
  })
}

/** Position lue sur l'appareil ; `pending` tant que l'API ne l'a pas reçue. */
export const saveCachedPosition = (id: string, position: CloudPosition, pending: boolean) =>
  patchRecord<CachedCloudBook>(BOOKS, id, (entry) =>
    // Une confirmation qui arrive après une page plus récente ne la remplace pas.
    entry.position && entry.position.at > position.at ? entry : { ...entry, position, pending },
  )

/** Positions lues hors-ligne, à envoyer. */
export async function pendingPositions(userId: string): Promise<{ id: string; position: CloudPosition }[]> {
  return (await listCachedBooks(userId)).flatMap((entry) => (entry.pending && entry.position ? [{ id: entry.id, position: entry.position }] : []))
}

export function getCachedBlob(id: string): Promise<Blob | undefined> {
  return run<Blob | undefined>([BLOBS], 'readonly', (tx) => tx.objectStore(BLOBS).get(id))
}

export async function saveCachedBlob(id: string, blob: Blob): Promise<void> {
  // Sans stockage persistant, le navigateur peut purger les gros fichiers en cas de manque de place.
  void navigator.storage?.persist?.().catch(() => false)
  await run([BLOBS], 'readwrite', (tx) => {
    tx.objectStore(BLOBS).put(blob, id)
  })
  await patchRecord<CachedCloudBook>(BOOKS, id, (entry) => ({ ...entry, downloaded: true }))
}

/** Libère la place d'un livre sur l'appareil (il reste sur le compte). */
export async function forgetCachedBlob(id: string): Promise<void> {
  await run([BLOBS, LOCATIONS], 'readwrite', (tx) => {
    tx.objectStore(BLOBS).delete(id)
    tx.objectStore(LOCATIONS).delete(cloudLocationsKey(id))
  })
  await patchRecord<CachedCloudBook>(BOOKS, id, (entry) => ({ ...entry, downloaded: false }))
}

export async function removeCachedBook(id: string): Promise<void> {
  await run([BOOKS, BLOBS, LOCATIONS], 'readwrite', (tx) => {
    tx.objectStore(BOOKS).delete(id)
    tx.objectStore(BLOBS).delete(id)
    tx.objectStore(LOCATIONS).delete(cloudLocationsKey(id))
  })
}

/** Déconnexion : plus rien du compte ne reste sur l'appareil. */
export async function clearCloudCache(): Promise<void> {
  await run([BOOKS, BLOBS, LOCATIONS], 'readwrite', (tx) => {
    tx.objectStore(BOOKS).clear()
    tx.objectStore(BLOBS).clear()
    const locations = tx.objectStore(LOCATIONS)
    const keys = locations.getAllKeys()
    keys.onsuccess = () => {
      for (const key of keys.result) if (String(key).startsWith('cloud:')) locations.delete(key)
    }
  })
}
