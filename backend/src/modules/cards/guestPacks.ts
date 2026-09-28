import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from '../../config.js'

/*
 * Boosters d'essai, sans compte. Un invité n'a pas de stock côté serveur :
 * chaque tirage lui est remis sous forme de « reçu » signé (HMAC) qui liste
 * ses cartes. Il garde ses reçus sur l'appareil ; à l'inscription, il les
 * présente et ses cartes rejoignent le compte. Un reçu ne peut être ni
 * fabriqué ni retouché : les cartes réclamées sont exactement celles tirées.
 */

/** Boosters offerts sans compte (le compte, lui, démarre avec une réserve pleine). */
export const GUEST_BOOSTERS = 2

export interface GuestPack {
  /** Identifiant unique du tirage : un même reçu présenté deux fois ne compte qu'une fois. */
  nonce: string
  cardIds: string[]
  issuedAt: Date
}

const sign = (payload: string) => createHmac('sha256', config.jwtSecret).update(`guest-pack\n${payload}`).digest()

export function signGuestPack(cardIds: readonly string[], issuedAt = new Date()): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, n: randomBytes(9).toString('base64url'), c: cardIds, t: Math.floor(issuedAt.getTime() / 1000) }),
  ).toString('base64url')
  return `${payload}.${sign(payload).toString('base64url')}`
}

/** Reçu authentique, ou `null` (signature fausse, format inconnu). */
export function readGuestPack(receipt: string): GuestPack | null {
  const [payload, signature, extra] = receipt.split('.')
  if (!payload || !signature || extra !== undefined) return null
  const expected = sign(payload)
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { v?: unknown; n?: unknown; c?: unknown; t?: unknown }
    if (data.v !== 1 || typeof data.n !== 'string' || typeof data.t !== 'number') return null
    if (!Array.isArray(data.c) || !data.c.every((id) => typeof id === 'string')) return null
    return { nonce: data.n, cardIds: data.c as string[], issuedAt: new Date(data.t * 1000) }
  } catch {
    return null
  }
}

/** Reçus valides et distincts, dans la limite des boosters d'essai. */
export function readGuestPacks(receipts: readonly string[]): GuestPack[] {
  const packs: GuestPack[] = []
  for (const receipt of receipts) {
    const pack = readGuestPack(receipt)
    if (pack && !packs.some((known) => known.nonce === pack.nonce)) packs.push(pack)
    if (packs.length === GUEST_BOOSTERS) break
  }
  return packs
}
