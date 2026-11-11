import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../core/config.js'
import { currentUserId, requireAuth } from '../../core/http/auth.js'
import { rateLimit } from '../../core/http/rateLimit.js'
import { currentAdmin, requireAdmin } from '../admin/admin.access.js'
import { AI_PROVIDERS, generatePlan, planPrompt } from './gravity.ai.js'
import { GRAVITY_THEMES, RunSchema } from './gravity.schema.js'
import { deleteGravityLevel, gravityLevel, gravityOverview, recordGravityRun, saveGravityLevel } from './gravity.service.js'

/**
 * Gravity Ninja (cf. `gravity.service.ts`). Monté sous `/api/gravity`. Pour l'instant réservé aux
 * administrateurs (404 pour les autres, comme l'administration) : l'ouvrir à tous, c'est retirer
 * `requireAdmin` des routes de jeu (liste, niveau, parties) — l'atelier reste aux admins.
 */
export const gravityRouter = Router()

gravityRouter.use(requireAuth, requireAdmin, (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

/** Les niveaux et ma progression. */
gravityRouter.get('/', async (req, res) => {
  res.json(await gravityOverview(currentUserId(req)))
})

const LevelParams = z.object({ id: z.string().regex(/^[a-z0-9-]{1,48}$/) })

/** Un niveau complet. */
gravityRouter.get('/levels/:id', async (req, res) => {
  res.json({ level: await gravityLevel(LevelParams.parse(req.params).id) })
})

const runLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 10_000 : 60 })

/** Une partie jouée (finie ou quittée) : la progression, au mieux. */
gravityRouter.post('/levels/:id/runs', runLimiter, async (req, res) => {
  res.json({ progress: await recordGravityRun(currentUserId(req), LevelParams.parse(req.params).id, RunSchema.parse(req.body)) })
})

/** Atelier : enregistre un niveau (généré, d'une IA, importé). */
gravityRouter.post('/levels', runLimiter, async (req, res) => {
  res.status(201).json({ level: await saveGravityLevel(currentAdmin(req), z.object({ level: z.unknown() }).parse(req.body).level) })
})

/** Atelier : supprime un niveau créé dans l'atelier. */
gravityRouter.delete('/levels/:id', async (req, res) => {
  await deleteGravityLevel(LevelParams.parse(req.params).id)
  res.status(204).end()
})

const PlanBody = z.object({
  prompt: z.string().max(1000).default(''),
  difficulty: z.number().int().min(1).max(10).optional(),
  theme: z.enum(GRAVITY_THEMES).optional(),
  length: z.enum(['short', 'medium', 'long']).optional(),
  provider: z.enum(AI_PROVIDERS).optional(),
})
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 1000 : 6 })

/** Atelier : le plan d'un niveau, écrit par une IA (Gemini ou Claude). 503 `gravity_ai_unavailable` sans clé. */
gravityRouter.post('/ai/plan', aiLimiter, async (req, res) => {
  res.json({ plan: await generatePlan(PlanBody.parse(req.body)) })
})

/** Atelier : le texte de la demande, à donner à un autre assistant (sa réponse s'importe). */
gravityRouter.post('/ai/prompt', async (req, res) => {
  res.json({ prompt: planPrompt(PlanBody.parse(req.body)) })
})
