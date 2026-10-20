import type { RequestHandler } from 'express'
import { config } from '../config.js'

/**
 * En-têtes de durcissement de l'API (équivalent minimal de helmet, sans
 * dépendance). L'API ne sert jamais de page : la CSP interdit tout chargement
 * et toute intégration en cadre si une réponse était ouverte directement.
 */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
  if (config.cookieSecure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  // Les réponses JSON dépendent de la session : jamais mises en cache (proxy ou navigateur partagé).
  const json = res.json.bind(res)
  res.json = (body) => {
    if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store')
    return json(body)
  }
  next()
}
