/**
 * Client HTTP de l'API Bookshelf.
 *
 * Par défaut `/api` en relatif : en dev, Vite relaie vers http://localhost:5000
 * (cf. `vite.config.ts`). `VITE_API_URL` permet de viser une API servie ailleurs.
 */
// `?.` : hors de Vite (tests unitaires sous Node), `import.meta.env` n'existe pas.
export const API_BASE = (import.meta.env?.VITE_API_URL ?? '/api').replace(/\/$/, '')

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

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options

  let response: Response
  try {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    response = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      // Page en arrière-plan (onglet fermé, app quittée) : l'envoi doit survivre à sa fermeture.
      // Le navigateur plafonne ces requêtes à 64 Ko : seules les petites y ont droit.
      keepalive: method !== 'GET' && isHidden() && (payload?.length ?? 0) < 60_000,
      // Le cookie de session HTTP-only voyage aussi en cross-origin (VITE_API_URL).
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload,
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
