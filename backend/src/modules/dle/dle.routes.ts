import { Router, type Response } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { notFound } from '../../lib/errors.js'
import { currentUserId, optionalAuth, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import type { CachedImage } from '../manga/manga.routes.js'
import { BOOSTER_PRICE } from '../stardust/stardust.service.js'
import { dailyView, dleOverview, emptyOverview, guessDaily, puzzleEntity } from './dle.daily.js'
import { characterOf, gameOf } from './dle.games.js'
import { currentPlayer, issueGuest, readGuest, requirePlayer } from './dle.guests.js'
import { DLE_CATEGORIES, DLE_MODES, ROOM_CODE, isImageMode, normalizeRoomCode, parisDay } from './dle.logic.js'
import {
  createRoom,
  currentRoomOf,
  forfeitRoom,
  guessRoom,
  joinRoom,
  leaveRoom,
  quickMatch,
  DURATION_OPTIONS,
  GUESS_OPTIONS,
  ROOM_KINDS,
  rematchRoom,
  roomZoomTarget,
  setRoomKind,
  setRoomSettings,
  startRoom,
  waitRoom,
} from './dle.rooms.js'

/*
 * BookshelfDLE (cf. `dle.logic.ts`) : énigmes du jour et salons multijoueurs, par
 * catégorie. Les énigmes du jour sont réservées aux comptes (essais, série et
 * Poussières sur le serveur) ; les salons s'ouvrent aussi aux invités (pseudo, cf.
 * `dle.guests.ts`).
 */

export const dleRouter = Router()

const Category = z.enum(DLE_CATEGORIES)
const Mode = z.enum(DLE_MODES)
const CardId = z.string().min(1).max(40)
const GuessBody = z.object({ cardId: CardId })
const Code = z
  .string()
  .max(16)
  .transform(normalizeRoomCode)
  .refine((code) => ROOM_CODE.test(code), 'Code de salon invalide.')

/** Essais : un humain n'en tape pas 60 par minute ; les tests d'intégration, si. */
const guessLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 2000 : 60 })
/** Créer, rejoindre, lancer, quitter un salon. */
const roomLimiter = rateLimit({ windowMs: 60 * 1000, max: config.env === 'test' ? 2000 : 40 })

/**
 * Accueil : solde, palmarès, énigmes du jour de chaque catégorie, et le salon en cours.
 * Invité : un accueil vierge (ses Poussières sont des reçus gardés sur l'appareil), et son pseudo.
 */
dleRouter.get('/', optionalAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  if (req.userId) {
    res.json({ ...(await dleOverview(req.userId, BOOSTER_PRICE)), currentRoom: currentRoomOf(req.userId), guest: null })
    return
  }
  const guest = readGuest(req)
  res.json({ ...emptyOverview(BOOSTER_PRICE), currentRoom: guest ? currentRoomOf(guest.id) : null, guest })
})

const guestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: config.env === 'test' ? 1000 : 30 })

/** Jouer sans compte : un pseudo (`Guest_1234` par défaut), gardé dans un cookie signé. */
dleRouter.post('/guest', guestLimiter, (req, res) => {
  const { name } = z.object({ name: z.string().max(40).optional() }).parse(req.body ?? {})
  res.json({ guest: issueGuest(req, res, name) })
})

/** Propositions possibles d'une catégorie (saisie) : nom, vignette, et les autres noms pour chercher. */
dleRouter.get('/works', async (req, res) => {
  const category = Category.catch('manga').parse(req.query.category)
  const game = gameOf(category)
  const { list, search } = await game.pool()
  res.set('Cache-Control', 'private, max-age=600')
  res.json({ works: list.map((entity) => ({ ...game.summary(entity), search: search.get(entity.id) ?? '' })) })
})

function sendImage(res: Response, image: CachedImage, cacheControl: string): void {
  res.set('Cache-Control', cacheControl)
  res.type(image.contentType).send(image.body)
}

/** Portrait d'un personnage (vignettes de la saisie et du plateau). */
dleRouter.get('/characters/:category/:id/image', async (req, res) => {
  const found = characterOf(Category.parse(req.params.category), z.string().max(40).parse(req.params.id))
  if (!found) throw notFound('Personnage inconnu.')
  sendImage(res, await found.image(), 'private, max-age=86400')
})

/** Image de l'énigme du jour d'un format à image (zoom, pixels), sans révéler son adresse. */
dleRouter.get('/daily/:category/:mode/image', requireAuth, async (req, res) => {
  const category = Category.parse(req.params.category)
  const mode = Mode.refine(isImageMode, 'Ce format n’a pas d’image.').parse(req.params.mode)
  const entity = await puzzleEntity(parisDay(new Date()), category, mode)
  sendImage(res, await gameOf(category).image(entity), 'private, max-age=3600')
})

dleRouter.get('/daily/:category/:mode', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await dailyView(currentUserId(req), Category.parse(req.params.category), Mode.parse(req.params.mode)))
})

