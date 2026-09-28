/**
 * Base IndexedDB du lecteur (`bookshelf-reader`), partagée par :
 *  - les fichiers importés sur l'appareil (`files`, `blobs` — cf. localFiles.ts) ;
 *  - les romans du compte gardés pour le hors-ligne (`cloud-books`, `cloud-blobs`
 *    — cf. cloudBooks.ts) ;
 *  - les positions EPUB précalculées (`locations`) : epub.js met plusieurs
 *    secondes à les calculer sur un gros roman, une seule fois suffit.
 */

export const STORES = {
  files: 'files',
  blobs: 'blobs',
  cloudBooks: 'cloud-books',
  cloudBlobs: 'cloud-blobs',
  locations: 'locations',
} as const

const DB_NAME = 'bookshelf-reader'
/** v2 : romans du compte et positions EPUB. Les données de la v1 sont gardées. */
const DB_VERSION = 2

let database: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORES.files)) db.createObjectStore(STORES.files, { keyPath: 'id' })
      for (const store of [STORES.blobs, STORES.cloudBlobs, STORES.locations]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
      }
      if (!db.objectStoreNames.contains(STORES.cloudBooks)) db.createObjectStore(STORES.cloudBooks, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      const db = request.result
      // Un autre onglet ouvre une version plus récente : on lui laisse la place.
      db.onversionchange = () => {
        db.close()
        database = null
      }
      resolve(db)
    }
    request.onerror = () => {
      database = null
      reject(request.error ?? new Error('indexedDB'))
    }
  })
  return database
}

/** Une transaction : `work` prépare les requêtes, la promesse se résout à la validation. */
export function run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode)
        const request = work(tx)
        tx.oncomplete = () => resolve(request ? request.result : (undefined as T))
        tx.onerror = () => reject(tx.error ?? new Error('indexedDB'))
        tx.onabort = () => reject(tx.error ?? new Error('indexedDB'))
      }),
  )
}

/** Lecture-modification d'un enregistrement (`keyPath: 'id'`), dans une seule transaction. */
export async function patchRecord<T extends object>(store: string, id: string, change: (current: T) => T): Promise<void> {
  await run([store], 'readwrite', (tx) => {
    const objects = tx.objectStore(store)
    const request = objects.get(id)
    request.onsuccess = () => {
      const current = request.result as T | undefined
      if (current) objects.put(change(current))
    }
  })
}

/* ---- Positions EPUB précalculées ------------------------------------------------------ */

/** Positions epub.js (`book.locations.save()`), par livre et par densité. */
export function getLocations(key: string): Promise<string | undefined> {
  return run<string | undefined>([STORES.locations], 'readonly', (tx) => tx.objectStore(STORES.locations).get(key))
}

export async function saveLocations(key: string, json: string): Promise<void> {
  await run([STORES.locations], 'readwrite', (tx) => {
    tx.objectStore(STORES.locations).put(json, key)
  })
}

export async function removeLocations(key: string): Promise<void> {
  await run([STORES.locations], 'readwrite', (tx) => {
    tx.objectStore(STORES.locations).delete(key)
  })
}
