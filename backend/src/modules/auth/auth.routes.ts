import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../db.js'
import { HttpError, conflict, unauthorized } from '../../lib/errors.js'
import { DEFAULT_LANGUAGE, LanguageSchema } from '../../lib/language.js'
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../lib/password.js'
import { SESSION_COOKIE, clearSession, issueSession, readSession } from '../../lib/session.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { LibrarySnapshotSchema } from '../library/library.schemas.js'
import { getLibrary, mergeLibrary } from '../library/library.service.js'

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Adresse e-mail invalide.' }))
  .pipe(z.string().max(254))

const RegisterSchema = z.object({
  email: Email,
  password: z
    .string()
    .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
    .max(200, 'Mot de passe trop long.'),
  displayName: z.string().trim().min(1).max(40).optional(),
  /** Langue choisie en invité : devient celle du compte. */
  preferredLanguage: LanguageSchema.default(DEFAULT_LANGUAGE),
  /** État invité (localStorage) à fusionner dans le compte. */
  initialData: LibrarySnapshotSchema.optional(),
})

/** Préférences modifiables depuis le profil. */
const PatchMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).nullable().optional(),
    preferredLanguage: LanguageSchema.optional(),
  })
  .refine((patch) => patch.displayName !== undefined || patch.preferredLanguage !== undefined, {
    message: 'Rien à modifier.',
  })

const LoginSchema = z.object({
  email: Email,
  password: z.string().min(1).max(200),
  initialData: LibrarySnapshotSchema.optional(),
})

interface UserRow {
  id: string
  email: string
  displayName: string | null
  preferredLanguage: string
  oracleLastDay: string | null
  oracleStreak: number
  oracleBest: number
  createdAt: Date
}

const publicUser = (user: UserRow) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  // Une valeur inattendue en base retombe sur la langue par défaut.
  preferredLanguage: LanguageSchema.catch(DEFAULT_LANGUAGE).parse(user.preferredLanguage),
  // Série de tirages de l'Oracle : suit l'utilisateur d'un appareil à l'autre.
  oracle: { lastDay: user.oracleLastDay, streak: user.oracleStreak, best: user.oracleBest },
  createdAt: user.createdAt.getTime(),
})

/**
 * Codes d'erreur stables : le front traduit le message à partir du code, dans
 * la langue de l'utilisateur. Le `message` français n'est qu'une aide au debug.
 */
const invalidCredentials = () => new HttpError(401, 'invalid_credentials', 'E-mail ou mot de passe incorrect.')

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'

export const authRouter = Router()

/** 20 tentatives / 15 min / IP sur les routes sensibles. */
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 })

authRouter.post('/register', authLimiter, async (req, res) => {
  const { email, password, displayName, preferredLanguage, initialData } = RegisterSchema.parse(req.body)

  let user: UserRow
  try {
    user = await prisma.user.create({
      data: {
        email,
        displayName: displayName ?? null,
        preferredLanguage,
        passwordHash: await hashPassword(password),
      },
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Un compte existe déjà avec cet e-mail.', 'email_taken')
    throw error
  }

  const library = initialData ? await mergeLibrary(user.id, initialData) : await getLibrary(user.id)
  await issueSession(res, user.id)
  res.status(201).json({ user: publicUser(user), library })
})

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password, initialData } = LoginSchema.parse(req.body)

  const user = await prisma.user.findUnique({ where: { email } })
  // Vérification factice si l'e-mail est inconnu : même durée de réponse,
  // on ne révèle pas quels e-mails ont un compte.
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
  if (!user || !valid) throw invalidCredentials()

  const library = initialData ? await mergeLibrary(user.id, initialData) : await getLibrary(user.id)
  await issueSession(res, user.id)
  res.json({ user: publicUser(user), library })
})

authRouter.get('/me', async (req, res) => {
  const cookies = req.cookies as Record<string, string | undefined>
  const userId = await readSession(cookies[SESSION_COOKIE])
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null

  if (!user) {
    // Jeton valide mais compte supprimé : on nettoie le cookie orphelin.
    if (userId) clearSession(res)
    throw unauthorized()
  }
  res.json({ user: publicUser(user) })
})

authRouter.patch('/me', requireAuth, async (req, res) => {
  const patch = PatchMeSchema.parse(req.body)
  const data = {
    ...(patch.displayName !== undefined && { displayName: patch.displayName }),
    ...(patch.preferredLanguage !== undefined && { preferredLanguage: patch.preferredLanguage }),
  }
  // `updateMany` : un compte supprimé entre-temps donne 0 ligne, pas une exception.
  const { count } = await prisma.user.updateMany({ where: { id: currentUserId(req) }, data })
  if (count === 0) {
    clearSession(res)
    throw unauthorized()
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUserId(req) } })
  res.json({ user: publicUser(user) })
})

authRouter.post('/logout', (_req, res) => {
  clearSession(res)
  res.status(204).end()
})