dleRouter.post('/daily/:category/:mode/guess', requireAuth, guessLimiter, async (req, res) => {
  const { cardId } = GuessBody.parse(req.body)
  res.json(await guessDaily(currentUserId(req), Category.parse(req.params.category), Mode.parse(req.params.mode), cardId))
})

/* ---- Salons ------------------------------------------------------------------------ */

const Kind = z.enum(ROOM_KINDS)
/** Formats : `modes` (Classique, Couverture, Pixels, joués à la suite) ; `mode` seul reste accepté. */
const Modes = z.array(Mode).min(1).max(DLE_MODES.length)
const pickModes = (body: { mode?: z.infer<typeof Mode>; modes?: z.infer<typeof Modes> }) => body.modes ?? [body.mode ?? 'classic']
const CreateBody = z.object({
  category: Category.default('manga'),
  mode: Mode.optional(),
  modes: Modes.optional(),
  visibility: z.enum(['private', 'public']).default('private'),
  kind: Kind.default('versus'),
})
const QuickBody = z.object({ category: Category.default('manga'), mode: Mode.optional(), modes: Modes.optional(), kind: Kind.default('versus') })

// Salons : un compte, ou un invité (pseudo).
dleRouter.use('/rooms', requirePlayer)

dleRouter.post('/rooms', roomLimiter, async (req, res) => {
  const body = CreateBody.parse(req.body)
  res.status(201).json(await createRoom(currentPlayer(req), body.category, pickModes(body), body.visibility, body.kind))
})

/** Partie rapide. Déclarée AVANT `/rooms/:code`. */
dleRouter.post('/rooms/quick', roomLimiter, async (req, res) => {
  const body = QuickBody.parse(req.body)
  res.json(await quickMatch(currentPlayer(req), body.category, pickModes(body), body.kind))
})

/** État du salon, en attente longue : `?v=<version connue>` ne répond qu'au changement suivant. */
dleRouter.get('/rooms/:code', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const since = z.coerce.number().int().nonnegative().nullable().catch(null).parse(req.query.v ?? null)
  // Client parti (onglet fermé, requête annulée) : l'attente s'arrête aussitôt.
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  const view = await waitRoom(currentPlayer(req).id, Code.parse(req.params.code), since, controller.signal)
  if (!res.writableEnded && !controller.signal.aborted) res.json(view)
})

dleRouter.get('/rooms/:code/image', async (req, res) => {
  const { category, entity } = roomZoomTarget(currentPlayer(req).id, Code.parse(req.params.code))
  sendImage(res, await gameOf(category).image(entity), 'private, max-age=600')
})

dleRouter.post('/rooms/:code/join', roomLimiter, async (req, res) => {
  res.json(await joinRoom(currentPlayer(req), Code.parse(req.params.code)))
})

dleRouter.post('/rooms/:code/leave', roomLimiter, (req, res) => {
  leaveRoom(currentPlayer(req).id, Code.parse(req.params.code))
  res.status(204).end()
})

dleRouter.post('/rooms/:code/start', roomLimiter, async (req, res) => {
  res.json(await startRoom(currentPlayer(req).id, Code.parse(req.params.code)))
})

/** L'hôte choisit VERSUS ou COOP, dans la salle d'attente. */
dleRouter.post('/rooms/:code/kind', roomLimiter, async (req, res) => {
  const { kind } = z.object({ kind: Kind }).parse(req.body)
  res.json(await setRoomKind(currentPlayer(req).id, Code.parse(req.params.code), kind))
})

const SettingsBody = z.object({
  kind: Kind.optional(),
  modes: Modes.optional(),
  maxGuesses: z
    .number()
    .int()
    .nullable()
    .refine((value) => (GUESS_OPTIONS as readonly (number | null)[]).includes(value), 'Nombre d’essais invalide.')
    .optional(),
  roundSeconds: z
    .number()
    .int()
    .refine((value) => (DURATION_OPTIONS as readonly number[]).includes(value), 'Durée invalide.')
    .optional(),
})

/** L'hôte règle la partie : type, essais par manche (illimités ou non), durée. */
dleRouter.post('/rooms/:code/settings', roomLimiter, async (req, res) => {
  res.json(await setRoomSettings(currentPlayer(req).id, Code.parse(req.params.code), SettingsBody.parse(req.body)))
})

dleRouter.post('/rooms/:code/rematch', roomLimiter, async (req, res) => {
  res.json(await rematchRoom(currentPlayer(req).id, Code.parse(req.params.code)))
})

dleRouter.post('/rooms/:code/guess', guessLimiter, async (req, res) => {
  const { cardId } = GuessBody.parse(req.body)
  res.json(await guessRoom(currentPlayer(req).id, Code.parse(req.params.code), cardId))
})

dleRouter.post('/rooms/:code/forfeit', roomLimiter, async (req, res) => {
  res.json(await forfeitRoom(currentPlayer(req).id, Code.parse(req.params.code)))
})
