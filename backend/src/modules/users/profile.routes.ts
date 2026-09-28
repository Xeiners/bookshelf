import { Router } from 'express'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { z } from 'zod'
import { HttpError } from '../../lib/errors.js'
import { ProfilePatchSchema } from './profile.schemas.js'
import { avatarOptions, getProfile, updateProfile } from './profile.service.js'
import { AVATAR_MAX_BYTES, receiveAvatar, storeAvatar, storedAvatar } from './avatarUpload.js'

/** Monté sous `/api/profile`. Réservé aux comptes : un invité n'a pas de profil serveur. */
export const profileRouter = Router()

profileRouter.use(requireAuth)

/** Profil enrichi : présentation, avatar et vitrine (fiches des cartes), statistiques, titres. */
profileRouter.get('/me', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await getProfile(currentUserId(req)))
})

const AvatarOptionsQuery = z.object({
  kind: z.enum(['library', 'book', 'catalog']),
  workId: z.string().trim().min(1).max(128),
})

/** Couvertures, volumes et cartes associés à une œuvre possédée. */
profileRouter.get('/avatar-options', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=300')
  res.json(await avatarOptions(currentUserId(req), AvatarOptionsQuery.parse(req.query)))
})

const avatarUploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 })
const avatarTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** Photo personnelle brute, contrôlée par signature puis stockée dans le volume persistant. */
profileRouter.post('/avatar-upload', avatarUploadLimiter, async (req, res) => {
  const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
  const declared = Number(req.headers['content-length'])
  if (!avatarTypes.has(type)) throw new HttpError(415, 'unsupported_avatar', 'Utilise une image JPEG, PNG ou WebP.')
  if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) {
    req.resume()
    throw new HttpError(413, 'avatar_too_large', 'La photo dépasse la limite de 8 Mo.')
  }
  const avatarUrl = await storeAvatar(currentUserId(req), await receiveAvatar(req))
  res.status(201).json({ avatarUrl })
})

/** L'image reste privée et n'est servie qu'à son propriétaire connecté. */
profileRouter.get('/avatar-image', async (req, res) => {
  const avatar = await storedAvatar(currentUserId(req))
  res.set('Cache-Control', 'private, max-age=31536000, immutable')
  res.type(avatar.contentType).sendFile(avatar.file)
})

const patchLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 })

/** Mise à jour partielle ; les cartes citées doivent être possédées. Renvoie le profil à jour. */
profileRouter.patch('/', patchLimiter, async (req, res) => {
  const patch = ProfilePatchSchema.parse(req.body)
  res.json(await updateProfile(currentUserId(req), patch))
})
