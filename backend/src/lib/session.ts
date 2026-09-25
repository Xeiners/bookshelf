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

export async function issueSession(res: Response, userId: string): Promise<void> {
  const token = await new SignJWT({})
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

/** Renvoie l'id utilisateur du jeton, ou `null` s'il est absent, expiré ou falsifié. */
export async function readSession(token: string | undefined): Promise<string | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, algorithms: ['HS256'] })
    return payload.sub ?? null
  } catch {
    return null
  }
}
