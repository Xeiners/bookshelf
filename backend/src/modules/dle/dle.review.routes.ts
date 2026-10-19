import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import { currentReviewer, requireReviewer } from '../admin/admin.access.js'
import { dleReview } from './dle.review.js'

/**
 * Revue des images d'énigme, montée sous `/api/admin/dle-images` AVANT l'administration : ouverte aux
 * administrateurs et aux contrôleurs d'images (rôle donné depuis la fiche d'un compte). 404 pour les autres.
 */
export const dleReviewRouter = Router()
dleReviewRouter.use(requireAuth, requireReviewer, (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

const Category = z.string().min(1).max(30)
const ReviewQuery = z.object({ limit: z.coerce.number().int().min(1).max(20).catch(8) })
const ImageQuery = z.object({ character: z.string().min(1).max(80), key: z.string().min(1).max(300) })
const PortraitQuery = z.object({ character: z.string().min(1).max(80) })
const ReviewBody = z.object({ characterId: z.string().min(1).max(80), key: z.string().min(1).max(300), decision: z.enum(['approve', 'ban', 'clear']) })

/** Les univers de personnages et l'avancement de leur revue. */
dleReviewRouter.get('/', async (_req, res) => {
  res.json({ universes: await dleReview.overview() })
})

/** Les prochaines images à revoir dans un univers (`ready: false` : elles se chargent encore). */
dleReviewRouter.get('/:category/queue', async (req, res) => {
  res.json(await dleReview.queue(Category.parse(req.params.category), ReviewQuery.parse(req.query).limit))
})

/** L'image elle-même, relayée (l'adresse d'origine ne sort pas du serveur). */
dleReviewRouter.get('/:category/image', async (req, res) => {
  const { character, key } = ImageQuery.parse(req.query)
  const image = await dleReview.image(Category.parse(req.params.category), character, key)
  res.set('Cache-Control', 'private, max-age=3600').type(image.contentType).send(image.body)
})

/** Le portrait du personnage : de quoi juger l'image. */
dleReviewRouter.get('/:category/portrait', async (req, res) => {
  const { character } = PortraitQuery.parse(req.query)
  const image = await dleReview.portrait(Category.parse(req.params.category), character)
  res.set('Cache-Control', 'private, max-age=3600').type(image.contentType).send(image.body)
})

/** Valide (`approve`), bannit (`ban`) ou efface (`clear`) la décision sur une image. */
dleReviewRouter.post('/:category/review', async (req, res) => {
  const { characterId, key, decision } = ReviewBody.parse(req.body)
  res.json(await dleReview.decide(currentReviewer(req), Category.parse(req.params.category), characterId, key, decision))
})
