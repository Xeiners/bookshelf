import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { config } from '../../config.js'

/*
 * Code de vérification de l'inscription.
 *
 * - 6 chiffres tirés par `crypto.randomInt` (aléa cryptographique).
 * - Jamais stocké en clair : HMAC-SHA256 (clé = JWT_SECRET) de « e-mail:code ».
 *   Une fuite de la base ne donne pas les codes en cours, et un code n'est
 *   valable que pour SON e-mail.
 * - Comparaison à temps constant.
 * - Garde-fous : 15 min de validité, 5 essais par code, 60 s entre deux envois,
 *   5 envois au plus par heure et par adresse (anti-spam d'une boîte tierce).
 */

export const CODE_LENGTH = 6
export const CODE_TTL_MS = 15 * 60 * 1000
export const MAX_ATTEMPTS = 5
export const RESEND_COOLDOWN_MS = 60 * 1000
export const MAX_SENDS = 5
/** Fenêtre du plafond d'envois : au-delà, une inscription repart de zéro. */
export const SEND_WINDOW_MS = 60 * 60 * 1000

export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
}

export function hashCode(email: string, code: string): string {
  return createHmac('sha256', config.jwtSecret).update(`${email}:${code}`).digest('hex')
}

export function codeMatches(email: string, code: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashCode(email, code), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
