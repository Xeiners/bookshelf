import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { CookieOptions, NextFunction, Request, Response } from 'express'
import { config } from '../../config.js'
import { HttpError } from '../../lib/errors.js'
import { SESSION_COOKIE } from '../../lib/session.js'
import { authenticate } from '../../lib/sessionGuard.js'

/*
 * Invités du BookshelfDLE : sans compte, on peut jouer à plusieurs avec un simple
 * pseudo. L'identité tient dans un cookie signé (HTTP-only) ; les Poussières
 * gagnées sont remises sous forme de reçus signés, gardés sur l'appareil, que le
 * compte créé (ou retrouvé) échange ensuite — jamais un simple nombre falsifiable.
 */

export const GUEST_COOKIE = 'bookshelf_dle_guest'
const GUEST_DAYS = 30
/** Un reçu de Poussières se réclame dans ce délai. */
const RECEIPT_DAYS = 14
/** Poussières d'invité qu'un compte peut récupérer, en tout : pas de ferme à comptes jetables. */
export const GUEST_CLAIM_CAP = 300

/** Un joueur de salon : un compte, ou un invité (son pseudo vient du cookie). */
export interface Participant {
  id: string
  guest: { name: string } | null
}

declare global {
  namespace Express {
    interface Request {
      /** Renseigné par `requirePlayer`. */
      player?: Participant
    }
  }
}

export const isGuestId = (id: string) => id.startsWith('guest_')

/* ---- Signatures --------------------------------------------------------------------- */

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const mac = (purpose: string, payload: string) => createHmac('sha256', config.jwtSecret).update(`${purpose}\n${payload}`).digest('base64url')

function sign(purpose: string, value: unknown): string {
  const payload = encode(value)
  return `${payload}.${mac(purpose, payload)}`
}

function verify(purpose: string, token: string | undefined): unknown {
  if (!token || token.length > 2048) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = Buffer.from(mac(purpose, payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
  } catch {
    return null
  }
}

/* ---- Identité ----------------------------------------------------------------------- */

/** Pseudo d'invité : lettres, chiffres, espaces, `_` et `-`, de 2 à 20 caractères ; sinon `Guest_1234`. */
export function guestName(value: string | undefined): string {
  const cleaned = (value ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20)
  return cleaned.length >= 2 ? cleaned : `Guest_${String(randomInt(0, 10_000)).padStart(4, '0')}`
}

const cookieOptions: CookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' }

/** Pose (ou renouvelle) l'identité d'invité ; garde son id s'il en avait déjà un. */
export function issueGuest(req: Request, res: Response, name: string | undefined): { id: string; name: string } {
  const current = readGuest(req)
  const guest = { id: current?.id ?? `guest_${randomBytes(9).toString('hex')}`, name: guestName(name ?? current?.name) }
  res.cookie(GUEST_COOKIE, sign('dle-guest', guest), { ...cookieOptions, maxAge: GUEST_DAYS * 24 * 60 * 60 * 1000 })
  return guest
}

export function readGuest(req: Request): { id: string; name: string } | null {
  const value = verify('dle-guest', (req.cookies as Record<string, string | undefined>)[GUEST_COOKIE])
  if (typeof value !== 'object' || value === null) return null
  const { id, name } = value as { id?: unknown; name?: unknown }
  return typeof id === 'string' && isGuestId(id) && typeof name === 'string' ? { id, name } : null
}

/**
 * Joueur d'un salon : le compte connecté, sinon l'invité du cookie. 401 `guest_required`
 * sans l'un ni l'autre (le front demande alors un pseudo).
 */
export async function requirePlayer(req: Request, _res: Response, next: NextFunction) {
  const userId = await authenticate((req.cookies as Record<string, string | undefined>)[SESSION_COOKIE]).catch(() => null)
  if (userId) {
    req.player = { id: userId, guest: null }
    return next()
  }
  const guest = readGuest(req)
  if (!guest) throw new HttpError(401, 'guest_required', 'Choisis un pseudo pour jouer.')
  req.player = { id: guest.id, guest: { name: guest.name } }
  next()
}

export function currentPlayer(req: Request): Participant {
  if (!req.player) throw new HttpError(401, 'guest_required', 'Choisis un pseudo pour jouer.')
  return req.player
}

/* ---- Reçus de Poussières ---------------------------------------------------------- */

export interface StardustReceipt {
  /** Identifiant unique : un reçu ne se réclame qu'une fois. */
  n: string
  /** Poussières. */
  a: number
  /** Émis le (ms). */
  t: number
}

export const signReceipt = (amount: number, now = Date.now()): string =>
  sign('dle-stardust', { n: randomBytes(9).toString('hex'), a: amount, t: now } satisfies StardustReceipt)

/** Reçu valide et pas encore périmé ; `null` sinon. */
export function readReceipt(token: string, now = Date.now()): StardustReceipt | null {
  const value = verify('dle-stardust', token)
  if (typeof value !== 'object' || value === null) return null
  const { n, a, t } = value as Partial<StardustReceipt>
  if (typeof n !== 'string' || typeof a !== 'number' || typeof t !== 'number' || a <= 0 || a > 100) return null
  if (now - t > RECEIPT_DAYS * 24 * 60 * 60 * 1000 || t > now + 60_000) return null
  return { n, a, t }
}

/** Parties récompensées par invité sur 24 h glissantes (en mémoire : un invité n'a pas de ligne en base). */
const guestRewards = new Map<string, number[]>()

export function guestRewardedToday(id: string, now = Date.now()): number {
  const recent = (guestRewards.get(id) ?? []).filter((at) => now - at < 24 * 60 * 60 * 1000)
  guestRewards.set(id, recent)
  return recent.length
}

export function noteGuestReward(id: string, now = Date.now()): void {
  guestRewards.set(id, [...(guestRewards.get(id) ?? []), now])
}
