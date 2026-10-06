import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { currentPlayer, requirePlayer } from '../dle/dle.guests.js'
import { ROOM_CODE, normalizeRoomCode } from '../dle/dle.logic.js'
import { BOMB_MODES, classicLexicon } from './bomb.dictionary.js'
import { BOMB_STYLES, MAX_LIVES, MAX_WORD_LENGTH, MIN_FUSE_OPTIONS } from './bomb.logic.js'
import { bombTyping, bombWord, createBombRoom, currentBombRoomOf, joinBombRoom, leaveBombRoom, setBombMode, setBombSettings, startBombRoom, subscribeBombRoom } from './bomb.rooms.js'
import { soloExplode, soloQuit, soloWord, startSolo } from './bomb.solo.js'
import { bombRecords } from './bomb.stats.js'

/**
 * Anime Bomb Party (cf. `bomb.rooms.ts`, `bomb.solo.ts`). Monté sous `/api/bomb` : un
 * compte, ou un invité avec son pseudo (le même que celui du BookshelfDLE).
 */
export const bombRouter = Router()
bombRouter.use(requirePlayer)
bombRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

const test = config.env === 'test'
const playLimiter = rateLimit({ windowMs: 60 * 1000, max: test ? 10_000 : 240 })
const roomLimiter = rateLimit({ windowMs: 60 * 1000, max: test ? 10_000 : 60 })
/** Frappe en direct : un envoi toutes les ~80 ms au plus côté client. */
const typingLimiter = rateLimit({ windowMs: 60 * 1000, max: test ? 10_000 : 900 })

const Mode = z.enum(BOMB_MODES)
const Settings = z
  .object({
    lives: z.number().int().min(1).max(MAX_LIVES),
    minFuse: z.literal(MIN_FUSE_OPTIONS),
    keepSyllable: z.boolean(),
    style: z.enum(BOMB_STYLES),
  })
  .partial()
const Word = z.object({ word: z.string().max(MAX_WORD_LENGTH * 2) })
const GameId = z.string().regex(/^[0-9a-f]{18}$/)
const Code = z
  .string()
  .max(16)
  .transform(normalizeRoomCode)
  .refine((code) => ROOM_CODE.test(code), 'Code de salon invalide.')

/** Accueil : records, Poussières du jour, salon en cours. */
bombRouter.get('/', async (req, res) => {
  const player = currentPlayer(req)
  res.json({ records: await bombRecords(player.id), currentRoom: currentBombRoomOf(player.id) })
})

/* ---- Solo ---------------------------------------------------------------------------- */

bombRouter.post('/solo', playLimiter, async (req, res) => {
  res.status(201).json(await startSolo(currentPlayer(req).id, z.object({ mode: Mode }).parse(req.body).mode))
})

bombRouter.post('/solo/:id/word', playLimiter, async (req, res) => {
  res.json(await soloWord(currentPlayer(req).id, GameId.parse(req.params.id), Word.parse(req.body).word))
})

bombRouter.post('/solo/:id/explode', playLimiter, async (req, res) => {
  res.json(await soloExplode(currentPlayer(req).id, GameId.parse(req.params.id)))
})

bombRouter.post('/solo/:id/quit', playLimiter, async (req, res) => {
  res.json(await soloQuit(currentPlayer(req).id, GameId.parse(req.params.id)))
})

/* ---- Salons ------------------------------------------------------------------------------ */

bombRouter.post('/rooms', roomLimiter, async (req, res) => {
  const { mode, style } = z.object({ mode: Mode, style: z.enum(BOMB_STYLES).optional() }).parse(req.body)
  res.status(201).json(await createBombRoom(currentPlayer(req), mode, style ? { style } : {}))
})

bombRouter.post('/rooms/:code/join', roomLimiter, async (req, res) => {
  res.json(await joinBombRoom(currentPlayer(req), Code.parse(req.params.code)))
})

bombRouter.post('/rooms/:code/leave', roomLimiter, (req, res) => {
  leaveBombRoom(currentPlayer(req).id, Code.parse(req.params.code))
  res.status(204).end()
})

bombRouter.post('/rooms/:code/mode', roomLimiter, (req, res) => {
  res.json(setBombMode(currentPlayer(req).id, Code.parse(req.params.code), z.object({ mode: Mode }).parse(req.body).mode))
})

bombRouter.post('/rooms/:code/settings', roomLimiter, (req, res) => {
  res.json(setBombSettings(currentPlayer(req).id, Code.parse(req.params.code), Settings.parse(req.body)))
})

bombRouter.post('/rooms/:code/start', roomLimiter, async (req, res) => {
  res.json(await startBombRoom(currentPlayer(req).id, Code.parse(req.params.code)))
})

bombRouter.post('/rooms/:code/typing', typingLimiter, (req, res) => {
  bombTyping(currentPlayer(req).id, Code.parse(req.params.code), z.object({ text: z.string().max(MAX_WORD_LENGTH * 2) }).parse(req.body).text)
  res.status(204).end()
})

bombRouter.post('/rooms/:code/word', playLimiter, (req, res) => {
  res.json(bombWord(currentPlayer(req).id, Code.parse(req.params.code), Word.parse(req.body).word))
})

/** Flux temps réel du salon (Server-Sent Events) : `state` à chaque changement, `typing` en direct. */
bombRouter.get('/rooms/:code/stream', (req, res) => {
  const stop = subscribeBombRoom(currentPlayer(req).id, Code.parse(req.params.code), res)
  req.on('close', stop)
})

/** Le dictionnaire français pèse ~1 s à indexer : préparé peu après le démarrage, pas au premier joueur. */
export function warmBombDictionary(): void {
  if (test) return
  setTimeout(() => void classicLexicon().catch((error: unknown) => console.warn('[bomb] dictionnaire indisponible :', error)), 5_000).unref?.()
}
