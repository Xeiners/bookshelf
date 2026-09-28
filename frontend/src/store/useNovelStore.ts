import { create } from 'zustand'
import { getT } from '../i18n'
import type { Language } from '../i18n'
import { SNIFF_BYTES, sniffFormat } from '../lib/reader/formats'
import {
  cacheBook,
  clearCloudCache,
  forgetCachedBlob,
  listCachedBooks,
  pendingPositions,
  removeCachedBook,
  saveCachedPosition,
  syncCachedBooks,
  type CachedCloudBook,
} from '../lib/reader/cloudBooks'
import { newestPosition, serverPosition } from '../lib/reader/cloudSync'
import { ApiError, isNetworkError } from '../services/api'
import { MAX_NOVEL_BYTES, booksApi } from '../services/booksApi'
import type { CloudBook, CloudBookPatch } from '../types/novel'
import { useUiStore } from './useUiStore'

/** Raisons d'échec d'un import, traduites par `t.novels.errors`. */
export type UploadError = 'not-epub' | 'too-large' | 'quota' | 'invalid' | 'network' | 'unknown'

export interface UploadItem {
  id: string
  name: string
  /** 0 → 1 pendant l'envoi ; le serveur lit ensuite le fichier (`processing`). */
  progress: number
  status: 'uploading' | 'processing' | 'error'
  error?: UploadError
}

interface NovelState {
  /** Romans du compte, `null` tant que rien n'est chargé. */
  books: CachedCloudBook[] | null
  /** Liste servie depuis l'appareil : l'API est injoignable. */
  offline: boolean
  uploads: UploadItem[]

  refresh: (userId: string) => Promise<void>
  /** Importe des EPUB sur le compte, l'un après l'autre. */
  upload: (userId: string, files: File[], language: Language) => Promise<void>
  dismissUpload: (id: string) => void
  update: (userId: string, id: string, patch: CloudBookPatch) => Promise<CloudBook>
  remove: (userId: string, id: string) => Promise<void>
  /** Libère la place du fichier sur l'appareil (il reste sur le compte). */
  forgetDownload: (id: string) => Promise<void>
  /** Envoie les positions lues hors-ligne (au démarrage, au retour du réseau). */
  flushPending: (userId: string) => Promise<void>
  /** Déconnexion volontaire : rien du compte ne reste sur l'appareil. */
  clear: () => Promise<void>
}

/** Avancement affiché : la position la plus récente, lue ici ou ailleurs. */
export const displayPercent = (entry: CachedCloudBook) => newestPosition(entry.position, serverPosition(entry.book))?.percent ?? 0

/** Dernière activité : ordre de la liste hors-ligne (le serveur trie de même). */
const lastActivity = (entry: CachedCloudBook) =>
  Math.max(entry.position?.at ?? 0, entry.book.progressAt ?? 0, Date.parse(entry.book.updatedAt) || 0)

/** Refus immédiat, sans rien envoyer : pas un EPUB (signature lue), ou trop lourd. */
async function precheck(file: File): Promise<UploadError | null> {
  if (file.size > MAX_NOVEL_BYTES) return 'too-large'
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())
  const sniffed = sniffFormat(file.name, head)
  return 'format' in sniffed && sniffed.format === 'epub' ? null : 'not-epub'
}

function uploadError(error: unknown): UploadError {
  if (isNetworkError(error)) return 'network'
  if (!(error instanceof ApiError)) return 'unknown'
  if (error.code === 'quota_exceeded') return 'quota'
  if (error.status === 413) return 'too-large'
  if (error.status === 415) return 'not-epub'
  if (error.code === 'invalid_epub') return 'invalid'
  return 'unknown'
}

let uploadId = 0

/**
 * Romans du compte (EPUB stockés sur le serveur). Non persisté dans
 * localStorage : la liste vit dans IndexedDB (`cloudBooks.ts`), fichiers compris.
 */
export const useNovelStore = create<NovelState>()((set, get) => ({
  books: null,
  offline: false,
  uploads: [],

  refresh: async (userId) => {
    try {
      const books = await booksApi.list()
      set({ books: await syncCachedBooks(userId, books), offline: false })
    } catch (error) {
      if (!isNetworkError(error)) throw error
      const cached = await listCachedBooks(userId)
      set({ books: cached.sort((a, b) => lastActivity(b) - lastActivity(a)), offline: true })
    }
  },

  upload: async (userId, files, language) => {
    const { notify } = useUiStore.getState()
    for (const file of files) {
      uploadId += 1
      const id = `upload-${uploadId}`
      const patch = (change: Partial<UploadItem>) =>
        set((state) => ({ uploads: state.uploads.map((item) => (item.id === id ? { ...item, ...change } : item)) }))
      set((state) => ({ uploads: [...state.uploads, { id, name: file.name, progress: 0, status: 'uploading' }] }))

      const refused = await precheck(file)
      if (refused) {
        patch({ status: 'error', error: refused })
        continue
      }
      try {
        const { book, duplicate } = await booksApi.upload(file, language, (progress) =>
          patch(progress >= 1 ? { progress, status: 'processing' } : { progress }),
        )
        await cacheBook(userId, book).catch(() => {})
        set((state) => ({ uploads: state.uploads.filter((item) => item.id !== id) }))
        notify(duplicate ? getT().novels.duplicate(book.title) : getT().novels.imported(book.title), 'like')
      } catch (error) {
        patch({ status: 'error', error: uploadError(error) })
      }
    }
    await get().refresh(userId).catch(() => {})
  },

  dismissUpload: (id) => set((state) => ({ uploads: state.uploads.filter((item) => item.id !== id) })),

  update: async (userId, id, patch) => {
    const book = await booksApi.update(id, patch)
    await cacheBook(userId, book).catch(() => {})
    set((state) => ({ books: state.books?.map((entry) => (entry.id === id ? { ...entry, book } : entry)) ?? null }))
    return book
  },

  remove: async (userId, id) => {
    await booksApi.remove(id)
    await removeCachedBook(id).catch(() => {})
    set((state) => ({ books: state.books?.filter((entry) => entry.id !== id) ?? null }))
    await get().refresh(userId).catch(() => {})
  },

  forgetDownload: async (id) => {
    await forgetCachedBlob(id)
    set((state) => ({ books: state.books?.map((entry) => (entry.id === id ? { ...entry, downloaded: false } : entry)) ?? null }))
  },

  flushPending: async (userId) => {
    for (const { id, position } of await pendingPositions(userId).catch(() => [])) {
      try {
        await booksApi.progress(id, position)
      } catch (error) {
        // Hors-ligne : on réessaiera. Livre supprimé depuis un autre appareil : plus rien à envoyer.
        if (!(error instanceof ApiError) || error.status !== 404) return
      }
      await saveCachedPosition(id, position, false).catch(() => {})
    }
  },

  clear: async () => {
    set({ books: null, offline: false, uploads: [] })
    await clearCloudCache().catch(() => {})
    // Couvertures des romans gardées par le Service Worker (cf. public/sw.js).
    const keys = await globalThis.caches?.keys().catch(() => [] as string[])
    await Promise.all((keys ?? []).filter((key) => key.startsWith('bookshelf-private-')).map((key) => caches.delete(key)))
  },
}))
