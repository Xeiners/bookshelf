import { Router } from 'express'
import { z } from 'zod'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { LibrarySnapshotSchema, PatchEntrySchema, SwipeSchema } from './library.schemas.js'
import {
  applySwipe,
  getLibrary,
  mergeLibrary,
  patchEntry,
  removeEntry,
  resetLibrary,
} from './library.service.js'

const WorkIdParam = z.string().min(1).max(128)

export const libraryRouter = Router()

libraryRouter.use(requireAuth)

libraryRouter.get('/', async (req, res) => {
  res.json(await getLibrary(currentUserId(req)))
})

/** Action du deck : wishlist | reading | read | skipped. */
libraryRouter.post('/swipe', async (req, res) => {
  const entry = await applySwipe(currentUserId(req), SwipeSchema.parse(req.body))
  res.json({ entry })
})

/** Fusion d'un état local complet (reprise après une longue période hors-ligne). */
libraryRouter.post('/sync', async (req, res) => {
  res.json(await mergeLibrary(currentUserId(req), LibrarySnapshotSchema.parse(req.body)))
})

libraryRouter.patch('/:workId', async (req, res) => {
  const workId = WorkIdParam.parse(req.params.workId)
  const entry = await patchEntry(currentUserId(req), workId, PatchEntrySchema.parse(req.body))
  res.json({ entry })
})

libraryRouter.delete('/:workId', async (req, res) => {
  await removeEntry(currentUserId(req), WorkIdParam.parse(req.params.workId))
  res.status(204).end()
})

libraryRouter.delete('/', async (req, res) => {
  await resetLibrary(currentUserId(req))
  res.status(204).end()
})
