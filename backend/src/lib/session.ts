import type { CookieOptions, Response } from 'express'
import { SignJWT, jwtVerify } from 'jose'
import { config } from '../config.js'

export const SESSION_COOKIE = 'bookshelf_session'
const SESSION_DAYS = 30
const ISSUER = 'bookshelf-api'

const secret = new TextEncoder().encode(config.jwtSecret)

/**
 * JWT dans un cookie HTTP-only : inaccessible au JavaScript de la page (XSS),
 * `SameSite=Lax` bloque son envoi sur les POST inter-sites (CSRF).
 */
const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.cookieSecure,
  path: '/',
}

/**
 * `version` : la version des sessions du compte (`User.sessionVersion`). L'incrémenter
 * (suspension) invalide d'un coup tous les jetons déjà émis — cf. `sessionGuard.ts`.
 */
export async function issueSession(res: Response, userId: string, version = 0): Promise<void> {
  const token = await new SignJWT({ sv: version })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret)

  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 })
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions)
}

/**
 * Contenu du jeton, ou `null` s'il est absent, expiré ou falsifié. Ne dit rien du
 * compte (supprimé, suspendu, sessions révoquées) : c'est `authenticate` qui tranche.
 */
export async function readSessionClaims(token: string | undefined): Promise<{ userId: string; version: number } | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, algorithms: ['HS256'] })
    if (!payload.sub) return null
    // Jetons d'avant la version des sessions : version 0, celle de tous les comptes jamais suspendus.
    return { userId: payload.sub, version: typeof payload.sv === 'number' ? payload.sv : 0 }
  } catch {
    return null
  }
}
