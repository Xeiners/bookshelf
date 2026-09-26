/**
 * Fichiers importés (PDF, EPUB, CBZ), gardés sur l'appareil dans IndexedDB.
 *
 * Rien ne part vers l'API : un fichier personnel reste personnel, et le lecteur
 * fonctionne hors-ligne. Deux magasins : `files` (fiches légères, pour la
 * liste) et `blobs` (contenu, lu seulement à l'ouverture).
 */
import type { LocalFormat } from '../../types/reader'
import { SNIFF_BYTES, sniffFormat, titleFromFileName } from './formats'

/** Position dans un fichier importé : page (PDF, CBZ) ou CFI (EPUB). */
export interface LocalPosition {
  page?: number
  offset?: number
  cfi?: string
  ratio: number
  at: number
}

export interface LocalFile {
  id: string
  name: string
  title: string
  format: LocalFormat
  size: number
  addedAt: number
  openedAt: number | null
  position: LocalPosition | null
}

export class UnsupportedFileError extends Error {
  readonly reason: 'cbr' | 'unknown' | 'too-large'

  constructor(reason: 'cbr' | 'unknown' | 'too-large') {
    super(reason)
    this.reason = reason
  }
}

/** Au-delà, le navigateur risque de refuser le stockage (quota) ou de saturer la mémoire. */
export const MAX_FILE_BYTES = 500 * 1024 * 1024

const DB_NAME = 'bookshelf-reader'
const DB_VERSION = 1
const FILES = 'files'
const BLOBS = 'blobs'

let database: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      database = null
      reject(request.error ?? new Error('indexedDB'))
    }
  })
  return database
}

function run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
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

export async function listFiles(): Promise<LocalFile[]> {
  const files = await run<LocalFile[]>([FILES], 'readonly', (tx) => tx.objectStore(FILES).getAll())
  // Derniers ouverts d'abord, puis derniers ajoutés.
  return files.sort((a, b) => (b.openedAt ?? b.addedAt) - (a.openedAt ?? a.addedAt))
}

export function getFile(id: string): Promise<LocalFile | undefined> {
  return run<LocalFile | undefined>([FILES], 'readonly', (tx) => tx.objectStore(FILES).get(id))
}

export function getFileBlob(id: string): Promise<Blob | undefined> {
  return run<Blob | undefined>([BLOBS], 'readonly', (tx) => tx.objectStore(BLOBS).get(id))
}

/** Importe un fichier après avoir reconnu son format (signature, pas extension). */
export async function importFile(file: File): Promise<LocalFile> {
  if (file.size > MAX_FILE_BYTES) throw new UnsupportedFileError('too-large')
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())
  const sniffed = sniffFormat(file.name, head)
  if ('unsupported' in sniffed) throw new UnsupportedFileError(sniffed.unsupported)

  const record: LocalFile = {
    id: crypto.randomUUID(),
    name: file.name,
    title: titleFromFileName(file.name),
    format: sniffed.format,
    size: file.size,
    addedAt: Date.now(),
    openedAt: null,
    position: null,
  }
  // Demande de stockage persistant : sans elle, le navigateur peut purger les gros fichiers.
  void navigator.storage?.persist?.().catch(() => false)
  await run([FILES, BLOBS], 'readwrite', (tx) => {
    tx.objectStore(FILES).put(record)
    tx.objectStore(BLOBS).put(file, record.id)
  })
  return record
}

async function patch(id: string, change: Partial<LocalFile>): Promise<void> {
  await run([FILES], 'readwrite', (tx) => {
    const store = tx.objectStore(FILES)
    const request = store.get(id)
    request.onsuccess = () => {
      const current = request.result as LocalFile | undefined
      if (current) store.put({ ...current, ...change })
    }
  })
}

export const markOpened = (id: string) => patch(id, { openedAt: Date.now() })

export const savePosition = (id: string, position: LocalPosition) => patch(id, { position })

export async function removeFile(id: string): Promise<void> {
  await run([FILES, BLOBS], 'readwrite', (tx) => {
    tx.objectStore(FILES).delete(id)
    tx.objectStore(BLOBS).delete(id)
  })
}
