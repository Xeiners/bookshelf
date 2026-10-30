import { Router } from 'express'
import { currentTheme } from './theme.service.js'

/** Monté sous `/api/theme` : le thème saisonnier en cours, pour tout le monde (invités compris). */
export const themeRouter = Router()

themeRouter.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ theme: await currentTheme() })
})
