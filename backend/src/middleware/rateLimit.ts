import type { NextFunction, Request, Response } from 'express'
import { HttpError } from '../lib/errors.js'

/**
 * Limiteur à fenêtre fixe, en mémoire, par IP. Protège login/register du
 * bourrage d'identifiants sans dépendance ; à remplacer par Redis en multi-instance.
 */
export function rateLimit(options: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const key = req.ip ?? 'unknown'
    let bucket = hits.get(key)

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs }
      hits.set(key, bucket)
      // Purge opportuniste : la table ne grossit pas indéfiniment.
      if (hits.size > 10_000) {
        for (const [ip, entry] of hits) if (entry.resetAt <= now) hits.delete(ip)
      }
    }

    bucket.count += 1
    if (bucket.count > options.max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)))
      throw new HttpError(429, 'rate_limited', 'Trop de tentatives. Réessaie dans quelques minutes.')
    }
    next()
  }
}
