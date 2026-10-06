import { getT } from '../../i18n'
import { API_BASE, api, ApiError } from '../../services/api'
import { isDownloaded, useDownloadStore, type DownloadError, type DownloadedChapter } from '../../store/useDownloadStore'
import { useUiStore } from '../../store/useUiStore'
import type { Book } from '../../types/book'
import type { ChapterLanguage, ChapterList, ChapterPages, ChapterSource, ReaderChapter, ReaderPage } from '../../types/reader'

/*
 * Téléchargement de chapitres pour la lecture hors-ligne.
 *
 * - Les images vont dans un cache à part (Cache API), jamais purgé automatiquement : le
 *   Service Worker (`public/sw.js`) les sert en priorité, sans réseau.
 * - Un chapitre à la fois, ses pages par lots de `CONCURRENCY` : la lecture en cours garde
 *   de la bande passante.
 * - Reprise : une page déjà en cache n'est jamais retéléchargée. Une coupure laisse le
 *   chapitre « en erreur » (réessayable, et relancé seul au retour du réseau) ; le registre
 *   ne le dit « téléchargé » qu'une fois TOUTES ses pages en cache.
 * - Stockage plein (`QuotaExceededError`) : tout s'arrête proprement, on prévient.
 */

export const DOWNLOADS_CACHE = 'bookshelf-downloads-v1'
const CONCURRENCY = 4
/** Pages réencodées en WebP par l'API (cf. `backend/src/lib/webp.ts`). */
const QUALITY = 'data'

const store = () => useDownloadStore.getState()
const controllers = new Map<string, AbortController>()
let running: string | null = null

class DownloadFailure extends Error {
  readonly reason: DownloadError
  constructor(reason: DownloadError) {
    super(reason)
    this.reason = reason
  }
}

const isQuotaError = (error: unknown) =>
  error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

const openCache = () => {
  if (typeof caches === 'undefined') throw new DownloadFailure('unavailable')
  return caches.open(DOWNLOADS_CACHE)
}

/** Met un chapitre en file (ou relance un téléchargement en erreur : il reprend où il s'était arrêté). */
export function downloadChapter(book: Book, chapter: ReaderChapter, language: ChapterLanguage): void {
  const existing = store().chapters[chapter.id]
  if (existing && existing.status !== 'error') return
  store().put({
    chapterId: chapter.id,
    manga: { id: book.id, title: book.title, cover: book.cover },
    number: chapter.number,
    title: chapter.title,
    language,
    alternates: chapter.alternates?.map((alt) => alt.id) ?? [],
    status: 'queued',
    pages: existing?.pages ?? [],
    servedBy: existing?.servedBy ?? null,
    source: existing?.source ?? chapter.source ?? null,
    done: existing?.done ?? 0,
    bytes: existing?.bytes ?? 0,
    queuedAt: Date.now(),
    downloadedAt: null,
  })
  // Sans stockage persistant, le navigateur peut purger le cache s'il manque de place.
  void navigator.storage?.persist?.().catch(() => false)
  void pump()
}

/** Annule (en file ou en cours) : les pages déjà reçues sont effacées, rien ne reste à moitié. */
export async function cancelDownload(chapterId: string): Promise<void> {
  controllers.get(chapterId)?.abort()
  await removeDownload(chapterId)
}

/** Supprime un chapitre téléchargé (ou ses pages reçues jusque-là). */
export async function removeDownload(chapterId: string): Promise<void> {
  const entry = store().chapters[chapterId]
  controllers.get(chapterId)?.abort()
  store().forget(chapterId)
  if (!entry || typeof caches === 'undefined') return
  const cache = await caches.open(DOWNLOADS_CACHE)
  await Promise.all(entry.pages.map((page) => cache.delete(page.url)))
}

/** Supprime tous les téléchargements de l'appareil. */
export async function removeAllDownloads(): Promise<void> {
  for (const controller of controllers.values()) controller.abort()
  store().forgetAll()
  if (typeof caches !== 'undefined') await caches.delete(DOWNLOADS_CACHE)
}

