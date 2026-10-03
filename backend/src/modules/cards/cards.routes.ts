import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { boosterStatus, collectionOf, guestCollection, openBooster, openGuestBooster, seriesShowcase, setFavorite } from './cards.service.js'
import { GUEST_BOOSTERS } from './guestPacks.js'

/*
 * Boosters et collection de cartes. Le stock d'un compte vit côté serveur
 * (horloge du serveur) : un invité ne pourrait que tricher sur la sienne.
 * Sans compte : `GUEST_BOOSTERS` boosters d'essai, remis sous forme de reçus
 * signés (cf. `guestPacks.ts`) que l'inscription transforme en cartes.
 * Les routes invitées sont déclarées AVANT `requireAuth`.
 */

/** Reçus d'essai présentés par un invité. */
const GuestBody = z.object({ receipts: z.array(z.string().max(1024)).max(GUEST_BOOSTERS * 2).default([]) })
/** Série du booster : 1, 2, ou la roulette (par défaut). */
const Series = z.union([z.literal(1), z.literal(2), z.literal('random')]).default('random')
const OpenBody = z.object({ series: Series })

/** Monté sous `/api/boosters`. */
export const boostersRouter = Router()

/**
 * Chaque appareil n'a que `GUEST_BOOSTERS` essais, mais un invité peut
 * effacer ses reçus : la limite par IP borne les relances.
 */
const guestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: config.cards.unlimited ? 600 : 12 })

/** Booster d'essai : cartes tirées et leur reçu signé. 409 une fois l'essai épuisé. */
boostersRouter.post('/guest/open', guestLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const { receipts } = GuestBody.parse(req.body ?? {})
  res.json(await openGuestBooster(receipts, { series: OpenBody.parse(req.body ?? {}).series }))
})

/** Les séries et leurs couvertures (illustration des boosters). Public. */
boostersRouter.get('/series', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=600')
  res.json({ series: await seriesShowcase() })
})

boostersRouter.use(requireAuth)

/** Stock actuel et délai exact (en secondes) avant le prochain booster. */
boostersRouter.get('/status', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await boosterStatus(currentUserId(req)))
})

/**
 * Garde-fou contre les rafales ; en recette (`BOOSTER_UNLIMITED_MODE`), on doit
 * justement pouvoir enchaîner les ouvertures pour éprouver les taux.
 */
const openLimiter = rateLimit({ windowMs: 60 * 1000, max: config.cards.unlimited ? 600 : 20 })

/** Ouvre un booster : 4 cartes tirées, enregistrées, et le stock à jour. 409 si le stock est vide. */
boostersRouter.post('/open', openLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await openBooster(currentUserId(req), { series: OpenBody.parse(req.body ?? {}).series }))
})

/** Monté sous `/api/cards`. */
export const cardsRouter = Router()

const guestAlbumLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 })

/** Album d'un invité, reconstitué depuis ses reçus (POST : ils ne tiennent pas dans une URL). */
cardsRouter.post('/guest/collection', guestAlbumLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await guestCollection(GuestBody.parse(req.body ?? {}).receipts))
})

cardsRouter.use(requireAuth)

/** Tout le set, dans l'ordre de l'album, avec ce que le compte possède. */
cardsRouter.get('/collection', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await collectionOf(currentUserId(req)))
})

const FavoriteBody = z.object({ isFavorite: z.boolean() })

cardsRouter.patch('/:cardId/favorite', async (req, res) => {
  const { isFavorite } = FavoriteBody.parse(req.body)
  const cardId = z.string().min(1).max(40).parse(req.params.cardId)
  await setFavorite(currentUserId(req), cardId, isFavorite)
  res.status(204).end()
})
