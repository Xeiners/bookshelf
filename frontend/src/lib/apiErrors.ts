import type { Dictionary } from '../i18n/fr'
import { ApiError } from '../services/api'

/**
 * Message affichable pour une erreur d'API, dans la langue de l'utilisateur.
 *
 * On traduit à partir du CODE stable renvoyé par l'API (`invalid_credentials`,
 * `email_taken`…), jamais à partir de son `message`, qui n'est qu'une aide au
 * debug côté serveur et reste dans une seule langue.
 */
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
    case 'validation_error':
    case 'invalid_json':
      return t.errors.invalidInput
    default:
      return t.errors.unexpected
  }
}