/** Pages d'un chapitre téléchargé : lues sans aucun appel réseau. */
export function downloadedPages(chapterId: string): ChapterPages | null {
  const entry = store().chapters[chapterId]
  if (!isDownloaded(entry)) return null
  return { pages: entry.pages, servedBy: entry.servedBy ?? chapterId, source: entry.source, fallback: false }
}

/**
 * Liste des chapitres d'une œuvre quand l'API est injoignable : ceux téléchargés, dans
 * l'ordre. Le lecteur s'ouvre ainsi hors-ligne même si la liste n'a jamais été mise en cache.
 */
export function downloadedChapterList(mangaId: string, language: ChapterLanguage): ChapterList | null {
  const local = Object.values(store().chapters).filter((entry) => entry.manga.id === mangaId && isDownloaded(entry))
  if (local.length === 0) return null
  const value = (entry: DownloadedChapter) => (entry.number === null ? -1 : Number.parseFloat(entry.number))
  const chapters: ReaderChapter[] = local
    .sort((a, b) => value(a) - value(b))
    .map((entry) => ({
      id: entry.chapterId,
      number: entry.number,
      volume: null,
      title: entry.title,
      language: entry.language,
      pages: entry.pages.length,
      groups: [],
      publishedAt: new Date(entry.downloadedAt ?? entry.queuedAt).toISOString(),
      ...(entry.source && { source: entry.source }),
    }))
  const count = (lang: ChapterLanguage) => chapters.filter((chapter) => chapter.language === lang).length
  return { mangaId, language, available: { fr: count('fr'), en: count('en') }, chapters }
}

/** Relance les téléchargements interrompus (et, si demandé, ceux coupés par le réseau). */
function resume(retryNetwork: boolean): void {
  for (const entry of Object.values(store().chapters)) {
    if (entry.status === 'downloading' || (retryNetwork && entry.status === 'error' && entry.error === 'network')) {
      store().patch(entry.chapterId, { status: 'queued', error: undefined })
    }
  }
  void pump()
}

/** Au démarrage : les téléchargements interrompus (app fermée) reprennent. Au retour du réseau aussi. */
export function resumeDownloads(): void {
  resume(false)
  window.addEventListener('online', () => resume(true))
}

/**
 * Serveur tombé alors que l'appareil reste en ligne : aucun événement `online` ne viendra.
 * On réessaie donc seul, un peu plus tard (une seule relance programmée à la fois).
 */
const NETWORK_RETRY_MS = 20_000
let retryTimer: number | undefined
function scheduleRetry(): void {
  if (retryTimer !== undefined) return
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined
    resume(true)
  }, NETWORK_RETRY_MS)
}

/** Lance le prochain chapitre en file, un seul à la fois. */
async function pump(): Promise<void> {
  if (running || !navigator.onLine) return
  const next = Object.values(store().chapters)
    .filter((entry) => entry.status === 'queued')
    .sort((a, b) => a.queuedAt - b.queuedAt)[0]
  if (!next) return
  running = next.chapterId
  try {
    await run(next.chapterId)
  } finally {
    running = null
    void pump()
  }
}

