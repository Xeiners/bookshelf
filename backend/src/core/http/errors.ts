/** Erreur métier : traduite telle quelle en réponse HTTP par le gestionnaire global. */
export class HttpError extends Error {
  readonly status: number
  readonly code: string
  /** Données utiles au front (tentatives restantes, délai avant renvoi…). */
  readonly details: Record<string, unknown> | undefined

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message: string, code = 'bad_request') =>
  new HttpError(400, code, message)
export const unauthorized = (message = 'Authentification requise.') =>
  new HttpError(401, 'unauthorized', message)
export const notFound = (message = 'Ressource introuvable.') =>
  new HttpError(404, 'not_found', message)
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message)
export const upstreamError = (message = 'La source de données ne répond pas.') =>
  new HttpError(502, 'upstream_unavailable', message)
