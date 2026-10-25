import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../core/config.js'
import { currentUserId, requireAuth } from '../../core/http/auth.js'
import { rateLimit } from '../../core/http/rateLimit.js'
import { boosterStatus, collectionOf, guestCollection, openBooster, openGuestBooster, openLegendaryPack, seriesShowcase, setFavorite } from './cards.service.js'
import { GUEST_BOOSTERS } from './guestPacks.js'
import { characterArt } from './cards.art.js'
import { CONVERTIBLE_RARITIES, MAX_CONVERT_CARDS } from './duplicates/duplicates.logic.js'
import { convertDuplicates, duplicatesOf } from './duplicates/duplicates.service.js'
import { acknowledgeRetirement, pendingRetirement } from './retirement/retirement.service.js'
import { GIFT_MESSAGE_MAX, SHARE_MAX_CARDS, SHARE_MAX_RECIPIENTS, shareCards } from '../trades/trades.service.js'

/*
 * Boosters et collection de cartes. Le stock d'un compte vit côté serveur
 * (horloge du serveur) : un invité ne pourrait que tricher sur la sienne.
 * Sans compte : `GUEST_BOOSTERS` boosters d'essai, remis sous forme de reçus
 * signés (cf. `guestPacks.ts`) que l'inscription transforme en cartes.
 * Les routes invitées sont déclarées AVANT `requireAuth`.
 */

/** Reçus d'essai présentés par un invité. */
const GuestBody = z.object({ receipts: z.array(z.string().max(1024)).max(GUEST_BOOSTERS * 2).default([]) })
/** Série du booster : 1, 2, 3, ou la roulette (par défaut). */
const Series = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal('random')]).default('random')
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
  // Revalidé à chaque ouverture : une série qui vient d'être prête (la 3, chargée en
  // arrière-plan) doit apparaître tout de suite. Le serveur garde, lui, son propre cache.
  res.set('Cache-Control', 'no-cache')
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

/** Ouvre un pack Légendaire offert (dernière carte Légendaire ou mieux). 409 `no_legendary_pack` s'il n'en reste pas. */
boostersRouter.post('/legendary/open', openLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await openLegendaryPack(currentUserId(req)))
})

/** Monté sous `/api/cards`. */
export const cardsRouter = Router()

const guestAlbumLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 })

/** Album d'un invité, reconstitué depuis ses reçus (POST : ils ne tiennent pas dans une URL). */
cardsRouter.post('/guest/collection', guestAlbumLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await guestCollection(GuestBody.parse(req.body ?? {}).receipts))
})

/** Portrait d'une carte de personnage (Série 3), agrandi : public, comme les couvertures. */
cardsRouter.get('/art/:cardId', async (req, res) => {
  const image = await characterArt(z.string().max(20).parse(req.params.cardId))
  res.set('Cache-Control', 'public, max-age=604800, immutable')
  res.type(image.contentType).send(image.body)
})

cardsRouter.use(requireAuth)

/** Tout le set, dans l'ordre de l'album, avec ce que le compte possède. */
cardsRouter.get('/collection', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await collectionOf(currentUserId(req)))
})

/**
 * Retrait des Séries 1 et 2 : le bilan de la conversion en Poussières, tant que son animation n'a
 * pas été vue jusqu'au bout (`null` sinon). La conversion elle-même se fait côté serveur, une fois.
 */
cardsRouter.get('/retirement', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ retirement: await pendingRetirement(currentUserId(req)) })
})

/** L'animation de conversion a été vue : elle ne revient plus. */
cardsRouter.post('/retirement/seen', async (req, res) => {
  await acknowledgeRetirement(currentUserId(req))
  res.status(204).end()
})

const FavoriteBody = z.object({ isFavorite: z.boolean() })
const giftLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 1000 : 20 })

const ShareBody = z
  .object({
    cardIds: z.array(z.string().min(1).max(40)).min(1).max(SHARE_MAX_CARDS),
    toUserIds: z.array(z.string().min(1).max(40)).max(SHARE_MAX_RECIPIENTS).default([]),
    /** « Informer tout le monde » : tous les membres (Légendaires et Mythiques seulement). */
    everyone: z.boolean().default(false),
    message: z.string().max(GIFT_MESSAGE_MAX * 2).nullish(),
  })
  .refine((body) => body.everyone || body.toUserIds.length > 0, { message: 'Choisis au moins un membre.' })

/** « Informer » : montrer des cartes possédées à des membres (rien ne change de main). */
cardsRouter.post('/share', giftLimiter, async (req, res) => {
  const { cardIds, toUserIds, everyone, message } = ShareBody.parse(req.body)
  res.json({ notified: await shareCards(currentUserId(req), cardIds, everyone ? 'everyone' : toUserIds, message ?? null) })
})

const ConvertBody = z.union([
  z.object({ cardId: z.string().min(1).max(40), copies: z.number().int().min(1).max(MAX_CONVERT_CARDS) }),
  z.object({ items: z.array(z.object({ cardId: z.string().min(1).max(40), copies: z.number().int().min(1).max(MAX_CONVERT_CARDS) })).min(1).max(MAX_CONVERT_CARDS) }),
  z.object({ rarities: z.array(z.enum(CONVERTIBLE_RARITIES)).min(1).max(CONVERTIBLE_RARITIES.length) }),
])
const convertLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 1000 : 30 })

/** Doublons convertibles en Poussières, et le barème par rareté. */
cardsRouter.get('/duplicates', async (req, res) => {
  res.json(await duplicatesOf(currentUserId(req)))
})

/** Convertit des doublons en Poussières : une carte (`cardId`, `copies`) ou toutes les raretés choisies. */
cardsRouter.post('/convert', convertLimiter, async (req, res) => {
  res.json(await convertDuplicates(currentUserId(req), ConvertBody.parse(req.body)))
})

cardsRouter.patch('/:cardId/favorite', async (req, res) => {
  const { isFavorite } = FavoriteBody.parse(req.body)
  const cardId = z.string().min(1).max(40).parse(req.params.cardId)
  await setFavorite(currentUserId(req), cardId, isFavorite)
  res.status(204).end()
})
