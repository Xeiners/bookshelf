import { Router } from 'express'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { z } from 'zod'
import { ProfilePatchSchema } from './profile.schemas.js'
import { avatarOptions, getProfile, updateProfile } from './profile.service.js'

/** Monté sous `/api/profile`. Réservé aux comptes : un invité n'a pas de profil serveur. */
export const profileRouter = Router()

profileRouter.use(requireAuth)

/** Profil enrichi : présentation, avatar et vitrine (fiches des cartes), statistiques, titres. */
profileRouter.get('/me', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await getProfile(currentUserId(req)))
})

const AvatarOptionsQuery = z.object({
  kind: z.enum(['library', 'book']),
  workId: z.string().trim().min(1).max(128),
})

/** Couvertures, volumes et cartes associés à une œuvre possédée. */
profileRouter.get('/avatar-options', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=300')
  res.json(await avatarOptions(currentUserId(req), AvatarOptionsQuery.parse(req.query)))
})

const patchLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 })

/** Mise à jour partielle ; les cartes citées doivent être possédées. Renvoie le profil à jour. */
profileRouter.patch('/', patchLimiter, async (req, res) => {
  const patch = ProfilePatchSchema.parse(req.body)
  res.json(await updateProfile(currentUserId(req), patch))
})