async function run(chapterId: string): Promise<void> {
  const controller = new AbortController()
  controllers.set(chapterId, controller)
  const { signal } = controller
  store().patch(chapterId, { status: 'downloading', error: undefined })
  try {
    const cache = await openCache()
    const entry = store().chapters[chapterId]
    if (!entry) return
    // 1. Le manifeste : les pages dans l'ordre (déjà connu si on reprend).
    let pages = entry.pages
    if (pages.length === 0) {
      const alt = entry.alternates.length > 0 ? `&alt=${entry.alternates.map(encodeURIComponent).join(',')}` : ''
      const manifest = await api<{ pages: ReaderPage[]; servedBy?: string; source?: ChapterSource }>(
        `/chapters/${encodeURIComponent(chapterId)}/pages?quality=${QUALITY}&format=webp${alt}`,
        { signal },
      ).catch((error: unknown) => {
        if (isAbort(error)) throw error
        throw new DownloadFailure(error instanceof ApiError && error.status !== 0 && error.status < 500 ? 'unavailable' : 'network')
      })
      pages = manifest.pages
      if (pages.length === 0) throw new DownloadFailure('unavailable')
      store().patch(chapterId, { pages, servedBy: manifest.servedBy ?? chapterId, source: manifest.source ?? entry.source })
    }
    // 2. La liste des chapitres de l'œuvre : le lecteur s'ouvre hors-ligne sur elle.
    void saveChapterList(cache, entry.manga.id, entry.language)

    // 3. Les images, par lots ; celles déjà en cache comptent sans être retéléchargées.
    let done = 0
    let bytes = 0
    const queue = [...pages]
    const worker = async () => {
      for (let page = queue.shift(); page; page = queue.shift()) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError') // i18n-ignore
        bytes += await savePage(cache, page, signal)
        done += 1
        store().patch(chapterId, { done, bytes })
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker))
    } catch (error) {
      // Un lot a échoué : les autres s'arrêtent aussi.
      controller.abort()
      throw error
    }
    store().patch(chapterId, { status: 'done', done: pages.length, bytes, downloadedAt: Date.now() })
  } catch (error) {
    // Annulé : `cancelDownload` / `removeDownload` a déjà tout effacé.
    if (signal.aborted && !(error instanceof DownloadFailure) && !isQuotaError(error)) return
    const reason: DownloadError = isQuotaError(error) ? 'quota' : error instanceof DownloadFailure ? error.reason : 'network'
    if (!store().chapters[chapterId]) return
    store().patch(chapterId, { status: 'error', error: reason })
    if (reason === 'network') scheduleRetry()
    if (reason === 'quota') {
      // Plus de place : rien d'autre ne passera, la file s'arrête là.
      for (const entry of Object.values(store().chapters)) {
        if (entry.status === 'queued') store().patch(entry.chapterId, { status: 'error', error: 'quota' })
      }
      useUiStore.getState().notify(getT().downloads.quotaExceeded, 'nope')
    }
  } finally {
    controllers.delete(chapterId)
  }
}

/** Une page : du cache si elle y est déjà, sinon téléchargée (originale, puis repli) et rangée. Renvoie son poids. */
async function savePage(cache: Cache, page: ReaderPage, signal: AbortSignal): Promise<number> {
  const cached = await cache.match(page.url)
  if (cached) return (await cached.blob()).size
  // Serveur injoignable ou en difficulté (le proxy répond 502/503/504 quand l'API est tombée) :
  // passager, le téléchargement reprendra. Seule une page vraiment introuvable (4xx) est définitive.
  let transient = false
  for (const url of [page.url, page.fallbackUrl]) {
    if (!url) continue
    try {
      const response = await fetch(url, { signal, credentials: 'include' })
      if (response.status >= 500 || response.status === 429) transient = true
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) continue
      const blob = await response.blob()
      // Rangée sous l'adresse que le lecteur demandera (même si c'est le repli qui a répondu).
      await cache.put(page.url, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/webp' } }))
      return blob.size
    } catch (error) {
      if (isAbort(error) || isQuotaError(error)) throw error
      transient = true
    }
  }
  throw new DownloadFailure(transient ? 'network' : 'unavailable')
}

const savedLists = new Set<string>()
async function saveChapterList(cache: Cache, mangaId: string, language: ChapterLanguage): Promise<void> {
  const url = `${API_BASE}/manga/${encodeURIComponent(mangaId)}/chapters?lang=${language}`
  if (savedLists.has(url)) return
  try {
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) return
    await cache.put(url, response)
    savedLists.add(url)
  } catch {
    // Sans elle, le lecteur se rabat sur la liste des chapitres téléchargés (`downloadedChapterList`).
  }
}

/** Espace occupé par les téléchargements terminés, en octets. */
export const downloadsBytes = (chapters: Record<string, DownloadedChapter>) =>
  Object.values(chapters).reduce((sum, entry) => sum + entry.bytes, 0)
