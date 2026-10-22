import type { RequestHandler } from 'express'
import { config } from '../config.js'
import { HttpError } from './errors.js'

/**
 * Garde CSRF, en plus du cookie `SameSite=Lax`. Lax suffit contre un site TIERS, mais pas contre
 * un voisin « même site » : un autre sous-domaine du même domaine, ou une autre application
 * servie sur la même IP (un autre port) — leurs requêtes emporteraient le cookie de session.
 *
 * Toute requête qui modifie (POST, PUT, PATCH, DELETE) et vient d'un navigateur doit donc
 * venir de notre propre origine (ou d'une origine de `CORS_ORIGINS`) :
 *  - `Origin` présent (tous les navigateurs l'envoient sur ces méthodes) : il doit être le nôtre ;
 *  - sans `Origin`, `Sec-Fetch-Site` (s'il est là) doit dire « même origine » ou « tapé par
 *    l'utilisateur ». Un client hors navigateur (curl, tests) n'envoie ni l'un ni l'autre : il
 *    n'y a alors pas de session de victime à détourner.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * `Origin` est-il le nôtre ? Comparé à `Host` et à `X-Forwarded-Host` (derrière Caddy puis Nginx).
 * Un proxy qui retire le port de `Host` (Nginx `$host`) laisse comparer le seul nom d'hôte ; dès
 * que le port est transmis (`$http_host`), il doit correspondre lui aussi.
 */
function ownOrigin(origin: string, hosts: readonly string[]): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return hosts.some((host) => url.host === host || (!host.includes(':') && url.hostname === host))
}

export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next()
  const origin = req.headers.origin
  if (origin !== undefined) {
    const forwarded = String(req.headers['x-forwarded-host'] ?? '').split(',')[0]?.trim()
    const hosts = [req.headers.host, forwarded].filter((host): host is string => Boolean(host))
    if (!ownOrigin(origin, hosts) && !config.corsOrigins.includes(origin)) throw new HttpError(403, 'forbidden_origin', 'Requête refusée : origine non autorisée.')
    return next()
  }
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'forbidden_origin', 'Requête refusée : origine non autorisée.')
  next()
}
