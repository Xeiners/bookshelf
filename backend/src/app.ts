import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import { ZodError, z } from 'zod'
import { config } from './config.js'
import { HttpError } from './lib/errors.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { discoverRouter } from './modules/discover/discover.routes.js'
import { libraryRouter } from './modules/library/library.routes.js'
import { coverRouter, mangaRouter } from './modules/manga/manga.routes.js'
import { oracleRouter } from './modules/oracle/oracle.routes.js'

// Messages de validation en français, renvoyés tels quels au front.
z.config(z.locales.fr())

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  // Derrière un reverse proxy, `req.ip` doit refléter le client (limiteur de débit).
  app.set('trust proxy', config.trustProxy)

  // En dev le front passe par le proxy Vite (même origine) : CORS ne sert
  // qu'aux déploiements où le front est servi depuis une autre origine.
  app.use(cors({ origin: config.corsOrigins, credentials: true }))
  app.use(express.json({ limit: '2mb' }))
  app.use(cookieParser())

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() })
  })

  app.use('/api/auth', authRouter)
  app.use('/api/library', libraryRouter)
  app.use('/api/manga', mangaRouter)
  app.use('/api/covers', coverRouter)
  app.use('/api/oracle', oracleRouter)
  app.use('/api/discover', discoverRouter)

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Route inconnue.' } })
  })

  // Express 5 transmet ici les rejets des handlers async : pas de try/catch dans les routes.
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'validation_error',
          message: error.issues[0]?.message ?? 'Requête invalide.',
          issues: error.issues.map(({ path, message }) => ({ path, message })),
        },
      })
      return
    }

    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } })
      return
    }

    // JSON malformé renvoyé par `express.json()`.
    if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      res.status(400).json({ error: { code: 'invalid_json', message: 'Corps JSON invalide.' } })
      return
    }

    console.error('[api] erreur non gérée', error)
    res.status(500).json({ error: { code: 'internal_error', message: 'Erreur interne du serveur.' } })
  }
  app.use(errorHandler)

  return app
}
