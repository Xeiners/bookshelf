import { prisma } from '../db.js'
import { TtlCache } from './cache.js'
import { HttpError } from './errors.js'
import { readSessionClaims } from './session.js'

/*
 * Garde des sessions. Le jeton seul ne suffit plus : le compte doit exister, ne
 * pas être suspendu, et la version des sessions du jeton doit être la sienne
 * (une suspension l'incrémente : tous les jetons déjà émis tombent d'un coup).
 * L'état du compte est gardé 20 s en mémoire — une requête en base par compte
 * actif et par tranche de 20 s, pas une par appel —, oublié aussitôt qu'un
 * administrateur agit (`forgetStanding`). Au passage, la dernière activité est
 * notée, à quelques minutes près.
 */

interface Standing {
  version: number
  suspended: boolean
}

const standings = new TtlCache<Standing>({ maxEntries: 10_000, ttlMs: 20_000 })
/** `lastSeenAt` n'est réécrit qu'au-delà de ce délai. */
const SEEN_EVERY_MS = 5 * 60 * 1000

export const accountSuspended = (reason?: string | null) =>
  new HttpError(401, 'account_suspended', 'Ce compte est suspendu.', reason ? { reason } : undefined)

/**
 * Compte de la session, ou `null` (pas de jeton, jeton faux ou expiré, compte
 * supprimé, sessions révoquées). Lève `account_suspended` pour un compte suspendu.
 */
export async function authenticate(token: string | undefined, now = new Date()): Promise<string | null> {
  const claims = await readSessionClaims(token)
  if (!claims) return null
  let standing = standings.get(claims.userId)
  if (!standing) {
    const user = await prisma.user.findUnique({
      where: { id: claims.userId },
      select: { sessionVersion: true, suspendedAt: true, lastSeenAt: true },
    })
    if (!user) return null
    standing = { version: user.sessionVersion, suspended: user.suspendedAt !== null }
    standings.set(claims.userId, standing)
    if (!user.lastSeenAt || now.getTime() - user.lastSeenAt.getTime() > SEEN_EVERY_MS) {
      // Sans attendre : la requête n'a pas à payer cette écriture.
      void prisma.user.updateMany({ where: { id: claims.userId }, data: { lastSeenAt: now } }).catch(() => {})
    }
  }
  if (standing.suspended) throw accountSuspended()
  if (claims.version !== standing.version) return null
  return claims.userId
}

/** L'état d'un compte a changé (suspension, réactivation) : relu à la prochaine requête. */
export const forgetStanding = (userId: string) => standings.delete(userId)
