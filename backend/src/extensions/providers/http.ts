import type { z } from 'zod'
import { HttpError, upstreamError } from '../../lib/errors.js'

const TIMEOUT_MS = 10_000

/** Réponse HTTP en erreur d'une source : le statut reste lisible (401 → nouvelle authentification). */
export class ProviderHttpError extends HttpError {
  readonly upstreamStatus: number

  constructor(upstreamStatus: number, message: string) {
    super(502, 'upstream_unavailable', message)
    this.upstreamStatus = upstreamStatus
  }
}

/** Journal d'une source : `[Provider: Consumet] …`. */
export type ProviderLog = (message: string) => void

export const providerLogger =
  (name: string, sink: (line: string) => void = console.info): ProviderLog =>
  (message) =>
    sink(`[Provider: ${name}] ${message}`)

export interface GetJsonOptions {
  userAgent: string
  label: string
  /** Nom court de la route (« search », « info », « pages ») pour les journaux. */
  endpoint: string
  log?: ProviderLog
  timeoutMs?: number
  /** En-têtes d'authentification (clé d'API, jeton…). */
  headers?: Record<string, string>
  method?: 'GET' | 'POST'
  /** Variable(s) à vérifier quand la source répond 401. */
  authHint?: string
  body?: unknown
}

/**
 * GET JSON sur une source externe, borné dans le temps, et VALIDÉ par un
 * schéma zod : une API qui change de format est détectée ici (erreur
 * explicite, source mise en échec par l'agrégateur) au lieu de propager des
 * `undefined` jusqu'au lecteur. `null` si la ressource n'existe pas (404).
 * Chaque échec est journalisé avec la route en cause : on voit tout de suite
 * QUELLE source et QUELLE étape renvoie une erreur.
 */
export async function getJson<S extends z.ZodType>(url: string, schema: S, options: GetJsonOptions): Promise<z.infer<S> | null> {
  const { label, endpoint, log } = options
  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'User-Agent': options.userAgent,
        Accept: 'application/json',
        ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    })
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'délai dépassé' : 'injoignable'
    log?.(`${endpoint} : ${reason}`)
    throw upstreamError(`${label} est injoignable (${endpoint}).`)
  }
  if (response.status === 404) {
    log?.(`HTTP 404 sur ${endpoint}`)
    return null
  }
  if (!response.ok) {
    // 401 : authentification absente ou refusée. Un 403 peut aussi venir d'un blocage : pas de conclusion hâtive.
    const hint = response.status === 401 ? ` — authentification refusée, vérifier ${options.authHint ?? 'OPEN_COMIC_API_KEY'}` : ''
    log?.(`HTTP ${response.status} ${response.statusText} sur ${endpoint}${hint}`)
    throw new ProviderHttpError(response.status, `${label} a répondu ${response.status} (${endpoint}).`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    log?.(`${endpoint} : réponse qui n’est pas du JSON (${response.headers.get('content-type') ?? 'type absent'})`)
    throw upstreamError(`${label} : réponse qui n’est pas du JSON (${endpoint}).`)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = `${issue?.path.join('.') || 'racine'} : ${issue?.message ?? '?'}`
    log?.(`${endpoint} : format de réponse inattendu (${where})`)
    throw upstreamError(`${label} : format de réponse inattendu (${where}).`)
  }
  return parsed.data
}

/** « Chapter 12.5: Titre » → « 12.5 » : dernier recours quand la source ne donne pas le numéro à part. */
export function numberFromTitle(title: string | null | undefined): string | null {
  const match = title?.match(/(?:ch(?:apter|\.)?|chapitre|#)\s*(\d+(?:\.\d+)?)/i)
  return match?.[1] ?? null
}

/** Garde uniquement les en-têtes de provenance, en chaînes non vides. */
export function provenanceHeaders(headers: Record<string, unknown> | null | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  const kept = Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
  return kept.length > 0 ? Object.fromEntries(kept) : undefined
}
