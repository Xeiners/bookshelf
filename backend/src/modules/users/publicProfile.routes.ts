import { Router } from 'express'
import { z } from 'zod'
import { LangQuerySchema } from '../../lib/language.js'
import { optionalAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { getPublicProfile, searchMembers, userNotFound } from './publicProfile.service.js'

/** Identifiant de compte (cuid) : tout autre format est un profil introuvable, sans requête en base. */
const UserId = z.string().regex(/^[a-z0-9]{8,40}$/i)
const PublicProfileQuery = z.object({ lang: LangQuerySchema })
const MemberSearchQuery = z.object({ q: z.string().max(40).default('') })

/** Monté sous `/api/users`. Ouvert aux invités : un profil public se partage par lien. */
export const publicProfileRouter = Router()

/** Recherche de membres par pseudo ; sans texte, les derniers inscrits. */
publicProfileRouter.get('/', rateLimit({ windowMs: 60_000, max: 60 }), optionalAuth, async (req, res) => {
  const { q } = MemberSearchQuery.parse(req.query)
  res.set('Cache-Control', 'private, no-cache')
  res.json({ members: await searchMembers(q, req.userId ?? null) })
})

publicProfileRouter.get('/:id', rateLimit({ windowMs: 60_000, max: 60 }), optionalAuth, async (req, res) => {
  const id = UserId.safeParse(req.params.id)
  if (!id.success) throw userNotFound()
  const { lang } = PublicProfileQuery.parse(req.query)
  const viewerId = req.userId ?? null
  // Propre au visiteur (`isSelf`), et un commutateur de confidentialité doit prendre effet aussitôt : jamais servi du cache.
  res.set('Cache-Control', 'private, no-cache')
  res.json(await getPublicProfile(id.data, lang, viewerId))
})
