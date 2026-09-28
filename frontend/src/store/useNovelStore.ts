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
import { forgetOwnWork, isOwnNovelWork, moveWork, placeInLibrary } from '../lib/novelLibrary'
import { novelAsBook } from '../lib/novels'
import { newestPosition, serverPosition } from '../lib/reader/cloudSync'
import { ApiError, isNetworkError } from '../services/api'
import { MAX_NOVEL_BYTES, booksApi } from '../services/booksApi'
import type { Book } from '../types/book'
import type { CloudBook, CloudBookPatch, ImportMatch } from '../types/novel'
import { useLibraryStore } from './useLibraryStore'
import { useSettingsStore } from './useSettingsStore'
import { useUiStore } from './useUiStore'

/** Raisons d'échec d'un import, traduites par `t.novels.errors`. */
export type UploadError = 'not-epub' | 'too-large' | 'quota' | 'invalid' | 'already-linked' | 'network' | 'unknown'

export interface UploadItem {
  id: string
  name: string
  /** 0 → 1 pendant l'envoi ; le serveur lit ensuite le fichier (`processing`). */
  progress: number
  status: 'uploading' | 'processing' | 'error'
  error?: UploadError
}

/** Livre importé dont la fiche reste à choisir (« lequel est-ce ? »). */
export interface PendingMatch {
  book: CloudBook
  candidates: Book[]
}

/** Import depuis la fiche d'un roman : le fichier lui est rattaché d'office. */
export interface UploadTarget {
  workId: string
  record: Book
}

interface NovelState {
  /** Romans du compte, `null` tant que rien n'est chargé. */
  books: CachedCloudBook[] | null
  /** Liste servie depuis l'appareil : l'API est injoignable. */
  offline: boolean
  uploads: UploadItem[]
  /** Imports dont la fiche est à départager, dans l'ordre d'arrivée. */
  pendingMatches: PendingMatch[]

  refresh: (userId: string) => Promise<void>
  /** Importe des EPUB sur le compte, l'un après l'autre ; chacun est rangé dans la bibliothèque. */
  upload: (userId: string, files: File[], language: Language, target?: UploadTarget) => Promise<{ error: UploadError | null }[]>
  /** Réponse à « lequel est-ce ? » : une des fiches proposées, ou celle tirée du fichier. */
  resolveMatch: (userId: string, bookId: string, choice: Book | 'own') => Promise<void>
  /** « Changer de fiche » : le fichier rejoint une autre fiche de roman, statut et avancement compris. */
  relink: (userId: string, bookId: string, record: Book) => Promise<void>
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
  if (error.code === 'work_already_linked') return 'already-linked'
  return 'unknown'
}

let uploadId = 0
/** Livres déjà passés au rapprochement automatique pendant cette session (imports d'avant le rattachement). */
const backfilled = new Set<string>()

/** Range un livre importé d'après la réponse de l'API ; `known` : fiche déjà connue (import depuis une fiche). */
function place(book: CloudBook, match: ImportMatch, known: Book | null): PendingMatch | null {
  if (match.status === 'choose') return { book, candidates: match.candidates }
  const record = match.record ?? known ?? (isOwnNovelWork(book.workId) ? novelAsBook(book) : null)
  if (record) placeInLibrary(record, book.progressPercent)
  return null
}

/**
 * Romans du compte (EPUB stockés sur le serveur). Non persisté dans
 * localStorage : la liste vit dans IndexedDB (`cloudBooks.ts`), fichiers compris.
 */
