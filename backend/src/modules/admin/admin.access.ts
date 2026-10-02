import type { NextFunction, Request, Response } from 'express'
import { config } from '../../config.js'
import { prisma } from '../../db.js'
import { HttpError } from '../../lib/errors.js'
import { currentUserId } from '../../middleware/auth.js'

declare global {
  namespace Express {
    interface Request {
      /** Renseigné par `requireAdmin`. */
      admin?: { id: string; email: string }
    }
  }
}

/** Seul `ADMIN_EMAILS` fait un administrateur : aucune route, aucune colonne en base. */
export const isAdminEmail = (email: string) => config.admins.has(email.toLowerCase())

/**
 * Derrière `requireAuth`. L'e-mail est relu en base à chaque requête : retirer
 * quelqu'un de `ADMIN_EMAILS` (et redémarrer) lui ferme l'accès aussitôt.
 * 404 plutôt que 403 : l'administration n'existe pas pour les autres comptes.
 */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const id = currentUserId(req)
  const user = await prisma.user.findUnique({ where: { id }, select: { email: true } })
  if (!user || !isAdminEmail(user.email)) throw new HttpError(404, 'not_found', 'Route inconnue.')
  req.admin = { id, email: user.email }
  next()
}

export function currentAdmin(req: Request): { id: string; email: string } {
  if (!req.admin) throw new HttpError(404, 'not_found', 'Route inconnue.')
  return req.admin
}
