import type { NextFunction, Request, Response } from 'express'
import { config } from '../../core/config.js'
import { prisma } from '../../core/db.js'
import { HttpError } from '../../core/http/errors.js'
import { currentUserId } from '../../core/http/auth.js'

declare global {
  namespace Express {
    interface Request {
      /** Renseigné par `requireAdmin`. */
      admin?: { id: string; email: string }
      /** Renseigné par `requireReviewer` (un administrateur ou un contrôleur d'images). */
      reviewer?: { id: string; email: string }
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

/**
 * Derrière `requireAuth` : la revue des images d'énigme est ouverte aux administrateurs ET aux
 * contrôleurs d'images (rôle donné par un administrateur, jamais à soi-même). Le rôle est relu en
 * base à chaque requête : le retirer ferme l'accès aussitôt. 404 pour les autres (comme l'administration).
 */
export async function requireReviewer(req: Request, _res: Response, next: NextFunction) {
  const id = currentUserId(req)
  const user = await prisma.user.findUnique({ where: { id }, select: { email: true, imageReviewer: true, suspendedAt: true } })
  if (!user || user.suspendedAt || !(user.imageReviewer || isAdminEmail(user.email))) throw new HttpError(404, 'not_found', 'Route inconnue.')
  req.reviewer = { id, email: user.email }
  next()
}

export function currentReviewer(req: Request): { id: string; email: string } {
  if (!req.reviewer) throw new HttpError(404, 'not_found', 'Route inconnue.')
  return req.reviewer
}