export const useNovelStore = create<NovelState>()((set, get) => ({
  books: null,
  offline: false,
  uploads: [],
  pendingMatches: [],

  refresh: async (userId) => {
    try {
      const books = await booksApi.list()
      set({ books: await syncCachedBooks(userId, books), offline: false })
      // Fiche tirée du fichier absente de la bibliothèque (import interrompu, autre appareil) : recréée.
      const { entries } = useLibraryStore.getState()
      for (const book of books) {
        if (isOwnNovelWork(book.workId) && !entries[book.workId!]) placeInLibrary(novelAsBook(book), book.progressPercent)
      }
      // Imports d'avant le rattachement : rapprochés une fois, sans question.
      const pending = new Set(get().pendingMatches.map((item) => item.book.id))
      const legacy = books.filter((book) => book.workId === null && !pending.has(book.id) && !backfilled.has(book.id))
      if (legacy.length > 0) void backfill(userId, legacy)
    } catch (error) {
      if (!isNetworkError(error)) throw error
      const cached = await listCachedBooks(userId)
      set({ books: cached.sort((a, b) => lastActivity(b) - lastActivity(a)), offline: true })
    }
  },

  upload: async (userId, files, language, target) => {
    const { notify } = useUiStore.getState()
    const outcomes: { error: UploadError | null }[] = []
    for (const file of files) {
      uploadId += 1
      const id = `upload-${uploadId}`
      const patch = (change: Partial<UploadItem>) =>
        set((state) => ({ uploads: state.uploads.map((item) => (item.id === id ? { ...item, ...change } : item)) }))
      set((state) => ({ uploads: [...state.uploads, { id, name: file.name, progress: 0, status: 'uploading' }] }))

      const refused = await precheck(file)
      if (refused) {
        patch({ status: 'error', error: refused })
        outcomes.push({ error: refused })
        continue
      }
      try {
        const { book, duplicate, match } = await booksApi.upload(
          file,
          language,
          (progress) => patch(progress >= 1 ? { progress, status: 'processing' } : { progress }),
          { workId: target?.workId },
        )
        await cacheBook(userId, book).catch(() => {})
        set((state) => ({ uploads: state.uploads.filter((item) => item.id !== id) }))
        const pending = place(book, match, target?.record ?? null)
        if (pending) set((state) => ({ pendingMatches: [...state.pendingMatches.filter((item) => item.book.id !== book.id), pending] }))
        else notify(duplicate ? getT().novels.duplicate(book.title) : getT().novels.imported(book.title), 'like')
        outcomes.push({ error: null })
      } catch (error) {
        const reason = uploadError(error)
        patch({ status: 'error', error: reason })
        outcomes.push({ error: reason })
      }
    }
    await get().refresh(userId).catch(() => {})
    return outcomes
  },

  resolveMatch: async (userId, bookId, choice) => {
    set((state) => ({ pendingMatches: state.pendingMatches.filter((item) => item.book.id !== bookId) }))
    let result: { book: CloudBook; record: Book }
    try {
      result = await booksApi.link(bookId, choice === 'own' ? { own: true } : { record: choice })
    } catch (error) {
      // Fiche déjà dotée d'un autre fichier : ce livre garde la sienne.
      if (!(error instanceof ApiError && error.code === 'work_already_linked')) throw error
      useUiStore.getState().notify(getT().novels.match.alreadyLinked, 'neutral')
      result = await booksApi.link(bookId, { own: true })
    }
    placeInLibrary(result.record, result.book.progressPercent)
    await cacheBook(userId, result.book).catch(() => {})
    set((state) => ({ books: state.books?.map((entry) => (entry.id === bookId ? { ...entry, book: result.book } : entry)) ?? null }))
    useUiStore.getState().notify(getT().novels.imported(result.record.title), 'like')
  },

  relink: async (userId, bookId, record) => {
    const previous = get().books?.find((entry) => entry.id === bookId)?.book.workId ?? null
    const { book } = await booksApi.link(bookId, { record })
    moveWork(previous, record)
    await cacheBook(userId, book).catch(() => {})
    set((state) => ({ books: state.books?.map((entry) => (entry.id === bookId ? { ...entry, book } : entry)) ?? null }))
  },

  dismissUpload: (id) => set((state) => ({ uploads: state.uploads.filter((item) => item.id !== id) })),

  update: async (userId, id, patch) => {
    const book = await booksApi.update(id, patch)
    await cacheBook(userId, book).catch(() => {})
    set((state) => ({ books: state.books?.map((entry) => (entry.id === id ? { ...entry, book } : entry)) ?? null }))
    return book
  },

  remove: async (userId, id) => {
    const workId = get().books?.find((entry) => entry.id === id)?.book.workId ?? null
    await booksApi.remove(id)
    forgetOwnWork(workId)
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
    backfilled.clear()
    set({ books: null, offline: false, uploads: [], pendingMatches: [] })
    await clearCloudCache().catch(() => {})
    // Couvertures des romans gardées par le Service Worker (cf. public/sw.js).
    const keys = await globalThis.caches?.keys().catch(() => [] as string[])
    await Promise.all((keys ?? []).filter((key) => key.startsWith('bookshelf-private-')).map((key) => caches.delete(key)))
  },
}))

/**
 * Rattachement automatique des imports d'avant les fiches : un à un, sans
 * jamais poser de question (fiche tirée du fichier en cas de doute ; elle se
 * change ensuite depuis « Mes romans »). Hors-ligne : on réessaiera au
 * prochain chargement.
 */
async function backfill(userId: string, books: CloudBook[]): Promise<void> {
  const language = useSettingsStore.getState().language
  for (const book of books) {
    backfilled.add(book.id)
    try {
      const result = await booksApi.match(book.id, language, 'auto')
      place(result.book, result.match, null)
      await cacheBook(userId, result.book).catch(() => {})
      useNovelStore.setState((state) => ({
        books: state.books?.map((entry) => (entry.id === book.id ? { ...entry, book: result.book } : entry)) ?? null,
      }))
    } catch (error) {
      if (isNetworkError(error)) {
        backfilled.delete(book.id)
        return
      }
    }
  }
}
