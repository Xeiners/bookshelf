import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../db.js'
import { badRequest, unauthorized } from '../../lib/errors.js'
import { LangQuerySchema } from '../../lib/language.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { drawForSeed } from './oracle.service.js'
import { DAY_PATTERN, applyDraw } from './streak.js'

const DrawQuery = z.object({
  /** `<id utilisateur ou appareil>:<jour>` — choisie par le client, bornée ici. */
  seed: z.string().trim().min(3).max(160),
  lang: LangQuerySchema,
})

const CheckinSchema = z.object({
  day: z.string().regex(DAY_PATTERN),
  /** Série connue du client (tirages faits en invité ou hors ligne). */
  streak: z.number().int().min(0).max(10_000).optional(),
})

/** Le jour client ne peut pas avoir plus d'un jour d'avance sur l'UTC (fuseaux jusqu'à +14 h). */
function isPlausibleDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return false
  const tomorrow = new Date()
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return day <= tomorrow.toISOString().slice(0, 10)
}

export const oracleRouter = Router()

oracleRouter.get('/draw', async (req, res) => {
  const { seed, lang } = DrawQuery.parse(req.query)
  // Déterministe pour une graine donnée : cacheable côté navigateur pour la journée.
  res.set('Cache-Control', 'private, max-age=3600')
  res.json(await drawForSeed(seed, lang))
})

/** Enregistre le tirage du jour et renvoie la série à jour (source de vérité multi-appareils). */
oracleRouter.post('/checkin', requireAuth, async (req, res) => {
  const { day, streak: claimed } = CheckinSchema.parse(req.body)
  if (!isPlausibleDay(day)) throw badRequest('Jour invalide.', 'invalid_day')

  const userId = currentUserId(req)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { oracleLastDay: true, oracleStreak: true, oracleBest: true },
  })
  if (!user) throw unauthorized()

  const next = applyDraw(
    { lastDay: user.oracleLastDay, streak: user.oracleStreak, best: user.oracleBest },
    day,
    claimed,
  )
  await prisma.user.update({
    where: { id: userId },
    data: { oracleLastDay: next.lastDay, oracleStreak: next.streak, oracleBest: next.best },
  })
  res.json({ oracle: next })
})
