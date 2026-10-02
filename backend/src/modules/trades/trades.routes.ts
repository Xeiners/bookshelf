import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { RARITIES } from '../cards/boosters.logic.js'
import { acceptOffer, cancelOffer, createOffer, listMarket, listMine } from './trades.service.js'

/*
 * Marché d'échange de doublons (cf. `trades.service.ts`). Réservé aux comptes :
 * un invité n'a que des reçus d'essai, pas de cartes sur le serveur.
 */

export const tradesRouter = Router()
tradesRouter.use(requireAuth)

const CardId = z.string().min(1).max(40)
const OfferId = z.string().min(1).max(40)

/** Filtres du marché ; une valeur inconnue est ignorée plutôt que refusée. */
const MarketQuery = z.object({
  rarity: z.enum(RARITIES).optional().catch(undefined),
  series: z.coerce.number().pipe(z.union([z.literal(1), z.literal(2)])).optional().catch(undefined),
  fillable: z
    .enum(['1', 'true', '0', 'false'])
    .transform((value) => value === '1' || value === 'true')
    .optional()
    .catch(undefined),
})

const CreateBody = z.object({ offeredCardId: CardId, requestedCardId: CardId })

/**
 * Créer, accepter, annuler : largement assez pour un humain, pas pour un script.
 * Les tests d'intégration enchaînent des dizaines d'échanges depuis la même IP.
 */
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 1000 : 30 })

/** Offres ouvertes des autres comptes : `?rarity=EPIC&series=2&fillable=1`. */
tradesRouter.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ offers: await listMarket(currentUserId(req), MarketQuery.parse(req.query)) })
})

/** Mes offres (ouvertes d'abord) et les échanges que j'ai acceptés. Déclarée AVANT `/:id`. */
tradesRouter.get('/mine', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ offers: await listMine(currentUserId(req)) })
})

tradesRouter.post('/', writeLimiter, async (req, res) => {
  res.status(201).json({ offer: await createOffer(currentUserId(req), CreateBody.parse(req.body)) })
})

tradesRouter.post('/:id/accept', writeLimiter, async (req, res) => {
  res.json(await acceptOffer(OfferId.parse(req.params.id), currentUserId(req)))
})

tradesRouter.delete('/:id', writeLimiter, async (req, res) => {
  res.json({ offer: await cancelOffer(OfferId.parse(req.params.id), currentUserId(req)) })
})
