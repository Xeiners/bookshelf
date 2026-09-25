/**
 * Client HTTP de l'API Bookshelf.
 *
 * Par défaut `/api` en relatif : en dev, Vite relaie vers http://localhost:5000
 * (cf. `vite.config.ts`). `VITE_API_URL` permet de viser une API servie ailleurs.
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Données jointes par l'API (essais restants, délai avant un nouveau code…). */
  readonly details: Record<string, unknown>

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** `true` si l'API n'a pas pu être jointe (hors-ligne, serveur arrêté). */
export const isNetworkError = (error: unknown) => error instanceof ApiError && error.status === 0

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      // Le cookie de session HTTP-only voyage aussi en cross-origin (VITE_API_URL).
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    // Message technique (debug) : l'interface traduit via `code` (cf. lib/apiErrors.ts).
    throw new ApiError(0, 'network_error', 'Network unreachable') // i18n-ignore
  }

  if (response.status === 204) return undefined as T

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const details = (payload as { error?: { code?: string; message?: string } & Record<string, unknown> } | null)?.error
    const { code, message, ...extra } = details ?? {}
    throw new ApiError(
      response.status,
      typeof code === 'string' ? code : 'http_error',
      typeof message === 'string' ? message : `HTTP ${response.status}`,
      extra,
    )
  }

  return payload as T
}
