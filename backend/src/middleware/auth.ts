import type { NextFunction, Request, Response } from 'express'
import { unauthorized } from '../lib/errors.js'
import { SESSION_COOKIE, readSession } from '../lib/session.js'

declare global {
  namespace Express {
    interface Request {
      /** Renseigné par `requireAuth`. */
      userId?: string
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const cookies = req.cookies as Record<string, string | undefined>
  const userId = await readSession(cookies[SESSION_COOKIE])
  if (!userId) throw unauthorized()
  req.userId = userId
  next()
}

/** À utiliser derrière `requireAuth`. */
export function currentUserId(req: Request): string {
  if (!req.userId) throw unauthorized()
  return req.userId
}

/** Session facultative : renseigne `req.userId` si le cookie est valide, sans jamais refuser. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const cookies = req.cookies as Record<string, string | undefined>
  const userId = await readSession(cookies[SESSION_COOKIE]).catch(() => null)
  if (userId) req.userId = userId
  next()
}
