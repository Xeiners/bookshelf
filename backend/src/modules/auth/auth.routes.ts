import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../db.js'
import { HttpError, conflict, unauthorized } from '../../lib/errors.js'
import { DEFAULT_LANGUAGE, LanguageSchema, type Language } from '../../lib/language.js'
import { emailUnavailable, mailEnabled, sendMail } from '../../lib/mailer.js'
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../lib/password.js'
import { SESSION_COOKIE, clearSession, issueSession, readSession } from '../../lib/session.js'
import { currentUserId, requireAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { LibrarySnapshotSchema } from '../library/library.schemas.js'
import { getLibrary, mergeLibrary } from '../library/library.service.js'
import {
  CODE_LENGTH,
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_SENDS,
  RESEND_COOLDOWN_MS,
  SEND_WINDOW_MS,
  codeMatches,
  generateCode,
  hashCode,
} from './verification.js'
import { buildVerificationEmail } from './verificationEmail.js'

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
  /** Langue choisie en invité : devient celle du compte (et celle de l'e-mail). */
  preferredLanguage: LanguageSchema.default(DEFAULT_LANGUAGE),
})

const CODE_PATTERN = new RegExp('^[0-9]{' + CODE_LENGTH + '}$')

const VerifySchema = z.object({
  email: Email,
  code: z.string().trim().regex(CODE_PATTERN, 'Code invalide.'),
  /** État invité (localStorage) à fusionner dans le compte, au moment de sa création. */
  initialData: LibrarySnapshotSchema.optional(),
})

const ResendSchema = z.object({ email: Email })

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
/** Saisie du code : plus souple (fautes de frappe), toujours bornée par IP. */
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 })

const emailTaken = () => conflict('Un compte existe déjà avec cet e-mail.', 'email_taken')
const registrationNotFound = () =>
  new HttpError(400, 'registration_not_found', 'Aucune inscription en attente pour cet e-mail.')
const tooManyCodes = () => new HttpError(429, 'rate_limited', 'Trop de codes envoyés. Réessaie plus tard.')
const codeLocked = () => new HttpError(400, 'code_locked', 'Trop d’essais : demande un nouveau code.')

/** Échéances renvoyées au front : fin de validité du code, et premier renvoi possible. */
const pendingTimes = (sentAt: Date, expiresAt: Date) => ({
  expiresAt: expiresAt.getTime(),
  resendAt: sentAt.getTime() + RESEND_COOLDOWN_MS,
})

/** Renvoi trop rapproché : erreur 429 avec le délai restant, sinon null. */
function tooSoon(lastSentAt: Date, now: number): HttpError | null {
  const wait = lastSentAt.getTime() + RESEND_COOLDOWN_MS - now
  if (wait <= 0) return null
  const retryAfter = Math.ceil(wait / 1000)
  return new HttpError(429, 'resend_too_soon', 'Nouveau code possible dans ' + retryAfter + ' s.', { retryAfter })
}

async function sendCode(input: { email: string; code: string; language: Language; displayName: string | null }) {
  await sendMail(
    buildVerificationEmail({
      to: input.email,
      code: input.code,
      language: input.language,
      displayName: input.displayName,
      minutes: CODE_TTL_MS / 60_000,
    }),
  )
}

/**
 * Étape 1 de l'inscription : AUCUN compte n'est créé. L'inscription est mise en
 * attente et un code part par e-mail ; le compte naît à la saisie du bon code.
 * Renvoyer le formulaire relance un code (même délai et même plafond qu'un renvoi).
 */
