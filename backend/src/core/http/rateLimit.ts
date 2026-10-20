import { isIPv6 } from 'node:net'
import type { NextFunction, Request, Response } from 'express'
import { HttpError } from './errors.js'

/**
 * Clé de limitation d'une adresse. Une IPv6 s'obtient par blocs /64 (un abonné
 * en reçoit un entier) : sans cela, chaque requête pourrait changer de clé.
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown'
  const address = (ip.toLowerCase().split('%')[0] ?? '')
  if (!isIPv6(address) || address.startsWith('::ffff:')) return address
  const halves = address.split('::')
  const front = halves[0] ? halves[0].split(':') : []
  const back = halves[1] ? halves[1].split(':') : []
  const groups = halves.length === 2 ? [...front, ...Array<string>(8 - front.length - back.length).fill('0'), ...back] : front
  return `${groups.slice(0, 4).map((group) => group.padStart(4, '0')).join(':')}::/64`
}

/**
 * Limiteur à fenêtre fixe, en mémoire, par IP. Protège login/register du
 * bourrage d'identifiants sans dépendance ; à remplacer par Redis en multi-instance.
 */
export function rateLimit(options: { windowMs: number; max: number; key?: (req: Request) => string | undefined }) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const key = options.key?.(req) ?? clientKey(req.ip)
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
