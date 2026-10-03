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
    case 'account_suspended': {
      const reason = error.details.reason
      return t.errors.accountSuspended(typeof reason === 'string' && reason.trim() ? reason : null)
    }
    case 'admin_protected':
      return t.errors.adminProtected
    case 'already_suspended':
      return t.errors.alreadySuspended
    case 'not_suspended':
      return t.errors.notSuspended
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
    case 'wrong_password':
      return t.errors.wrongPassword
    case 'card_not_owned':
      return t.errors.cardNotOwned
    case 'title_locked':
      return t.errors.titleLocked
    case 'not_duplicate':
      return t.errors.notDuplicate
    case 'rarity_mismatch':
      return t.errors.rarityMismatch
    case 'same_card':
      return t.errors.sameCard
    case 'offer_exists':
      return t.errors.offerExists
    case 'offer_limit':
      return t.errors.offerLimit(numberDetail(error, 'max', 20))
    case 'own_offer':
      return t.errors.ownOffer
    case 'offer_closed':
      return t.errors.offerClosed
    case 'offer_unavailable':
      return t.errors.offerUnavailable
    case 'card_not_available':
      return t.errors.cardNotAvailable
    case 'not_enough_stardust':
      return t.errors.notEnoughStardust(Math.max(1, numberDetail(error, 'price', 0) - numberDetail(error, 'balance', 0)))
    case 'room_not_found':
      return t.errors.roomNotFound
    case 'room_full':
      return t.errors.roomFull
    case 'room_started':
      return t.errors.roomStarted
    case 'not_host':
      return t.errors.notHost
    case 'not_in_room':
      return t.errors.notInRoom
    case 'need_players':
      return t.errors.needPlayers
    case 'not_your_turn':
    case 'turn_over':
    case 'not_playing':
      return t.errors.notYourTurn
    case 'not_started':
      return t.errors.notStarted
    case 'round_over':
    case 'already_done':
    case 'spectating':
      return t.errors.roundOver
    case 'already_guessed':
      return t.errors.alreadyGuessed
    case 'already_solved':
      return t.errors.alreadySolved
    case 'unknown_work':
      return t.errors.unknownWork
    case 'guest_required':
      return t.errors.guestRequired
    case 'validation_error':
    case 'invalid_json':
      return t.errors.invalidInput
    default:
      return t.errors.unexpected
  }
}