authRouter.post('/register', authLimiter, async (req, res) => {
  const { email, password, displayName, preferredLanguage } = RegisterSchema.parse(req.body)
  if (!mailEnabled) throw emailUnavailable()
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) throw emailTaken()

  const now = Date.now()
  // Ménage opportuniste : les inscriptions abandonnées depuis plus d'un jour.
  await prisma.pendingRegistration.deleteMany({ where: { createdAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } } })

  const previous = await prisma.pendingRegistration.findUnique({ where: { email } })
  const sameWindow = previous !== null && now - previous.createdAt.getTime() < SEND_WINDOW_MS
  if (previous && sameWindow) {
    const wait = tooSoon(previous.lastSentAt, now)
    if (wait) throw wait
    if (previous.sends >= MAX_SENDS) throw tooManyCodes()
  }

  const code = generateCode()
  const sentAt = new Date(now)
  const expiresAt = new Date(now + CODE_TTL_MS)
  const data = {
    passwordHash: await hashPassword(password),
    displayName: displayName ?? null,
    preferredLanguage,
    codeHash: hashCode(email, code),
    expiresAt,
    attempts: 0,
    lastSentAt: sentAt,
  }
  await prisma.pendingRegistration.upsert({
    where: { email },
    create: { email, ...data, sends: 1, createdAt: sentAt },
    update: sameWindow ? { ...data, sends: { increment: 1 } } : { ...data, sends: 1, createdAt: sentAt },
  })

  await sendCode({ email, code, language: preferredLanguage, displayName: displayName ?? null })
  res.status(202).json({ email, ...pendingTimes(sentAt, expiresAt) })
})

/** Nouveau code pour une inscription en attente (délai de 60 s, 5 envois par heure). */
authRouter.post('/register/resend', authLimiter, async (req, res) => {
  const { email } = ResendSchema.parse(req.body)
  if (!mailEnabled) throw emailUnavailable()
  const pending = await prisma.pendingRegistration.findUnique({ where: { email } })
  if (!pending) throw registrationNotFound()

  const now = Date.now()
  const wait = tooSoon(pending.lastSentAt, now)
  if (wait) throw wait
  if (pending.sends >= MAX_SENDS && now - pending.createdAt.getTime() < SEND_WINDOW_MS) throw tooManyCodes()

  const code = generateCode()
  const sentAt = new Date(now)
  const expiresAt = new Date(now + CODE_TTL_MS)
  await prisma.pendingRegistration.update({
    where: { email },
    // Nouveau code : les essais repartent à zéro, l'ancien code ne vaut plus rien.
    data: { codeHash: hashCode(email, code), expiresAt, attempts: 0, lastSentAt: sentAt, sends: { increment: 1 } },
  })
  await sendCode({
    email,
    code,
    language: LanguageSchema.catch(DEFAULT_LANGUAGE).parse(pending.preferredLanguage),
    displayName: pending.displayName,
  })
  res.json({ email, ...pendingTimes(sentAt, expiresAt) })
})

/**
 * Étape 2 : le bon code crée le compte (adresse vérifiée), fusionne la
 * bibliothèque invitée et ouvre la session. Un code faux consomme un essai ;
 * au 5ᵉ, il faut en redemander un.
 */
authRouter.post('/register/verify', verifyLimiter, async (req, res) => {
  const { email, code, initialData } = VerifySchema.parse(req.body)
  const pending = await prisma.pendingRegistration.findUnique({ where: { email } })
  if (!pending) throw registrationNotFound()

  if (pending.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(400, 'code_expired', 'Code expiré : demande-en un nouveau.')
  }
  if (pending.attempts >= MAX_ATTEMPTS) throw codeLocked()
  if (!codeMatches(email, code, pending.codeHash)) {
    const { attempts } = await prisma.pendingRegistration.update({
      where: { email },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    })
    const remainingAttempts = Math.max(0, MAX_ATTEMPTS - attempts)
    if (remainingAttempts === 0) throw codeLocked()
    throw new HttpError(400, 'code_invalid', 'Code incorrect.', { remainingAttempts })
  }

  let user: UserRow
  try {
    // Création du compte ET fin de l'attente, d'un seul bloc.
    const [created] = await prisma.$transaction([
      prisma.user.create({
        data: {
          email,
          passwordHash: pending.passwordHash,
          displayName: pending.displayName,
          preferredLanguage: LanguageSchema.catch(DEFAULT_LANGUAGE).parse(pending.preferredLanguage),
          emailVerifiedAt: new Date(),
        },
      }),
      prisma.pendingRegistration.delete({ where: { email } }),
    ])
    user = created
  } catch (error) {
    // Compte créé entre-temps (autre onglet) : l'attente n'a plus lieu d'être.
    if (isUniqueViolation(error)) {
      await prisma.pendingRegistration.deleteMany({ where: { email } })
      throw emailTaken()
    }
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
