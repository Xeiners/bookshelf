import type { Dictionary } from '../i18n/fr'
import { ApiError } from '../services/api'

/**
 * Message affichable pour une erreur d'API, dans la langue de l'utilisateur.
 *
 * On traduit à partir du CODE stable renvoyé par l'API (`invalid_credentials`,
 * `email_taken`…), jamais à partir de son `message`, qui n'est qu'une aide au
 * debug côté serveur et reste dans une seule langue.
 */
/** Donnée numérique jointe à l'erreur par l'API (essais restants, délai…). */
function numberDetail(error: ApiError, key: string, fallback: number): number {
  const value = error.details[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function apiErrorMessage(error: unknown, t: Dictionary): string {
  if (!(error instanceof ApiError)) return t.errors.unexpected
  if (error.status === 0) return t.errors.network

  switch (error.code) {
    case 'invalid_credentials':
      return t.errors.invalidCredentials
    case 'email_taken':
      return t.errors.emailTaken
    case 'rate_limited':
      return t.errors.rateLimited
    case 'code_invalid':
      return t.errors.codeInvalid(numberDetail(error, 'remainingAttempts', 1))
    case 'code_expired':
      return t.errors.codeExpired
    case 'code_locked':
      return t.errors.codeLocked
    case 'resend_too_soon':
      return t.errors.resendTooSoon(numberDetail(error, 'retryAfter', 60))
    case 'registration_not_found':
      return t.errors.registrationNotFound
    case 'email_unavailable':
      return t.errors.emailUnavailable
    case 'email_send_failed':
      return t.errors.emailSendFailed
    case 'validation_error':
    case 'invalid_json':
      return t.errors.invalidInput
    default:
      return t.errors.unexpected
  }
}
