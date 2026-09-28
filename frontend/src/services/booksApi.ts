import type { Book } from '../types/book'
import type { CloudBook, CloudBookPatch, CloudPosition, ImportMatch } from '../types/novel'
import { API_BASE, ApiError, api } from './api'

/** Limite d'import de l'API (`BOOKS_MAX_UPLOAD_MB`) : vérifiée avant d'envoyer quoi que ce soit. */
export const MAX_NOVEL_BYTES = 50 * 1024 * 1024

export interface UploadResult {
  book: CloudBook
  /** Ce fichier était déjà sur le compte : c'est sa fiche. */
  duplicate: boolean
  /** Fiche de bibliothèque où ranger le livre, ou fiches à départager. */
  match: ImportMatch
}

/** Erreur d'API lue dans le corps JSON d'une réponse. */
function errorFrom(status: number, payload: unknown): ApiError {
  const details = (payload as { error?: { code?: string; message?: string } & Record<string, unknown> } | null)?.error
  const { code, message, ...extra } = details ?? {}
  return new ApiError(status, typeof code === 'string' ? code : 'http_error', typeof message === 'string' ? message : `HTTP ${status}`, extra)
}

export const booksApi = {
  list: (signal?: AbortSignal) => api<{ books: CloudBook[] }>('/books', { signal }).then((response) => response.books),

  get: (id: string, signal?: AbortSignal) => api<{ book: CloudBook }>(`/books/${encodeURIComponent(id)}`, { signal }).then((response) => response.book),

  /** Romans FR / EN (Open Library + Google Books), au format `Book` du catalogue. */
  search: (query: string, lang: 'fr' | 'en', signal?: AbortSignal) =>
    api<{ results: Book[] }>(`/books/search?q=${encodeURIComponent(query)}&lang=${lang}`, { signal }).then((response) => response.results),

  update: (id: string, patch: CloudBookPatch) =>
    api<{ book: CloudBook }>(`/books/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }).then((response) => response.book),

  remove: (id: string) => api<void>(`/books/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Rattache le fichier à la fiche choisie, ou à une fiche tirée du fichier (`own`). 409 `work_already_linked`. */
  link: (id: string, choice: { record: Book } | { own: true }) =>
    api<{ book: CloudBook; record: Book }>(`/books/${encodeURIComponent(id)}/link`, { method: 'POST', body: choice }),

  /** Nouveau rapprochement : `auto` (jamais de question) pour les imports d'avant le rattachement. */
  match: (id: string, lang: 'fr' | 'en', mode: 'auto' | 'interactive') =>
    api<{ book: CloudBook; match: ImportMatch }>(`/books/${encodeURIComponent(id)}/match`, { method: 'POST', body: { lang, mode } }),

  /**
   * Position de lecture. `keepalive` : la requête part même si la page se
   * ferme (application passée en arrière-plan, onglet fermé).
   */
  async progress(id: string, position: CloudPosition, options: { keepalive?: boolean } = {}): Promise<{ applied: boolean; book: CloudBook }> {
    let response: Response
    try {
      response = await fetch(`${API_BASE}/books/${encodeURIComponent(id)}/progress`, {
        method: 'PATCH',
        credentials: 'include',
        keepalive: options.keepalive ?? false,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cfi: position.cfi, percent: position.percent, at: position.at }),
      })
    } catch {
      throw new ApiError(0, 'network_error', 'Network unreachable') // i18n-ignore
    }
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) throw errorFrom(response.status, payload)
    return payload as { applied: boolean; book: CloudBook }
  },

  /**
   * Envoie un EPUB (corps brut, nom dans `X-File-Name`). XHR plutôt que
   * `fetch` : lui seul rapporte l'avancement d'un envoi.
   */
  upload(
    file: File,
    lang: 'fr' | 'en',
    onProgress?: (ratio: number) => void,
    options: { signal?: AbortSignal; workId?: string } = {},
  ): Promise<UploadResult> {
    const { signal, workId } = options
    // Import depuis la fiche d'un roman : le fichier lui est rattaché d'office.
    const query = new URLSearchParams({ lang, ...(workId && { workId }) })
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_BASE}/books/upload?${query.toString()}`)
      xhr.withCredentials = true
      xhr.responseType = 'json'
      xhr.setRequestHeader('Content-Type', 'application/epub+zip')
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as UploadResult)
        else reject(errorFrom(xhr.status, xhr.response))
      }
      xhr.onerror = () => reject(new ApiError(0, 'network_error', 'Network unreachable')) // i18n-ignore
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
      signal?.addEventListener('abort', () => xhr.abort(), { once: true })
      xhr.send(file)
    })
  },

  /** Télécharge le fichier EPUB, en rapportant l'avancement. */
  async download(id: string, expectedBytes: number, onProgress?: (ratio: number) => void, signal?: AbortSignal): Promise<Blob> {
    let response: Response
    try {
      response = await fetch(`${API_BASE}/books/${encodeURIComponent(id)}/file`, { credentials: 'include', signal })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new ApiError(0, 'network_error', 'Network unreachable') // i18n-ignore
    }
    if (!response.ok) throw errorFrom(response.status, await response.json().catch(() => null))
    const total = Number(response.headers.get('content-length')) || expectedBytes
    if (!response.body || !onProgress) return response.blob()

    const reader = response.body.getReader()
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      onProgress(total > 0 ? Math.min(1, received / total) : 0)
    }
    return new Blob(chunks, { type: 'application/epub+zip' })
  },
}
